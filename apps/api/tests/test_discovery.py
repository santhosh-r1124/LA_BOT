"""Tests for dynamic legal-source discovery (docs/adr/0011). Needs Postgres
for the catalog-table tests; the provider-level ones are pure unit tests.
"""

from __future__ import annotations

import httpx
import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.core import security
from app.core.config import Settings, get_settings
from app.models.legal_source_catalog import CatalogEntryStatus, LegalSourceCatalogEntry
from app.models.user import User, UserRole
from app.services.ingestion.discovery import (
    CuratedSeedProvider,
    HuggingFaceDatasetProvider,
    IndiaCodeOaiProvider,
    ProviderDiscoveryError,
    run_discovery,
)
from app.services.ingestion.official_sources import OFFICIAL_SOURCES
from tests.conftest import unique_email


async def _admin_headers(db_txn_session: object) -> dict[str, str]:
    user = User(
        email=unique_email("admin"),
        hashed_password=security.hash_password("irrelevant-not-logged-in-with"),
        role=UserRole.ADMIN,
        email_verified=True,
    )
    db_txn_session.add(user)  # type: ignore[attr-defined]
    await db_txn_session.flush()  # type: ignore[attr-defined]
    token = security.create_access_token(
        user_id=user.id, role=UserRole.ADMIN.value, settings=get_settings()
    )
    return {"Authorization": f"Bearer {token}"}


# ---------------------------------------------------------------------------
# Providers (no DB)
# ---------------------------------------------------------------------------


async def test_curated_provider_mirrors_official_sources() -> None:
    sources = await CuratedSeedProvider().discover(settings=get_settings())
    assert len(sources) == len(OFFICIAL_SOURCES)
    assert {s.source_url for s in sources} == {s.source_url for s in OFFICIAL_SOURCES}
    assert all(s.provider == "curated" for s in sources)


async def test_india_code_oai_provider_raises_discovery_error_when_unreachable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_get(self: object, url: str, params: dict | None = None) -> httpx.Response:
        raise httpx.ConnectError("blocked", request=httpx.Request("GET", url))

    monkeypatch.setattr(httpx.AsyncClient, "get", fake_get)
    settings = get_settings()
    with pytest.raises(ProviderDiscoveryError):
        await IndiaCodeOaiProvider().discover(settings=settings)


