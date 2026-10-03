"""Dynamic discovery of Indian legal sources (dynamic-sourcing upgrade).

Replaces hand-typing every source URL in ``official_sources.py`` with a set of
pluggable providers that find candidate sources at runtime and upsert them
into ``legal_source_catalog`` (``app/models/legal_source_catalog.py``). An
admin (or the bulk script) then ingests a catalog entry the same way Phase 3
always ingested a manually-typed one — ``ingest_source()`` is unchanged.

Providers, in order of what ``kb:discover`` runs by default
(``LEGAL_SOURCE_DISCOVERY_PROVIDERS``):

* ``curated`` — the existing hand-verified 15-Act list in
  ``official_sources.py``. Kept as a guaranteed fallback, not the primary
  mechanism anymore.
* ``india_code_oai`` — India Code's ``/handle/`` + ``/bitstream/`` URL
  pattern is DSpace's signature, and DSpace repositories expose a standard
  OAI-PMH feed (``ListRecords``, Dublin Core). This harvests it directly
  rather than scraping version-specific HTML, so it keeps working across
  India Code's own site redesigns. The exact OAI path and set (community)
  aren't verifiable from this sandbox — see docs/adr/0011 — so the provider
  tries each configured path and records whichever the live endpoint accepts.
* ``hf_dataset`` — ``RUDXLABS/india-central-state-acts`` on Hugging Face, a
  public, pre-scraped corpus of ~34.7k central *and state* Act PDFs (filling
  the "no state-specific sources" gap in docs/project-status.md), read via
  HF's public, keyless ``datasets-server`` rows API. Column names are mapped
  defensively (several candidate keys tried) since the exact schema wasn't
  verifiable from this sandbox either.

Every provider failure (network blocked, endpoint not found, unexpected
schema) is caught and recorded per-provider rather than raised — one broken
provider never blocks the others, same philosophy as
``pipeline.py``'s per-source failure tracking.
"""

from __future__ import annotations

import xml.etree.ElementTree as ET
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Protocol

import httpx
from sqlalchemy import func
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.logging import get_logger
from app.models.legal_document import DocumentType, IngestionStatus
from app.models.legal_source_catalog import CatalogEntryStatus, LegalSourceCatalogEntry
from app.services.ingestion.official_sources import OFFICIAL_SOURCES
from app.services.ingestion.pipeline import ingest_source

logger = get_logger("app.discovery")

_USER_AGENT = "legal-platform-discovery/0.1 (+contact: platform-team)"
_OAI_NS = "{http://www.openarchives.org/OAI/2.0/}"
_OAI_DC_NS = "{http://www.openarchives.org/OAI/2.0/oai_dc/}"
_DC_NS = "{http://purl.org/dc/elements/1.1/}"


class ProviderDiscoveryError(Exception):
    """A provider found nothing usable this run. Caught by ``run_discovery``
    and recorded against that provider; never raised to the caller."""


@dataclass(frozen=True, slots=True)
class DiscoveredSource:
    provider: str
    external_id: str | None
    title: str
    law_name: str | None
    source_url: str
    document_type: DocumentType
    jurisdiction: str = "IN"
    state_code: str | None = None


class SourceDiscoveryProvider(Protocol):
    name: str

    async def discover(self, *, settings: Settings) -> list[DiscoveredSource]: ...


class CuratedSeedProvider:
    """Wraps the existing hand-verified catalogue so it still flows through
    the same discovery -> catalog -> ingest pipeline as the live providers."""

    name = "curated"

    async def discover(self, *, settings: Settings) -> list[DiscoveredSource]:
        return [
            DiscoveredSource(
                provider=self.name,
                external_id=source.source_url,
                title=source.title,
                law_name=source.law_name,
                source_url=source.source_url,
                document_type=source.document_type,
            )
            for source in OFFICIAL_SOURCES
        ]


