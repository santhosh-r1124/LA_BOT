"""Unit tests for app.services.rate_limit — uses a tiny in-memory fake of the
two Redis commands the limiter needs, so no Redis server is required."""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import pytest

from app.core.config import Settings
from app.services import rate_limit


class _FakeRedis:
    def __init__(self) -> None:
        self.counts: dict[str, int] = {}
        self.ttls: dict[str, int] = {}

    async def incr(self, key: str) -> int:
        self.counts[key] = self.counts.get(key, 0) + 1
        return self.counts[key]

    async def expire(self, key: str, seconds: int) -> None:
        self.ttls[key] = seconds


class _BrokenRedis:
    async def incr(self, key: str) -> int:
        raise ConnectionError("redis down")


def _request(host: str = "203.0.113.9") -> Any:
    return SimpleNamespace(client=SimpleNamespace(host=host))


async def test_allows_up_to_the_limit_then_rejects() -> None:
    redis = _FakeRedis()
    results = [(await rate_limit.hit(redis, bucket="ai", key="ip:x", limit=3))[0] for _ in range(4)]  # type: ignore[arg-type]
    assert results == [True, True, True, False]
    assert all(ttl > 60 for ttl in redis.ttls.values())


async def test_enforce_raises_429_with_retry_after() -> None:
    redis = _FakeRedis()
    settings = Settings(ai_rate_limit_per_minute=1)
    await rate_limit.enforce_ai_rate_limit(_request(), settings, redis, None)  # type: ignore[arg-type]
    with pytest.raises(rate_limit.RateLimitedError) as exc_info:
        await rate_limit.enforce_ai_rate_limit(_request(), settings, redis, None)  # type: ignore[arg-type]
    assert exc_info.value.status_code == 429
    assert exc_info.value.code == "rate_limited"
    assert int(exc_info.value.headers["Retry-After"]) > 0


async def test_limits_are_per_client() -> None:
    redis = _FakeRedis()
    settings = Settings(ai_rate_limit_per_minute=1)
    await rate_limit.enforce_ai_rate_limit(_request("198.51.100.1"), settings, redis, None)  # type: ignore[arg-type]
    await rate_limit.enforce_ai_rate_limit(_request("198.51.100.2"), settings, redis, None)  # type: ignore[arg-type]


async def test_logged_in_users_are_keyed_by_id() -> None:
    user = SimpleNamespace(id="user-123")
    assert rate_limit.client_key(_request(), str(user.id)) == "user:user-123"
    assert rate_limit.client_key(_request("1.2.3.4"), None) == "ip:1.2.3.4"


async def test_disabled_when_limit_is_zero() -> None:
    settings = Settings(ai_rate_limit_per_minute=0)
    await rate_limit.enforce_ai_rate_limit(_request(), settings, _BrokenRedis(), None)  # type: ignore[arg-type]


async def test_fails_open_when_redis_is_down() -> None:
    settings = Settings(ai_rate_limit_per_minute=1)
    for _ in range(3):
        await rate_limit.enforce_ai_rate_limit(_request(), settings, _BrokenRedis(), None)  # type: ignore[arg-type]
