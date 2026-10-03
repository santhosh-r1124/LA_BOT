"""Run legal-source discovery providers and bulk-ingest what they find.

Replaces hand-typing sources into ``official_sources.py`` with a pipeline
that can grow the knowledge base — including state-level Acts — without a
code change. See ``app/services/ingestion/discovery.py`` and
docs/adr/0011-dynamic-source-discovery.md.

Needs ``GEMINI_API_KEY`` for embeddings (same as ``kb:seed``) and network
access to whichever providers you run — India Code and Hugging Face must be
reachable, which a sandboxed/offline environment typically blocks; see the
ADR for what to do when discovery finds nothing because of that.

Usage::

    uv run python -m app.scripts.discover_corpus                       # discover only
    uv run python -m app.scripts.discover_corpus --providers curated   # one provider
    uv run python -m app.scripts.discover_corpus --ingest --limit 50   # discover + ingest
    uv run python -m app.scripts.discover_corpus --ingest --state-code MH
"""

from __future__ import annotations

import argparse
import asyncio
import sys

from sqlalchemy import select

from app.core.config import get_settings
from app.db.session import dispose_engine, get_sessionmaker
from app.models.legal_source_catalog import CatalogEntryStatus, LegalSourceCatalogEntry
from app.services.ingestion.discovery import ingest_catalog_entry, run_discovery


async def _discover(providers: list[str] | None) -> int:
    settings = get_settings()
    async with get_sessionmaker()() as db:
        results = await run_discovery(db=db, settings=settings, provider_names=providers)

    failures = 0
    for r in results:
        if r.error:
            failures += 1
            print(f"  ✗ {r.provider}: {r.error}")
        else:
            print(f"  ✓ {r.provider}: {r.discovered} discovered, {r.upserted} upserted")
    return failures


async def _ingest(
    jurisdiction: str | None, state_code: str | None, provider: str | None, limit: int
) -> int:
    settings = get_settings()
    if not settings.gemini_api_key:
        print("GEMINI_API_KEY is not set — embeddings are required to index sources.")
        print("Get a free key at https://aistudio.google.com/apikey and add it to apps/api/.env")
        return 2

    async with get_sessionmaker()() as db:
        stmt = select(LegalSourceCatalogEntry).where(
            LegalSourceCatalogEntry.status == CatalogEntryStatus.NEW
        )
        if jurisdiction:
            stmt = stmt.where(LegalSourceCatalogEntry.jurisdiction == jurisdiction)
        if state_code:
            stmt = stmt.where(LegalSourceCatalogEntry.state_code == state_code)
        if provider:
            stmt = stmt.where(LegalSourceCatalogEntry.provider == provider)
        entries = (await db.execute(stmt.limit(limit))).scalars().all()

        print(f"Ingesting {len(entries)} catalog entr{'y' if len(entries) == 1 else 'ies'}…\n")
        failures = 0
        for entry in entries:
            print(f"  ingest   {entry.title} …", flush=True)
            entry = await ingest_catalog_entry(db=db, settings=settings, entry=entry)
            if entry.status == CatalogEntryStatus.INGESTED:
                print("           ✓ ingested")
            else:
                failures += 1
                print(f"           ✗ FAILED: {entry.notes}")
    return failures


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Discover (and optionally ingest) Indian legal sources dynamically."
    )
    parser.add_argument("--providers", nargs="+", help="Discovery providers to run (default: all).")
    parser.add_argument("--ingest", action="store_true", help="Also bulk-ingest NEW catalog rows.")
    parser.add_argument("--jurisdiction", help="Filter ingestion to this jurisdiction (e.g. IN).")
    parser.add_argument("--state-code", help="Filter ingestion to this ISO-3166-2:IN state code.")
    parser.add_argument("--provider", help="Filter ingestion to catalog rows from this provider.")
    parser.add_argument("--limit", type=int, default=25, help="Max entries to ingest in one run.")
    args = parser.parse_args()

    async def _run() -> int:
        print("Running discovery…\n")
        failures = await _discover(args.providers)
        if args.ingest:
            print()
            failures += await _ingest(args.jurisdiction, args.state_code, args.provider, args.limit)
        await dispose_engine()
        return 1 if failures else 0

    sys.exit(asyncio.run(_run()))


if __name__ == "__main__":
    main()
