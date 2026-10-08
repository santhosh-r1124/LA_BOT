"""Service metadata + capability status — safe, unauthenticated, used by the
frontends to show *real* availability instead of assuming features work."""

from __future__ import annotations

import time
from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel
from sqlalchemy import func, select, text

from app.api.deps import DbSession, RedisDep, SettingsDep
from app.core.errors import ServiceUnavailableError
from app.core.logging import get_logger
from app.models.legal_document import IngestionStatus, LegalChunk, LegalDocument
from app.models.user import AdvocateProfile, VerificationStatus
from app.services.llm_provider import (
    describe_provider,
    get_provider,
    provider_health,
    resolve_fallback_name,
)
from app.services.rate_limit import AIRateLimit
from app.services.startup import corpus_load

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
    # "ai" when a provider is configured. "offline" when none is: chat then
    # answers from the retrieved sources alone and documents are template drafts.
    mode: Literal["ai", "offline"]
    provider: str | None
    model: str | None
    is_free_tier: bool | None
    # Secondary provider used when the primary fails (null = no fallback).
    fallback_provider: str | None = None
    # Outcome of the most recent real model call since the server started
    # (null until the first one). No probe calls are made for this.
    last_call_ok: bool | None = None
    last_call_at: datetime | None = None
    last_error_code: str | None = None
    last_error_message: str | None = None


class EmbeddingStatus(BaseModel):
    configured: bool
    model: str | None
    provider: str = "gemini"


class ServiceCheck(BaseModel):
    ok: bool | None
    """None = could not be determined."""
    detail: str | None = None


class DependencyStatus(BaseModel):
    """Live dependency checks (cheap: no model calls)."""

    database: ServiceCheck
    redis: ServiceCheck
    vector_search: ServiceCheck
    """pgvector installed; ``detail`` says whether chunks are embedded yet."""


class DatasetCount(BaseModel):
    dataset: str
    """Where the documents came from: a Hugging Face dataset id, or "official
    sources" for the government texts loaded by seed_corpus."""
    documents: int


class CorpusLoadStatus(BaseModel):
    """The background Hugging Face load started with the API."""

    state: str
    dataset: str | None
    message: str | None
    updated_at: datetime | None


class KnowledgeBaseStatus(BaseModel):
    available: bool
    """False when the database couldn't be queried — counts are then null."""
    documents_indexed: int | None
    documents_failed: int | None
    chunks_indexed: int | None
    chunks_embedded: int | None = None
    """Chunks usable for semantic (vector) search; the rest are keyword-only."""
    last_indexed_at: datetime | None
    sources: list[DatasetCount] = []
    corpus_load: CorpusLoadStatus | None = None


class DirectoryStatus(BaseModel):
    available: bool
    verified_advocates: int | None
    """All listed advocates, including sample (synthetic demo) listings."""
    sample_advocates: int | None = None


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
    dependencies: DependencyStatus


@router.get("/status", response_model=StatusResponse, summary="Feature availability (no secrets)")
async def read_status(settings: SettingsDep, db: DbSession, redis: RedisDep) -> StatusResponse:
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
        embedded = await db.scalar(
            select(func.count()).select_from(LegalChunk).where(LegalChunk.embedding.is_not(None))
        )
        per_source = (
            await db.execute(
                select(LegalDocument.source_dataset, func.count())
                .where(completed)
                .group_by(LegalDocument.source_dataset)
                .order_by(func.count().desc())
            )
        ).all()
        kb = KnowledgeBaseStatus(
            available=True,
            documents_indexed=int(row[0]),
            documents_failed=int(row[1]),
            chunks_indexed=int(row[2]),
            chunks_embedded=int(embedded or 0),
            last_indexed_at=row[3],
            sources=[
                DatasetCount(dataset=name or "official sources", documents=int(count))
                for name, count in per_source
            ],
        )
        verified, sample = (
            await db.execute(
                select(func.count(), func.count().filter(AdvocateProfile.is_sample))
                .select_from(AdvocateProfile)
                .where(AdvocateProfile.verification_status == VerificationStatus.VERIFIED)
            )
        ).one()
        directory = DirectoryStatus(
            available=True, verified_advocates=int(verified), sample_advocates=int(sample)
        )
    except Exception as exc:  # report, don't 500 — the page shows "unavailable"
        logger.warning("status_db_query_failed", error_type=type(exc).__name__)

    dependencies = await _dependencies(db, redis, kb)
    kb.corpus_load = CorpusLoadStatus(
        state=corpus_load.state,
        dataset=corpus_load.dataset,
        message=corpus_load.message,
        updated_at=corpus_load.updated_at,
    )
    return StatusResponse(
        generated_at=datetime.now(UTC),
        llm=LLMStatus(
            configured=info.configured,
            mode="ai" if info.configured else "offline",
            provider=info.provider,
            # The model that actually answered last (a fallback, if one was needed).
            model=health.model if health and health.ok and health.model else info.model,
            is_free_tier=info.is_free_tier,
            fallback_provider=(
                resolve_fallback_name(info.provider, settings)
                if info.configured and info.provider
                else None
            ),
            last_call_ok=health.ok if health else None,
            last_call_at=health.at if health else None,
            last_error_code=health.error_code if health else None,
            last_error_message=health.error_message if health else None,
        ),
        embeddings=EmbeddingStatus(
            configured=_embeddings_on(settings),
            model=settings.embedding_model if _embeddings_on(settings) else None,
            provider=settings.embedding_provider,
        ),
        knowledge_base=kb,
        advocate_directory=directory,
        features=FeatureFlags(
            open_login=settings.open_login, general_answers=settings.allow_general_answers
        ),
        dependencies=dependencies,
    )


def _embeddings_on(settings: SettingsDep) -> bool:
    return settings.embedding_provider != "none" and bool(settings.gemini_api_key)


async def _dependencies(
    db: DbSession, redis: RedisDep, kb: KnowledgeBaseStatus
) -> DependencyStatus:
    database = ServiceCheck(ok=kb.available, detail=None if kb.available else "unreachable")
    try:
        await redis.ping()
        cache = ServiceCheck(ok=True)
    except Exception as exc:
        logger.warning("status_redis_failed", error_type=type(exc).__name__)
        cache = ServiceCheck(ok=False, detail="unreachable")
    vector = ServiceCheck(ok=None, detail="database unavailable")
    if kb.available:
        try:
            installed = await db.scalar(text("SELECT 1 FROM pg_extension WHERE extname = 'vector'"))
            embedded, total = kb.chunks_embedded or 0, kb.chunks_indexed or 0
            vector = ServiceCheck(
                ok=bool(installed),
                detail=(
                    "pgvector missing"
                    if not installed
                    else f"{embedded} of {total} passages embedded"
                    + ("" if embedded else " (keyword search only)")
                ),
            )
        except Exception as exc:
            logger.warning("status_vector_failed", error_type=type(exc).__name__)
            vector = ServiceCheck(ok=False, detail="check failed")
    return DependencyStatus(database=database, redis=cache, vector_search=vector)


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
