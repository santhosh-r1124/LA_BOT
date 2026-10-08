"""One-off work run in the background when the API starts.

Failures are logged, never raised: a bad CSV or a database hiccup must not
stop the API from serving.
"""

from __future__ import annotations

import asyncio
from pathlib import Path

from sqlalchemy import select

from app.core import security
from app.core.config import Settings
from app.core.logging import get_logger
from app.db.session import get_sessionmaker
from app.models.user import User, UserRole
from app.services import advocate_import

logger = get_logger("app.startup")


async def ensure_bootstrap_admin(settings: Settings) -> None:
    if not settings.admin_email or not settings.admin_password:
        return
    email = settings.admin_email.strip().lower()
    async with get_sessionmaker()() as db:
        user = await db.scalar(select(User).where(User.email == email))
        if user is None:
            db.add(
                User(
                    email=email,
                    hashed_password=security.hash_password(settings.admin_password),
                    role=UserRole.ADMIN,
                    display_name="Administrator",
                    email_verified=True,
                )
            )
            logger.info("bootstrap_admin_created")
        else:
            if user.role not in (UserRole.ADMIN, UserRole.LEGAL_ADMIN):
                user.role = UserRole.ADMIN
            if not security.verify_password(settings.admin_password, user.hashed_password):
                user.hashed_password = security.hash_password(settings.admin_password)
            user.is_active = True
            user.email_verified = True
        await db.commit()


async def seed_advocates(settings: Settings) -> None:
    if not settings.advocates_csv_path:
        return
    path = Path(settings.advocates_csv_path)
    if not await asyncio.to_thread(path.is_file):
        logger.info("advocates_csv_missing", path=str(path))
        return
    report = await advocate_import.import_csv_file(path)
    logger.info(
        "advocates_csv_imported",
        path=str(path),
        total=report.total_rows,
        created=report.created,
        updated=report.updated,
        unchanged=report.unchanged,
        skipped=report.failed,
        first_errors=[f"line {e.line}: {e.message}" for e in report.errors[:5]],
    )


async def run_startup_tasks(settings: Settings) -> None:
    for task in (ensure_bootstrap_admin, seed_advocates):
        try:
            await task(settings)
        except Exception as exc:
            logger.warning("startup_task_failed", task=task.__name__, error=str(exc)[:500])
