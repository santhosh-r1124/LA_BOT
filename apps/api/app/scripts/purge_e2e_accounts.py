"""Delete the accounts one browser-E2E run created (e2e/global-teardown.ts).

Matches only ``e2e-<role>-<run_id>@example.com`` for the exact run id, and
refuses to run when ``APP_ENV=production``. Deleting a user cascades to
their consultations, payments and notifications; audit rows keep their
history with ``actor_id`` nulled.

    uv run python -m app.scripts.purge_e2e_accounts --run-id <id>
"""

from __future__ import annotations

import argparse
import asyncio
import re
import sys

from sqlalchemy import delete

from app.core.config import get_settings
from app.db.session import dispose_engine, get_sessionmaker
from app.models.user import User


async def _purge(run_id: str) -> int:
    async with get_sessionmaker()() as db:
        result = await db.execute(
            delete(User).where(User.email.like(f"e2e-%-{run_id}@example.com"))
        )
        await db.commit()
    await dispose_engine()
    return int(result.rowcount or 0)  # type: ignore[attr-defined]


def main() -> None:
    parser = argparse.ArgumentParser(description="Delete one E2E run's test accounts.")
    parser.add_argument("--run-id", required=True)
    args = parser.parse_args()

    if get_settings().app_env.is_production:
        sys.exit("Refusing to purge accounts in production.")
    if not re.fullmatch(r"[a-z0-9]{4,20}", args.run_id):
        sys.exit("run id must be 4-20 lowercase alphanumerics.")
    print(f"Purged {asyncio.run(_purge(args.run_id))} E2E account(s).")


if __name__ == "__main__":
    main()
