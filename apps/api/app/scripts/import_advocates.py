"""Import advocates from a CSV file into the public directory.

Usage::

    uv run python -m app.scripts.import_advocates data/advocates.csv
    uv run python -m app.scripts.import_advocates new.csv --dry-run

See ``app.services.advocate_import`` for the accepted columns. The API also
imports ``ADVOCATES_CSV_PATH`` (default ``data/advocates.csv``) on every start.
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

from app.db.session import dispose_engine, get_sessionmaker
from app.services import advocate_import


async def _run(path: Path, dry_run: bool) -> int:
    text = await asyncio.to_thread(path.read_text, encoding="utf-8-sig")
    try:
        async with get_sessionmaker()() as db:
            report = await advocate_import.import_csv_text(db, text)
            if dry_run:
                await db.rollback()
            else:
                await db.commit()
    except advocate_import.CsvFormatError as exc:
        print(f"Can't import {path}: {exc}")
        return 2
    finally:
        await dispose_engine()
    print(("[dry run] " if dry_run else "") + advocate_import.summarize(report))
    return 1 if report.failed else 0


def main() -> None:
    parser = argparse.ArgumentParser(description="Import advocates from a CSV file.")
    parser.add_argument("path", type=Path)
    parser.add_argument("--dry-run", action="store_true", help="Validate without saving.")
    args = parser.parse_args()
    sys.exit(asyncio.run(_run(args.path, args.dry_run)))


if __name__ == "__main__":
    main()
