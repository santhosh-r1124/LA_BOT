"""Per-client fixed-window rate limiting for the AI endpoints (Redis-backed).

Every chat message / document draft spends free-tier model quota (Gemini,
Groq) that is shared by *all* users of a deployment. Without a limiter a
single client can exhaust the day's quota for everyone. The window is one
minute, keyed by client IP (or user id when logged in).

The limiter **fails open**: if Redis is unreachable the request proceeds and
the failure is logged. Rate limiting protects quota; it must not become a new
way for the product to go down.
"""

from __future__ import annotations

import time
from typing import Annotated

from fastapi import Depends, Request
from redis.asyncio import Redis

from app.api.deps import OptionalUser, RedisDep, SettingsDep
from app.core.errors import AppError
from app.core.logging import get_logger

logger = get_logger("app.rate_limit")

_WINDOW_SECONDS = 60


class RateLimitedError(AppError):
    code = "rate_limited"
    message = "Too many requests. Please wait a minute and try again."
    status_code = 429

    def __init__(self, message: str, *, retry_after: int) -> None:
        super().__init__(message)
        self.headers = {"Retry-After": str(retry_after)}


def client_key(request: Request, user_id: str | None) -> str:
    if user_id:
        return f"user:{user_id}"
    # Behind a reverse proxy, the proxy must set X-Forwarded-For and uvicorn
    # must run with --proxy-headers so request.client reflects the real peer.
    host = request.client.host if request.client else "unknown"
    return f"ip:{host}"


async def hit(redis: Redis, *, bucket: str, key: str, limit: int) -> tuple[bool, int]:
    """Count one request. Returns (allowed, seconds_until_window_resets)."""
    window = int(time.time() // _WINDOW_SECONDS)
    redis_key = f"ratelimit:{bucket}:{key}:{window}"
    count = await redis.incr(redis_key)
    if count == 1:
        await redis.expire(redis_key, _WINDOW_SECONDS + 5)
    retry_after = _WINDOW_SECONDS - int(time.time()) % _WINDOW_SECONDS
    return count <= limit, retry_after


async def enforce_ai_rate_limit(
    request: Request, settings: SettingsDep, redis: RedisDep, user: OptionalUser
) -> None:
    limit = settings.ai_rate_limit_per_minute
    if limit <= 0:
        return
    key = client_key(request, str(user.id) if user else None)
    try:
        allowed, retry_after = await hit(redis, bucket="ai", key=key, limit=limit)
    except Exception as exc:  # Redis down — fail open, but make it visible.
        logger.warning("rate_limit_unavailable", error_type=type(exc).__name__)
        return
    if not allowed:
        raise RateLimitedError(
            f"You've sent more than {limit} requests in a minute. "
            f"Please wait {retry_after}s and try again.",
            retry_after=retry_after,
        )


AIRateLimit = Annotated[None, Depends(enforce_ai_rate_limit)]
