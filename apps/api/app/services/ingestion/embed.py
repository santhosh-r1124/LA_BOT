"""Gemini-backed embedding client (Google AI Studio — free tier).

Chosen over paid providers (Voyage/OpenAI) so the platform is runnable at zero
cost; see docs/adr/0005-embedding-provider.md. Configure ``GEMINI_API_KEY`` to
enable it — unset by default, same "build now, key later" pattern as
``ANTHROPIC_API_KEY`` (Phase 2): calls 503 with a clear error until then.

Gemini's embeddings are task-asymmetric — the model is told whether it's
embedding something to store (``RETRIEVAL_DOCUMENT``) or a search query
(``RETRIEVAL_QUERY``); using the right one measurably improves retrieval.

Free-tier protection:

* Ingestion batches (``RETRIEVAL_DOCUMENT``) retry with backoff when the API
  answers 429 / RESOURCE_EXHAUSTED — bulk-seeding a corpus routinely brushes
  the per-minute quota. Interactive query embeddings don't retry: a chat user
  shouldn't wait 30s; the chat route degrades to "insufficient evidence".
* Query embeddings are cached in Redis (``EMBEDDING_CACHE_TTL_SECONDS``), so a
  repeated question costs no API call. The cache fails open.
"""

from __future__ import annotations

import asyncio
import hashlib
import json

from google import genai
from google.genai import types as genai_types

from app.core.config import Settings
from app.core.errors import ServiceUnavailableError
from app.core.logging import get_logger

logger = get_logger("app.embeddings")

# The API accepts multiple contents per call; keep batches modest to stay
# comfortably inside free-tier rate/size limits.
_MAX_BATCH = 50
_RATE_LIMIT_RETRIES = 4
_RATE_LIMIT_BACKOFF_SECONDS = 15.0


def _is_rate_limit(exc: BaseException) -> bool:
    text = str(exc)
    return getattr(exc, "code", None) == 429 or "429" in text or "RESOURCE_EXHAUSTED" in text


def _client(settings: Settings) -> genai.Client:
    if not settings.gemini_api_key:
        raise ServiceUnavailableError(
            "Embeddings aren't configured yet (missing GEMINI_API_KEY).",
            code="embeddings_not_configured",
        )
    return genai.Client(api_key=settings.gemini_api_key)


async def embed_texts(
    texts: list[str], *, settings: Settings, task_type: str = "RETRIEVAL_DOCUMENT"
) -> list[list[float]]:
    if not texts:
        return []

    client = _client(settings)
    vectors: list[list[float]] = []
    for start in range(0, len(texts), _MAX_BATCH):
        batch = texts[start : start + _MAX_BATCH]
        attempts = _RATE_LIMIT_RETRIES if task_type == "RETRIEVAL_DOCUMENT" else 1
        for attempt in range(1, attempts + 1):
            try:
                response = await client.aio.models.embed_content(
                    model=settings.embedding_model,
                    contents=batch,
                    config=genai_types.EmbedContentConfig(
                        task_type=task_type,
                        output_dimensionality=settings.embedding_dimensions,
                    ),
                )
                break
            except Exception as exc:  # Google SDK: network/auth/rate-limit/quota/etc.
                rate_limited = _is_rate_limit(exc)
                if rate_limited and attempt < attempts:
                    delay = _RATE_LIMIT_BACKOFF_SECONDS * attempt
                    logger.info("embedding_rate_limited_retrying", attempt=attempt, delay=delay)
                    await asyncio.sleep(delay)
                    continue
                logger.warning("embedding_failed", error=str(exc)[:500])
                raise ServiceUnavailableError(
                    "The embedding service's free-tier limit was reached. Try again shortly."
                    if rate_limited
                    else "Could not reach the embedding service. Please try again shortly.",
                    code="embeddings_rate_limited" if rate_limited else "embeddings_error",
                ) from exc

        embeddings = response.embeddings or []
        if len(embeddings) != len(batch):
            raise ServiceUnavailableError(
                "The embedding service returned an unexpected number of results.",
                code="embeddings_error",
            )
        vectors.extend(list(item.values or []) for item in embeddings)

    return vectors


def _cache_key(query: str, settings: Settings) -> str:
    normalized = " ".join(query.lower().split())
    digest = hashlib.sha256(
        f"{settings.embedding_model}|{settings.embedding_dimensions}|{normalized}".encode()
    ).hexdigest()
    return f"embq:{digest}"


async def _cache_get(key: str) -> list[float] | None:
    from app.services.redis import get_redis

    try:
        raw = await get_redis().get(key)
    except Exception as exc:  # cache is best-effort
        logger.debug("embedding_cache_unavailable", error_type=type(exc).__name__)
        return None
    if not raw:
        return None
    try:
        value = json.loads(raw)
    except (TypeError, ValueError):
        return None
    return [float(x) for x in value] if isinstance(value, list) else None


async def _cache_set(key: str, vector: list[float], ttl: int) -> None:
    from app.services.redis import get_redis

    try:
        await get_redis().set(key, json.dumps(vector), ex=ttl)
    except Exception as exc:  # cache is best-effort
        logger.debug("embedding_cache_unavailable", error_type=type(exc).__name__)


async def embed_query(query: str, *, settings: Settings) -> list[float]:
    _client(settings)  # raise embeddings_not_configured before touching the cache
    ttl = settings.embedding_cache_ttl_seconds
    key = _cache_key(query, settings)
    if ttl > 0:
        cached = await _cache_get(key)
        if cached is not None and len(cached) == settings.embedding_dimensions:
            return cached
    vectors = await embed_texts([query], settings=settings, task_type="RETRIEVAL_QUERY")
    if ttl > 0:
        await _cache_set(key, vectors[0], ttl)
    return vectors[0]
