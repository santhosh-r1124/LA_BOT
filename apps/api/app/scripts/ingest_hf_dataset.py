"""Load real Indian legal documents from a Hugging Face dataset.

Usage::

    uv run python -m app.scripts.ingest_hf_dataset --inspect          # look before loading
    uv run python -m app.scripts.ingest_hf_dataset                    # HF_MAX_DOCUMENTS docs
    uv run python -m app.scripts.ingest_hf_dataset --max-documents 500
    uv run python -m app.scripts.ingest_hf_dataset --embed-missing    # vectors for new chunks

Defaults come from the HF_* settings (see .env.example). Re-running is safe:
documents already indexed are skipped, a larger ``--max-documents``
continues where the previous run stopped, ``--from-start`` re-reads from the
first row and refreshes anything that changed. The API runs the same load in
the background on start (``LEGAL_CORPUS_AUTOLOAD``).

Exit codes: 0 done, 1 finished with problems, 2 the dataset couldn't be read.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
import textwrap

from app.core.config import Settings, get_settings
from app.db.session import dispose_engine, get_sessionmaker
from app.services.ingestion import hf_dataset


def _size(num_bytes: int | None) -> str:
    if num_bytes is None:
        return "unknown"
    value = float(num_bytes)
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if value < 1024 or unit == "TB":
            return f"{value:.1f} {unit}"
        value /= 1024
    return f"{num_bytes} B"  # pragma: no cover


def _print_info(info: hf_dataset.DatasetInfo) -> None:
    print(f"Dataset:   {info.name}  ({info.url})")
    if info.requested_name:
        print(f"           (requested as {info.requested_name}; the repo was renamed)")
    print(f"License:   {info.license or 'NOT DECLARED - check the dataset card before use'}")
    print(f"Gated:     {'yes (needs HF_TOKEN)' if info.gated else 'no'}")
    if info.file:
        print(f"Source:    file {info.file}")
        if info.viewer_error:
            print(f"           (dataset viewer not usable: {info.viewer_error[:160]})")
    else:
        print(f"Source:    dataset viewer, config={info.config} split={info.split}")
    print(f"Rows:      {info.num_rows if info.num_rows is not None else 'unknown'}")
    print(f"Size:      {_size(info.size_bytes)}")
    print("Columns:   " + ", ".join(f"{k} ({v})" for k, v in info.features.items()))
    f = info.fields
    print(
        "Mapping:   "
        f"text={f.text} title={f.title} id={f.id} court={f.court} date={f.date} "
        f"citation={f.citation}"
    )
    print("Sample rows (as stored):")
    for i, row in enumerate(info.sample[:3]):
        doc = hf_dataset.normalize_row(info, i, row)
        if doc is None:
            print(f"  - row {i}: skipped (text shorter than 200 characters)")
            continue
        meta = {
            k: doc.metadata[k]
            for k in ("case_name", "court", "date", "citation")
            if k in doc.metadata
        }
        print(f"  - {doc.title[:100]}")
        print(f"    {json.dumps(meta, ensure_ascii=False, default=str)[:300]}")
        snippet = " ".join(doc.text.split())[:240]
        print(textwrap.indent(textwrap.fill(snippet, 96), "    | "))


async def _inspect(settings: Settings, args: argparse.Namespace) -> int:
    async with hf_dataset.HFClient(settings.hf_token) as client:
        info = await hf_dataset.inspect_dataset(
            client,
            args.dataset,
            config=args.config,
            split=args.split,
            data_file=args.file,
            text_field=settings.hf_text_field,
            title_field=settings.hf_title_field,
        )
    _print_info(info)
    return 0


async def _ingest(settings: Settings, args: argparse.Namespace) -> int:
    def progress(report: hf_dataset.IngestReport) -> None:
        print(
            f"  read {report.rows_read} rows: +{report.added} added, {report.updated} updated, "
            f"{report.unchanged} unchanged, {report.skipped} skipped",
            flush=True,
        )

    async with hf_dataset.HFClient(settings.hf_token) as client:
        info, report = await hf_dataset.ingest_dataset(
            settings=settings,
            session_factory=get_sessionmaker(),
            client=client,
            name=args.dataset,
            config=args.config,
            split=args.split,
            data_file=args.file,
            max_documents=args.max_documents,
            batch_size=args.batch_size,
            from_start=args.from_start,
            on_progress=progress,
        )
    _print_info(info) if args.verbose else print(f"Dataset: {info.name} ({info.source_key})")
    print(
        f"Done. {report.added} added, {report.updated} updated, {report.unchanged} unchanged, "
        f"{report.skipped} rows skipped. {report.already_indexed + report.added} documents and "
        f"{report.chunks} chunks from {info.name} are now indexed."
    )
    for note in report.notes:
        print(f"Note: {note}")
    if not info.license:
        print("Warning: the dataset declares no license; check its terms before relying on it.")
    return 0


async def _embed(settings: Settings, args: argparse.Namespace) -> int:
    if not settings.gemini_api_key:
        print("GEMINI_API_KEY is not set: embeddings need it. Keyword search works without.")
        return 1
    embedded, stopped = await hf_dataset.embed_missing(
        settings=settings, session_factory=get_sessionmaker(), limit=args.limit
    )
    print(f"Embedded {embedded} chunks.")
    if stopped:
        print(f"Stopped early: {stopped}. Run the command again later to continue.")
        return 1
    return 0


async def _run(args: argparse.Namespace) -> int:
    settings = get_settings()
    try:
        if args.inspect:
            return await _inspect(settings, args)
        if args.embed_missing:
            return await _embed(settings, args)
        return await _ingest(settings, args)
    except hf_dataset.HFDatasetError as exc:
        print(f"Could not read {args.dataset}: {exc}")
        return 2
    finally:
        await dispose_engine()


def main() -> None:
    settings = get_settings()
    parser = argparse.ArgumentParser(
        description="Load Indian legal documents from a Hugging Face dataset."
    )
    parser.add_argument("--dataset", default=settings.hf_dataset_name, help="owner/name")
    parser.add_argument("--config", default=settings.hf_dataset_config)
    parser.add_argument("--split", default=settings.hf_dataset_split)
    parser.add_argument(
        "--file", default=settings.hf_dataset_file, help="parquet/.jsonl file in the repo"
    )
    parser.add_argument("--max-documents", type=int, default=settings.hf_max_documents)
    parser.add_argument("--batch-size", type=int, default=settings.hf_batch_size)
    parser.add_argument("--from-start", action="store_true", help="Re-read from the first row.")
    parser.add_argument("--inspect", action="store_true", help="Show the dataset, load nothing.")
    parser.add_argument(
        "--embed-missing", action="store_true", help="Embed chunks that have no embedding."
    )
    parser.add_argument("--limit", type=int, help="With --embed-missing: at most N chunks.")
    parser.add_argument("-v", "--verbose", action="store_true")
    args = parser.parse_args()
    if args.max_documents < 0 or not 1 <= args.batch_size <= 100:
        parser.error("--max-documents must be >= 0 and --batch-size between 1 and 100")
    sys.exit(asyncio.run(_run(args)))


if __name__ == "__main__":
    main()
