"""Typed application configuration, loaded from the environment.

All runtime configuration flows through :func:`get_settings`. Nothing else in the
codebase should read ``os.environ`` directly.
"""

from __future__ import annotations

import enum
import json
import secrets
import warnings
from functools import lru_cache
from typing import Annotated, Literal

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

_DEFAULT_SECRET = "change-me-dev-only"


class Environment(enum.StrEnum):
    """Deployment environment. Drives logging, docs exposure and error verbosity."""

    DEVELOPMENT = "development"
    STAGING = "staging"
    PRODUCTION = "production"

    @property
    def is_production(self) -> bool:
        return self is Environment.PRODUCTION

    @property
    def is_local(self) -> bool:
        return self is Environment.DEVELOPMENT


class Settings(BaseSettings):
    """Application settings.

    Field names map to UPPER_SNAKE_CASE environment variables (case-insensitive).
    Local development reads ``apps/api/.env``; in Docker/CI the process
    environment is populated from the repo-root ``.env`` / CI secrets.
    """

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # ---- Runtime -----------------------------------------------------------
    app_env: Environment = Environment.DEVELOPMENT
    app_name: str = "legal-platform-api"
    version: str = "0.1.0"
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"] = "INFO"
    log_format: Literal["console", "json"] = "console"

    # ---- Database --------------------------------------------------------
    database_url: str = Field(
        default="postgresql+asyncpg://legal:legal_dev_password@localhost:5432/legal_platform",
        description="Async SQLAlchemy URL (asyncpg driver) used by the app.",
    )
    database_url_sync: str | None = Field(
        default=None,
        description="Sync SQLAlchemy URL (psycopg driver) used by Alembic. "
        "Derived from database_url when unset.",
    )
    database_echo: bool = False
    db_pool_size: int = 5
    db_max_overflow: int = 10
    db_pool_timeout_seconds: int = 30

    # ---- Redis ---------------------------------------------------------
    redis_url: str = "redis://localhost:6379/0"

    # ---- Security ----------------------------------------------------
    api_secret_key: str = _DEFAULT_SECRET
    jwt_secret: str = _DEFAULT_SECRET
    jwt_algorithm: str = "HS256"
    access_token_ttl_minutes: int = 30
    refresh_token_ttl_days: int = 14
    email_verification_ttl_hours: int = 24
    # Demo/testing mode: any email (or name) and any password signs in. Unknown
    # emails get a verified consumer account; existing consumer accounts accept
    # any password. ADVOCATE/ADMIN/LEGAL_ADMIN accounts still need their real
    # password. Set OPEN_LOGIN=false for normal credential checks.
    open_login: bool = True
    password_reset_ttl_hours: int = 1

    # ---- CORS ------------------------------------------------------
    # ``NoDecode`` stops pydantic-settings from JSON-parsing the env value; the
    # validator below accepts a comma-separated string or a JSON array.
    cors_origins: Annotated[list[str], NoDecode] = Field(
        default_factory=lambda: ["http://localhost:3000"]
    )

    # ---- LLM / RAG (Phase 2+) ----------------------------------------
    # Which chat model provider answers questions / drafts documents. See
    # app/services/llm_provider.py and docs/api-inventory.md.
    #   auto      -> first configured of: gemini, groq, ollama, anthropic
    #   gemini    -> Google AI Studio free tier (same GEMINI_API_KEY as embeddings)
    #   groq      -> GroqCloud free tier (OpenAI-compatible API)
    #   ollama    -> local open-source model, no key, no cost
    #   anthropic -> Claude (paid; optional)
    llm_provider: Literal["auto", "gemini", "groq", "ollama", "anthropic"] = "auto"
    llm_max_tokens: int = 1024
    llm_classifier_max_tokens: int = 300
    llm_request_timeout_seconds: float = 60.0
    # How many prior messages (user + assistant) to include as context.
    chat_history_length: int = 10
    # When retrieval finds no indexed official source for a question, answer
    # from the model's general knowledge (labelled as such in the UI) instead
    # of replying "insufficient verified information". False = strict
    # sources-only mode.
    allow_general_answers: bool = True

    # Anthropic (optional, paid). ``LLM_MODEL`` is kept under its original
    # name for backwards compatibility and only applies to this provider.
    anthropic_api_key: str | None = None
    llm_model: str = "claude-sonnet-5"

    # Google Gemini (free tier). Key shared with embeddings below.
    gemini_llm_model: str = "gemini-flash-latest"

    # GroqCloud (free tier, OpenAI-compatible).
    groq_api_key: str | None = None
    groq_model: str = "openai/gpt-oss-120b"
    groq_base_url: str = "https://api.groq.com/openai/v1"

    # Ollama (local). Unset = disabled. Typically http://localhost:11434/v1
    # (or http://host.docker.internal:11434/v1 from inside Docker).
    ollama_base_url: str | None = None
    ollama_model: str = "llama3.1:8b"

    # ---- Abuse / free-tier protection -----------------------------------
    # Per-client-IP requests per minute on the AI endpoints (chat, document
    # drafting). Protects free-tier provider quotas. 0 disables the limiter.
    ai_rate_limit_per_minute: int = 20
    # How long to cache query embeddings in Redis (repeat questions skip the
    # embedding API call). 0 disables the cache.
    embedding_cache_ttl_seconds: int = 24 * 60 * 60

    # ---- Embeddings / knowledge base (Phase 3+) ------------------------
    # Google AI Studio key — free tier, no billing account required. Chosen
    # over paid embedding providers (Voyage/OpenAI) to keep the platform
    # runnable at zero cost; swap providers later by re-embedding.
    gemini_api_key: str | None = None
    embedding_model: str = "gemini-embedding-001"
    # gemini-embedding-001 supports Matryoshka truncation down from 3072;
    # 768 is Google's recommended efficiency/quality tradeoff point. Changing
    # this requires a new migration (the pgvector column dimension is fixed).
    embedding_dimensions: int = 768
    ingestion_max_source_bytes: int = 25 * 1024 * 1024
    ingestion_chunk_max_chars: int = 1500
    ingestion_chunk_overlap_chars: int = 200

    # ---- Startup data ---------------------------------------------------
    # CSV of advocates imported (upserted) into the directory on every start;
    # path relative to apps/api. Empty string disables it.
    advocates_csv_path: str = "data/advocates.csv"
    # When both are set, this account is created/kept as an ADMIN on startup
    # (it can upload advocate CSVs at /advocates/import).
    admin_email: str | None = None
    admin_password: str | None = None

    # ---- Frontend (Phase 1+) ------------------------------------------
    # Base URL used to build links inside emails (verify-email, reset-password).
    frontend_base_url: str = "http://localhost:3000"

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _split_cors_origins(cls, value: object) -> object:
        """Accept a comma-separated string or a JSON array as well as a list."""
        if isinstance(value, str):
            stripped = value.strip()
            if not stripped:
                return []
            if stripped.startswith("["):
                return json.loads(stripped)
            return [item.strip() for item in stripped.split(",") if item.strip()]
        return value

    @field_validator("database_url", mode="after")
    @classmethod
    def _force_asyncpg_driver(cls, value: str) -> str:
        """Hosted Postgres (Railway, Render, Heroku) hands out driverless URLs."""
        for prefix in ("postgres://", "postgresql://"):
            if value.startswith(prefix):
                return "postgresql+asyncpg://" + value[len(prefix) :]
        return value

    @property
    def sqlalchemy_url_async(self) -> str:
        return self.database_url

    @property
    def sqlalchemy_url_sync(self) -> str:
        """Sync URL for Alembic. Falls back to swapping the async driver."""
        if self.database_url_sync:
            return self.database_url_sync
        return (
            self.database_url.replace("+asyncpg", "+psycopg")
            .replace("postgresql+asyncpg", "postgresql+psycopg")
            .replace("postgres://", "postgresql+psycopg://")
        )

    @model_validator(mode="after")
    def _no_public_jwt_secret_in_production(self) -> Settings:
        """The default secret is in the repo, so anyone could mint tokens with
        it (including ADMIN ones). In production, swap it for a random
        per-process secret: sessions then reset on restart until JWT_SECRET is
        set, which beats forgeable tokens."""
        if self.app_env is Environment.PRODUCTION and self.jwt_secret == _DEFAULT_SECRET:
            self.jwt_secret = secrets.token_urlsafe(48)
            warnings.warn(
                "JWT_SECRET is not set; using a random secret (sessions reset on restart).",
                stacklevel=2,
            )
        return self

    @property
    def docs_enabled(self) -> bool:
        """Expose interactive API docs everywhere except production."""
        return self.app_env is not Environment.PRODUCTION


@lru_cache
def get_settings() -> Settings:
    """Return the process-wide settings singleton."""
    return Settings()