class IndiaCodeOaiProvider:
    """Harvests India Code's OAI-PMH feed (``ListRecords``, ``oai_dc``)."""

    name = "india_code_oai"

    async def discover(self, *, settings: Settings) -> list[DiscoveredSource]:
        last_error: Exception | None = None
        async with httpx.AsyncClient(
            timeout=30.0, follow_redirects=True, headers={"User-Agent": _USER_AGENT}
        ) as client:
            for path in settings.india_code_oai_paths:
                base_url = settings.india_code_base_url.rstrip("/") + path
                try:
                    return await self._harvest(client, base_url, settings)
                except (httpx.HTTPError, ET.ParseError) as exc:
                    logger.info("india_code_oai_path_failed", path=base_url, error=str(exc))
                    last_error = exc
                    continue
        raise ProviderDiscoveryError(
            f"No working OAI-PMH endpoint under {settings.india_code_base_url} "
            f"(tried {settings.india_code_oai_paths}): {last_error}"
        )

    async def _harvest(
        self, client: httpx.AsyncClient, base_url: str, settings: Settings
    ) -> list[DiscoveredSource]:
        results: list[DiscoveredSource] = []
        resumption_token: str | None = None
        for _ in range(max(1, settings.india_code_oai_page_limit)):
            if resumption_token:
                params = {"verb": "ListRecords", "resumptionToken": resumption_token}
            else:
                params = {"verb": "ListRecords", "metadataPrefix": "oai_dc"}
                if settings.india_code_oai_set:
                    params["set"] = settings.india_code_oai_set
            response = await client.get(base_url, params=params)
            response.raise_for_status()
            root = ET.fromstring(response.content)
            error_el = root.find(f"{_OAI_NS}error")
            if error_el is not None:
                raise ProviderDiscoveryError(
                    f"OAI endpoint returned an error: {error_el.get('code')} {error_el.text}"
                )
            results.extend(self._parse_records(root))
            token_el = root.find(f".//{_OAI_NS}resumptionToken")
            resumption_token = token_el.text if token_el is not None and token_el.text else None
            if not resumption_token:
                break
        if not results:
            raise ProviderDiscoveryError("OAI endpoint responded but no usable records found.")
        return results

    def _parse_records(self, root: ET.Element) -> list[DiscoveredSource]:
        out: list[DiscoveredSource] = []
        for record in root.iter(f"{_OAI_NS}record"):
            header = record.find(f"{_OAI_NS}header")
            if header is not None and header.get("status") == "deleted":
                continue
            identifier_el = header.find(f"{_OAI_NS}identifier") if header is not None else None
            dc = record.find(f"{_OAI_NS}metadata/{_OAI_DC_NS}dc")
            if dc is None:
                continue
            titles = [el.text for el in dc.findall(f"{_DC_NS}title") if el.text]
            identifiers = [el.text for el in dc.findall(f"{_DC_NS}identifier") if el.text]
            pdf_urls = [i for i in identifiers if i.lower().endswith(".pdf")]
            if not titles or not pdf_urls:
                continue
            out.append(
                DiscoveredSource(
                    provider=self.name,
                    external_id=identifier_el.text if identifier_el is not None else None,
                    title=titles[0][:500],
                    law_name=titles[0][:300],
                    source_url=pdf_urls[0],
                    document_type=DocumentType.ACT,
                )
            )
        return out


class HuggingFaceDatasetProvider:
    """Reads a public HF dataset via the keyless ``datasets-server`` rows API.

    Column names are guessed from several candidates since the dataset's
    exact schema wasn't verifiable from this sandbox (egress-blocked, see
    docs/adr/0011) — if none match, this raises :class:`ProviderDiscoveryError`
    with the raw row keys so an admin can set the right mapping.
    """

    name = "hf_dataset"
    _URL_KEYS = ("source_url", "url", "pdf_url", "download_url", "file_url", "link")
    _TITLE_KEYS = ("title", "law_name", "act_name", "name", "file_name", "filename")
    _STATE_KEYS = ("state_code", "state", "state_name")
    _API_URL = "https://datasets-server.huggingface.co/rows"

    async def discover(self, *, settings: Settings) -> list[DiscoveredSource]:
        results: list[DiscoveredSource] = []
        first_row_keys: list[str] | None = None
        async with httpx.AsyncClient(timeout=30.0, headers={"User-Agent": _USER_AGENT}) as client:
            offset = 0
            while offset < settings.hf_dataset_max_rows:
                length = min(settings.hf_dataset_page_size, settings.hf_dataset_max_rows - offset)
                try:
                    response = await client.get(
                        self._API_URL,
                        params={
                            "dataset": settings.hf_dataset_id,
                            "config": settings.hf_dataset_config,
                            "split": settings.hf_dataset_split,
                            "offset": offset,
                            "length": length,
                        },
                    )
                    response.raise_for_status()
                except httpx.HTTPError as exc:
                    raise ProviderDiscoveryError(
                        f"Could not reach HF datasets-server for '{settings.hf_dataset_id}': {exc}"
                    ) from exc

                payload = response.json()
                rows = payload.get("rows", [])
                if not rows:
                    break
                for item in rows:
                    row = item.get("row") or {}
                    if first_row_keys is None:
                        first_row_keys = list(row.keys())
                    source = self._map_row(row, item.get("row_idx"))
                    if source:
                        results.append(source)
                offset += len(rows)
                if len(rows) < length:
                    break

        if not results:
            raise ProviderDiscoveryError(
                "Dataset responded but no row matched a known title/URL column "
                f"(saw columns: {first_row_keys}). Update HuggingFaceDatasetProvider's "
                "candidate keys to match the dataset's real schema."
            )
        return results

    def _map_row(self, row: dict[str, object], row_idx: int | None) -> DiscoveredSource | None:
        url = next((row[k] for k in self._URL_KEYS if row.get(k)), None)
        title = next((row[k] for k in self._TITLE_KEYS if row.get(k)), None)
        if not url or not title:
            return None
        state_raw = next((row[k] for k in self._STATE_KEYS if row.get(k)), None)
        state_code = None
        if state_raw and str(state_raw).strip().upper() not in {"IN", "CENTRAL", "NATIONAL", ""}:
            state_code = str(state_raw).strip().upper()[:2]
        return DiscoveredSource(
            provider=self.name,
            external_id=str(row_idx) if row_idx is not None else None,
            title=str(title)[:500],
            law_name=str(title)[:300],
            source_url=str(url),
            document_type=DocumentType.ACT,
            state_code=state_code,
        )


