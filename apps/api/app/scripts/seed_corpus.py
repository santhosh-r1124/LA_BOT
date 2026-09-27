"""Load the official Indian legal sources into the knowledge base.

Runs every source in ``app.services.ingestion.official_sources`` through the
normal ingestion pipeline (fetch -> extract -> clean -> chunk -> embed ->
persist). Until this has been run, chat correctly answers "insufficient
verified information" for almost everything — the knowledge base is empty.

Needs ``GEMINI_API_KEY`` (free tier) for embeddings and network access to the
government hosts. Idempotent: sources already ``COMPLETED`` are skipped.

Usage::

    uv run python -m app.scripts.seed_corpus                 # everything missing
    uv run python -m app.scripts.seed_corpus --only it ip    # by area
    uv run python -m app.scripts.seed_corpus --retry-failed  # re-run FAILED rows
    uv run python -m app.scripts.seed_corpus --list          # show the catalogue
"""

from __future__ import annotations

import argparse
import asyncio
import sys

from sqlalchemy import select

from app.core.config import get_settings
from app.db.session import dispose_engine, get_sessionmaker
from app.models.legal_document import IngestionStatus, LegalDocument
from app.services.ingestion.official_sources import OFFICIAL_SOURCES, OfficialSource
from app.services.ingestion.pipeline import ingest_source, reingest_source


def _selected(areas: list[str] | None) -> list[OfficialSource]:
    if not areas:
        return list(OFFICIAL_SOURCES)
    return [s for s in OFFICIAL_SOURCES if s.area in areas]


async def _run(areas: list[str] | None, retry_failed: bool) -> int:
    settings = get_settings()
    if not settings.gemini_api_key:
        print("GEMINI_API_KEY is not set — embeddings are required to index sources.")
        print("Get a free key at https://aistudio.google.com/apikey and add it to apps/api/.env")
        return 2

    failures = 0
    sources = _selected(areas)
    print(f"Seeding {len(sources)} official source(s)…\n")
    for source in sources:
        async with get_sessionmaker()() as db:
            existing = await db.scalar(
                select(LegalDocument).where(LegalDocument.source_url == source.source_url)
            )
            if existing is not None and existing.ingestion_status == IngestionStatus.COMPLETED:
                print(f"  skip     {source.title} ({existing.chunk_count} chunks already indexed)")
                continue
            if existing is not None and not retry_failed:
                print(
                    f"  skip     {source.title} (status {existing.ingestion_status.value}; "
                    "use --retry-failed)"
                )
                continue

            print(f"  ingest   {source.title} …", flush=True)
            if existing is not None:
                document = await reingest_source(db=db, settings=settings, document=existing)
            else:
                document = await ingest_source(
                    db=db,
                    settings=settings,
                    title=source.title,
                    source_url=source.source_url,
                    document_type=source.document_type,
                    law_name=source.law_name,
                )
            if document.ingestion_status == IngestionStatus.COMPLETED:
                print(f"           ✓ {document.chunk_count} chunks")
            else:
                failures += 1
                print(f"           ✗ FAILED: {document.ingestion_error}")

    await dispose_engine()
    print(f"\nDone — {len(sources) - failures} ok / skipped, {failures} failed.")
    return 1 if failures else 0


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed the legal knowledge base.")
    areas = sorted({s.area for s in OFFICIAL_SOURCES})
    parser.add_argument("--only", nargs="+", choices=areas, help="Limit to these areas.")
    parser.add_argument("--retry-failed", action="store_true", help="Re-run FAILED sources.")
    parser.add_argument("--list", action="store_true", help="Print the catalogue and exit.")
    args = parser.parse_args()

    if args.list:
        for s in _selected(args.only):
            print(f"[{s.area:<12}] {s.title}\n               {s.source_url}")
        return

    sys.exit(asyncio.run(_run(args.only, args.retry_failed)))


if __name__ == "__main__":
    main()
