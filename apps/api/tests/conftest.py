"""Shared pytest fixtures.

Config is forced to safe defaults before the app is imported so tests never
touch a developer's real ``.env``. ``pytest-asyncio`` runs in ``auto`` mode
(see pyproject), so ``async def test_*`` needs no marker.

Two flavours of client:

* ``client``    — no database. Fine for health checks, RBAC-without-a-token
                  cases, and anything that never reaches a DB session.
* ``db_client`` — every request runs inside one outer DB transaction that is
                  rolled back after the test (see "Joining a Session into an
                  External Transaction" in the SQLAlchemy docs), so tests are
                  isolated from each other and never leave rows behind. Skips
                  automatically if Postgres isn't reachable (start it with
                  ``pnpm stack:up``).
"""

from __future__ import annotations

import asyncio
import os
import uuid
from collections.abc import AsyncIterator, Iterator

import pytest

os.environ.setdefault("APP_ENV", "development")
os.environ.setdefault("LOG_FORMAT", "console")
os.environ.setdefault("LOG_LEVEL", "WARNING")
os.environ.setdefault(
    "DATABASE_URL", "postgresql+asyncpg://legal:legal@localhost:5432/legal_platform_test"
)
os.environ.setdefault("REDIS_URL", "redis://localhost:6379/1")
os.environ.setdefault("CORS_ORIGINS", "http://localhost:3000,http://localhost:3001")
os.environ.setdefault("AI_RATE_LIMIT_PER_MINUTE", "0")
# No model provider configured unless a test opts in — keeps the suite
# offline and makes the "not configured" paths deterministic.
os.environ.setdefault("LLM_PROVIDER", "auto")
for _key in ("ANTHROPIC_API_KEY", "GEMINI_API_KEY", "GROQ_API_KEY", "OLLAMA_BASE_URL"):
    os.environ.setdefault(_key, "")
os.environ.setdefault("JWT_SECRET", "test-secret-not-for-production-use-0123456789")
# Real credential checks unless a test opts into open login (see test_auth.py).
os.environ.setdefault("OPEN_LOGIN", "false")
os.environ.setdefault("ADVOCATES_CSV_PATH", "")
for _key in ("ADMIN_EMAIL", "ADMIN_PASSWORD"):
    os.environ.setdefault(_key, "")


def unique_email(prefix: str = "test") -> str:
    """A collision-free email for tests that don't use the transactional fixture."""
    return f"{prefix}-{uuid.uuid4().hex[:12]}@example.com"


@pytest.fixture
def app() -> Iterator[object]:
    from app.core.config import get_settings
    from app.main import create_app

    get_settings.cache_clear()
    yield create_app()
    get_settings.cache_clear()


@pytest.fixture
async def client(app: object) -> AsyncIterator[object]:
    from httpx import ASGITransport, AsyncClient

    from app.db.session import dispose_engine

    transport = ASGITransport(app=app)  # type: ignore[arg-type]
    async with AsyncClient(transport=transport, base_url="http://testserver") as ac:
        yield ac
    # e.g. /health/ready opens a pooled DB connection on this test's loop.
    await dispose_engine()


# ---------------------------------------------------------------------------
# Database-backed fixtures
# ---------------------------------------------------------------------------


async def _db_reachable() -> bool:
    from sqlalchemy import text

    from app.db.session import dispose_engine, get_sessionmaker

    try:
        async with get_sessionmaker()() as session:
            await session.execute(text("SELECT 1"))
        return True
    except Exception:
        return False
    finally:
        # The probe runs under its own ``asyncio.run`` loop; pooled asyncpg
        # connections are bound to that loop, so drop them before the tests'
        # loops try to reuse them ("attached to a different loop").
        await dispose_engine()


@pytest.fixture(scope="session")
def db_available() -> bool:
    return asyncio.run(_db_reachable())


@pytest.fixture
async def db_conn(db_available: bool):
    if not db_available:
        pytest.skip("Postgres not reachable — start it with `pnpm stack:up` to run this test.")

    from app.db.session import dispose_engine, get_engine

    engine = get_engine()
    try:
        async with engine.connect() as connection:
            trans = await connection.begin()
            try:
                yield connection
            finally:
                await trans.rollback()
    finally:
        # pytest-asyncio gives each test its own event loop; pooled connections
        # must not outlive the loop that created them.
        await dispose_engine()


@pytest.fixture
async def db_txn_session(db_conn):
    from sqlalchemy.ext.asyncio import AsyncSession

    session = AsyncSession(
        bind=db_conn, expire_on_commit=False, join_transaction_mode="create_savepoint"
    )
    try:
        yield session
    finally:
        await session.close()


@pytest.fixture
async def db_client(db_txn_session):
    from httpx import ASGITransport, AsyncClient

    from app.api.deps import db_session as db_session_dependency
    from app.core.config import get_settings
    from app.main import create_app

    get_settings.cache_clear()
    app = create_app()

    async def _override() -> AsyncIterator[object]:
        yield db_txn_session

    app.dependency_overrides[db_session_dependency] = _override

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as ac:
        yield ac

    app.dependency_overrides.clear()
    get_settings.cache_clear()