PROVIDERS: dict[str, SourceDiscoveryProvider] = {
    "curated": CuratedSeedProvider(),
    "india_code_oai": IndiaCodeOaiProvider(),
    "hf_dataset": HuggingFaceDatasetProvider(),
}


@dataclass(frozen=True, slots=True)
class ProviderRunResult:
    provider: str
    discovered: int
    upserted: int
    error: str | None = None


async def run_discovery(
    *, db: AsyncSession, settings: Settings, provider_names: Sequence[str] | None = None
) -> list[ProviderRunResult]:
    """Run each named provider (default: ``settings.legal_source_discovery_providers``)
    and upsert what it finds into ``legal_source_catalog``. Never raises — a
    provider that fails outright (network, bad schema) gets a ``ProviderRunResult``
    with ``error`` set instead of aborting the whole run.
    """
    names = list(provider_names) if provider_names else settings.legal_source_discovery_providers
    results: list[ProviderRunResult] = []
    for name in names:
        provider = PROVIDERS.get(name)
        if provider is None:
            results.append(
                ProviderRunResult(
                    provider=name,
                    discovered=0,
                    upserted=0,
                    error=f"Unknown discovery provider '{name}'.",
                )
            )
            continue
        try:
            sources = await provider.discover(settings=settings)
        except ProviderDiscoveryError as exc:
            logger.warning("discovery_provider_failed", provider=name, error=str(exc))
            results.append(
                ProviderRunResult(provider=name, discovered=0, upserted=0, error=str(exc))
            )
            continue
        upserted = await _upsert_catalog_entries(db, sources)
        logger.info("discovery_provider_completed", provider=name, discovered=len(sources))
        results.append(ProviderRunResult(provider=name, discovered=len(sources), upserted=upserted))
    return results


async def _upsert_catalog_entries(db: AsyncSession, sources: list[DiscoveredSource]) -> int:
    count = 0
    for source in sources:
        stmt = (
            pg_insert(LegalSourceCatalogEntry)
            .values(
                provider=source.provider,
                external_id=source.external_id,
                title=source.title,
                law_name=source.law_name,
                source_url=source.source_url,
                document_type=source.document_type,
                jurisdiction=source.jurisdiction,
                state_code=source.state_code,
            )
            .on_conflict_do_update(
                index_elements=[LegalSourceCatalogEntry.source_url],
                set_={
                    "title": source.title,
                    "law_name": source.law_name,
                    "last_seen_at": func.now(),
                },
            )
        )
        await db.execute(stmt)
        count += 1
    await db.commit()
    return count


async def ingest_catalog_entry(
    *, db: AsyncSession, settings: Settings, entry: LegalSourceCatalogEntry
) -> LegalSourceCatalogEntry:
    """Run a catalog entry through the normal ingestion pipeline and record
    the outcome on the entry itself (mirrors ``LegalDocument.ingestion_status``
    rather than duplicating its error-reporting shape)."""
    document = await ingest_source(
        db=db,
        settings=settings,
        title=entry.title,
        source_url=entry.source_url,
        document_type=entry.document_type,
        law_name=entry.law_name,
        jurisdiction=entry.jurisdiction,
        state_code=entry.state_code,
    )
    entry.status = (
        CatalogEntryStatus.INGESTED
        if document.ingestion_status == IngestionStatus.COMPLETED
        else CatalogEntryStatus.INVALID
    )
    entry.ingested_document_id = document.id
    entry.notes = document.ingestion_error
    await db.commit()
    await db.refresh(entry)
    return entry
