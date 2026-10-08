"""One-off work run in the background when the API starts.

Failures are logged, never raised: a bad CSV or a database hiccup must not
stop the API from serving.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy import select

from app.core import security
from app.core.config import Settings
from app.core.logging import get_logger
from app.db.session import get_sessionmaker
from app.models.user import User, UserRole
from app.services import advocate_import
from app.services.ingestion import hf_dataset

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
    report = await advocate_import.import_csv_file(path, is_sample=settings.advocates_csv_is_sample)
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


@dataclass(slots=True)
class CorpusLoadState:
    """Progress of the background legal-corpus load, shown on /status."""

    state: str = "not_started"  # not_started | disabled | running | done | failed
    dataset: str | None = None
    message: str | None = None
    updated_at: datetime | None = None

    def set(self, state: str, message: str | None = None) -> None:
        self.state = state
        self.message = message
        self.updated_at = datetime.now(UTC)


corpus_load = CorpusLoadState()


async def load_legal_corpus(settings: Settings) -> None:
    """Bring the Hugging Face legal corpus up to HF_MAX_DOCUMENTS, then embed
    chunks that have no embedding yet. Never raises: failures are reported
    on /status and the API keeps serving (chat says when nothing relevant was
    retrieved)."""
    corpus_load.dataset = settings.hf_dataset_name or None
    if not settings.legal_corpus_autoload or not settings.hf_dataset_name:
        corpus_load.set("disabled", "LEGAL_CORPUS_AUTOLOAD is off or HF_DATASET_NAME is empty.")
        return
    sessions = get_sessionmaker()
    if settings.hf_max_documents > 0:
        async with sessions() as db:
            indexed = await hf_dataset.count_indexed(db, settings.hf_dataset_name)
        if indexed < settings.hf_max_documents:
            corpus_load.set(
                "running",
                f"Loading documents from {settings.hf_dataset_name} "
                f"({indexed} of {settings.hf_max_documents} indexed).",
            )
            try:
                async with hf_dataset.HFClient(settings.hf_token) as client:
                    info, report = await hf_dataset.ingest_dataset(
                        settings=settings,
                        session_factory=sessions,
                        client=client,
                        name=settings.hf_dataset_name,
                        config=settings.hf_dataset_config,
                        split=settings.hf_dataset_split,
                        data_file=settings.hf_dataset_file,
                        max_documents=settings.hf_max_documents,
                        batch_size=settings.hf_batch_size,
                    )
            except hf_dataset.HFDatasetError as exc:
                corpus_load.set("failed", str(exc)[:500])
                logger.warning("legal_corpus_load_failed", error=str(exc)[:500])
                return
            logger.info(
                "legal_corpus_loaded",
                dataset=info.name,
                source=info.source_key,
                added=report.added,
                updated=report.updated,
                skipped=report.skipped,
                chunks=report.chunks,
                notes=report.notes,
            )
            indexed = report.already_indexed + report.added
        message = f"{indexed} documents from {settings.hf_dataset_name} indexed."
    else:
        message = "HF_MAX_DOCUMENTS is 0: no documents loaded."

    if settings.legal_corpus_embed_on_start and settings.gemini_api_key:
        corpus_load.set("running", message + " Embedding chunks for semantic search.")
        embedded, stopped = await hf_dataset.embed_missing(
            settings=settings, session_factory=sessions
        )
        logger.info("legal_corpus_embedded", embedded=embedded, stopped=stopped)
        if stopped:
            message += f" Embedded {embedded} chunks, then stopped: {stopped} (resumes next start)."
        elif embedded:
            message += f" Embedded {embedded} chunks."
    corpus_load.set("done", message)


async def run_startup_tasks(settings: Settings) -> None:
    for task in (ensure_bootstrap_admin, seed_advocates):
        try:
            await task(settings)
        except Exception as exc:
            logger.warning("startup_task_failed", task=task.__name__, error=str(exc)[:500])
    try:
        await load_legal_corpus(settings)
    except Exception as exc:
        corpus_load.set("failed", f"{type(exc).__name__}: {str(exc)[:300]}")
        logger.warning("startup_task_failed", task="load_legal_corpus", error=str(exc)[:500])