async def test_india_code_oai_provider_parses_oai_dc_records(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    body = b"""<?xml version="1.0" encoding="UTF-8"?>
<OAI-PMH xmlns="http://www.openarchives.org/OAI/2.0/">
  <ListRecords>
    <record>
      <header><identifier>oai:indiacode:123</identifier></header>
      <metadata>
        <oai_dc:dc xmlns:oai_dc="http://www.openarchives.org/OAI/2.0/oai_dc/"
                    xmlns:dc="http://purl.org/dc/elements/1.1/">
          <dc:title>The Sample Act, 2024</dc:title>
          <dc:identifier>https://www.indiacode.nic.in/bitstream/x/sample.pdf</dc:identifier>
        </oai_dc:dc>
      </metadata>
    </record>
  </ListRecords>
</OAI-PMH>"""

    async def fake_get(self: object, url: str, params: dict | None = None) -> httpx.Response:
        return httpx.Response(200, content=body, request=httpx.Request("GET", url))

    monkeypatch.setattr(httpx.AsyncClient, "get", fake_get)
    sources = await IndiaCodeOaiProvider().discover(settings=get_settings())
    assert len(sources) == 1
    assert sources[0].title == "The Sample Act, 2024"
    assert sources[0].source_url.endswith("sample.pdf")
    assert sources[0].provider == "india_code_oai"


async def test_hf_dataset_provider_maps_known_columns(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_get(self: object, url: str, params: dict | None = None) -> httpx.Response:
        payload = {
            "rows": [
                {
                    "row_idx": 0,
                    "row": {
                        "title": "Maharashtra Stamp Act",
                        "url": "https://archive.org/download/x/maharashtra-stamp-act.pdf",
                        "state": "MH",
                    },
                }
            ]
        }
        return httpx.Response(200, json=payload, request=httpx.Request("GET", url))

    monkeypatch.setattr(httpx.AsyncClient, "get", fake_get)
    sources = await HuggingFaceDatasetProvider().discover(settings=get_settings())
    assert len(sources) == 1
    assert sources[0].state_code == "MH"
    assert sources[0].title == "Maharashtra Stamp Act"


async def test_hf_dataset_provider_raises_on_unrecognized_schema(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_get(self: object, url: str, params: dict | None = None) -> httpx.Response:
        payload = {"rows": [{"row_idx": 0, "row": {"totally_unexpected_column": "value"}}]}
        return httpx.Response(200, json=payload, request=httpx.Request("GET", url))

    monkeypatch.setattr(httpx.AsyncClient, "get", fake_get)
    with pytest.raises(ProviderDiscoveryError):
        await HuggingFaceDatasetProvider().discover(settings=get_settings())


# ---------------------------------------------------------------------------
# run_discovery + catalog (DB)
# ---------------------------------------------------------------------------


async def test_run_discovery_upserts_curated_sources_and_is_idempotent(
    db_txn_session: object,
) -> None:
    settings = get_settings()
    results = await run_discovery(db=db_txn_session, settings=settings, provider_names=["curated"])
    assert len(results) == 1
    assert results[0].error is None
    assert results[0].discovered == len(OFFICIAL_SOURCES)

    rows = (
        (await db_txn_session.execute(select(LegalSourceCatalogEntry)))  # type: ignore[attr-defined]
        .scalars()
        .all()
    )
    assert len(rows) == len(OFFICIAL_SOURCES)
    assert all(r.status == CatalogEntryStatus.NEW for r in rows)

    # Re-running must not create duplicates (ON CONFLICT (source_url) DO UPDATE).
    await run_discovery(db=db_txn_session, settings=settings, provider_names=["curated"])
    rows_again = (
        (await db_txn_session.execute(select(LegalSourceCatalogEntry)))  # type: ignore[attr-defined]
        .scalars()
        .all()
    )
    assert len(rows_again) == len(OFFICIAL_SOURCES)


async def test_run_discovery_records_unknown_provider_without_raising(
    db_txn_session: object,
) -> None:
    results = await run_discovery(
        db=db_txn_session, settings=get_settings(), provider_names=["does_not_exist"]
    )
    assert len(results) == 1
    assert results[0].error is not None
    assert "does_not_exist" in results[0].error


async def test_run_discovery_one_bad_provider_does_not_block_others(
    db_txn_session: object, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def fake_get(self: object, url: str, params: dict | None = None) -> httpx.Response:
        raise httpx.ConnectError("blocked", request=httpx.Request("GET", url))

    monkeypatch.setattr(httpx.AsyncClient, "get", fake_get)
    results = await run_discovery(
        db=db_txn_session,
        settings=get_settings(),
        provider_names=["india_code_oai", "curated"],
    )
    by_provider = {r.provider: r for r in results}
    assert by_provider["india_code_oai"].error is not None
    assert by_provider["curated"].error is None
    assert by_provider["curated"].discovered == len(OFFICIAL_SOURCES)


# ---------------------------------------------------------------------------
# Admin HTTP endpoints
# ---------------------------------------------------------------------------


async def test_discover_endpoint_requires_admin(db_client: AsyncClient) -> None:
    resp = await db_client.post("/api/v1/admin/legal-sources/discover")
    assert resp.status_code == 401


async def test_discover_and_list_catalog_endpoints(
    db_client: AsyncClient, db_txn_session: object
) -> None:
    headers = await _admin_headers(db_txn_session)

    resp = await db_client.post(
        "/api/v1/admin/legal-sources/discover",
        params={"providers": ["curated"]},
        headers=headers,
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["results"][0]["provider"] == "curated"
    assert body["results"][0]["discovered"] == len(OFFICIAL_SOURCES)

    resp = await db_client.get("/api/v1/admin/legal-sources/catalog", headers=headers)
    assert resp.status_code == 200, resp.text
    catalog = resp.json()
    assert catalog["total"] == len(OFFICIAL_SOURCES)
    assert all(item["status"] == "NEW" for item in catalog["items"])


async def test_ingest_one_catalog_entry(
    db_client: AsyncClient, db_txn_session: object, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.services.ingestion import pipeline as pipeline_module
    from app.services.ingestion.chunk import Chunk
    from app.services.ingestion.fetch import FetchedDocument

    async def fake_fetch(url: str, *, settings: Settings) -> FetchedDocument:
        return FetchedDocument(
            url=url, content_type="application/pdf", raw_bytes=b"x", checksum="abc"
        )

    monkeypatch.setattr(pipeline_module, "fetch_document", fake_fetch)
    monkeypatch.setattr(pipeline_module, "extract_text", lambda document: "text")
    monkeypatch.setattr(pipeline_module, "clean_document_text", lambda raw: raw)
    monkeypatch.setattr(
        pipeline_module,
        "chunk_document",
        lambda text, *, max_chars, overlap_chars: [
            Chunk(content="body", section=None, article=None, page_number=1)
        ],
    )

    async def fake_embed(texts: list[str], *, settings: Settings) -> list[list[float]]:
        return [[0.01] * 768 for _ in texts]

    monkeypatch.setattr(pipeline_module, "embed_texts", fake_embed)

    headers = await _admin_headers(db_txn_session)
    await run_discovery(db=db_txn_session, settings=get_settings(), provider_names=["curated"])
    entry = (
        await db_txn_session.execute(select(LegalSourceCatalogEntry).limit(1))  # type: ignore[attr-defined]
    ).scalar_one()

    resp = await db_client.post(
        f"/api/v1/admin/legal-sources/catalog/{entry.id}/ingest", headers=headers
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "INGESTED"
    assert body["ingested_document_id"] is not None

    # A second ingest attempt on the same entry is rejected, not duplicated.
    resp = await db_client.post(
        f"/api/v1/admin/legal-sources/catalog/{entry.id}/ingest", headers=headers
    )
    assert resp.status_code == 422
