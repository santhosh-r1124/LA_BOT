"""Service metadata + capability status — safe, unauthenticated, used by the
frontends to show *real* availability instead of assuming features work."""

from __future__ import annotations

import time
from datetime import UTC, datetime

from fastapi import APIRouter
from pydantic import BaseModel
from sqlalchemy import func, select

from app.api.deps import DbSession, SettingsDep
from app.core.errors import ServiceUnavailableError
from app.core.logging import get_logger
from app.models.legal_document import IngestionStatus, LegalDocument
from app.models.user import AdvocateProfile, VerificationStatus
from app.services.llm_provider import describe_provider, get_provider, provider_health
from app.services.rate_limit import AIRateLimit

router = APIRouter()
logger = get_logger("app.meta")


class MetaResponse(BaseModel):
    name: str
    version: str
    environment: str


@router.get("/meta", summary="Service name, version and environment")
async def read_meta(settings: SettingsDep) -> MetaResponse:
    return MetaResponse(
        name=settings.app_name,
        version=settings.version,
        environment=settings.app_env.value,
    )


class LLMStatus(BaseModel):
    configured: bool
    provider: str | None
    model: str | None
    is_free_tier: bool | None
    # Outcome of the most recent real model call since the server started
    # (null until the first one). No probe calls are made for this.
    last_call_ok: bool | None = None
    last_call_at: datetime | None = None
    last_error_code: str | None = None
    last_error_message: str | None = None


class EmbeddingStatus(BaseModel):
    configured: bool
    model: str | None


class KnowledgeBaseStatus(BaseModel):
    available: bool
    """False when the database couldn't be queried — counts are then null."""
    documents_indexed: int | None
    documents_failed: int | None
    chunks_indexed: int | None
    last_indexed_at: datetime | None


class DirectoryStatus(BaseModel):
    available: bool
    verified_advocates: int | None


class FeatureFlags(BaseModel):
    open_login: bool
    """Any email/password signs in (demo mode) — the login page says so."""
    general_answers: bool
    """Unsourced chat replies are general-knowledge answers, not refusals."""


class StatusResponse(BaseModel):
    """Every field is read from configuration or the database at request
    time — nothing here is a placeholder. ``configured`` means a key/URL is
    set; it does not prove the upstream provider is currently reachable
    (checking that would spend free-tier quota on every page view)."""

    generated_at: datetime
    llm: LLMStatus
    embeddings: EmbeddingStatus
    knowledge_base: KnowledgeBaseStatus
    advocate_directory: DirectoryStatus
    features: FeatureFlags


@router.get("/status", response_model=StatusResponse, summary="Feature availability (no secrets)")
async def read_status(settings: SettingsDep, db: DbSession) -> StatusResponse:
    info = describe_provider(settings)
    health = provider_health() if info.configured else None

    kb = KnowledgeBaseStatus(
        available=False,
        documents_indexed=None,
        documents_failed=None,
        chunks_indexed=None,
        last_indexed_at=None,
    )
    directory = DirectoryStatus(available=False, verified_advocates=None)
    try:
        completed = LegalDocument.ingestion_status == IngestionStatus.COMPLETED
        row = (
            await db.execute(
                select(
                    func.count().filter(completed),
                    func.count().filter(LegalDocument.ingestion_status == IngestionStatus.FAILED),
                    func.coalesce(func.sum(LegalDocument.chunk_count).filter(completed), 0),
                    func.max(LegalDocument.updated_at).filter(completed),
                )
            )
        ).one()
        kb = KnowledgeBaseStatus(
            available=True,
            documents_indexed=int(row[0]),
            documents_failed=int(row[1]),
            chunks_indexed=int(row[2]),
            last_indexed_at=row[3],
        )
        verified = await db.scalar(
            select(func.count())
            .select_from(AdvocateProfile)
            .where(AdvocateProfile.verification_status == VerificationStatus.VERIFIED)
        )
        directory = DirectoryStatus(available=True, verified_advocates=int(verified or 0))
    except Exception as exc:  # report, don't 500 — the page shows "unavailable"
        logger.warning("status_db_query_failed", error_type=type(exc).__name__)

    return StatusResponse(
        generated_at=datetime.now(UTC),
        llm=LLMStatus(
            configured=info.configured,
            provider=info.provider,
            # The model that actually answered last (a fallback, if one was needed).
            model=health.model if health and health.ok and health.model else info.model,
            is_free_tier=info.is_free_tier,
            last_call_ok=health.ok if health else None,
            last_call_at=health.at if health else None,
            last_error_code=health.error_code if health else None,
            last_error_message=health.error_message if health else None,
        ),
        embeddings=EmbeddingStatus(
            configured=bool(settings.gemini_api_key),
            model=settings.embedding_model if settings.gemini_api_key else None,
        ),
        knowledge_base=kb,
        advocate_directory=directory,
        features=FeatureFlags(
            open_login=settings.open_login, general_answers=settings.allow_general_answers
        ),
    )


class LLMCheckResponse(BaseModel):
    ok: bool
    provider: str | None
    model: str | None
    latency_ms: float | None
    error_code: str | None
    error_message: str | None


@router.post(
    "/status/check-llm",
    response_model=LLMCheckResponse,
    summary="Make one tiny model call to test the AI connection",
)
async def check_llm(settings: SettingsDep, _rate_limit: AIRateLimit) -> LLMCheckResponse:
    """Spends one small request of the provider's quota, so it only runs on
    demand (the home page's "Test AI connection" button)."""
    info = describe_provider(settings)
    start = time.perf_counter()
    try:
        provider = get_provider(settings)
        await provider.complete(
            system="Reply with the single word OK.", messages=[("user", "ping")], max_tokens=10
        )
    except ServiceUnavailableError as exc:
        return LLMCheckResponse(
            ok=False,
            provider=info.provider,
            model=info.model,
            latency_ms=None,
            error_code=exc.code,
            error_message=exc.message,
        )
    health = provider_health()
    return LLMCheckResponse(
        ok=True,
        provider=provider.name,
        model=health.model if health and health.ok else provider.model,
        latency_ms=round((time.perf_counter() - start) * 1000, 1),
        error_code=None,
        error_message=None,
    )
