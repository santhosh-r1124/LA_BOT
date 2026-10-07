# LA_BOT API (FastAPI) production image for Railway. Build context: repo root.
FROM python:3.13-slim

RUN pip install --no-cache-dir uv==0.11.32 && uv --version

# The venv lives where `uv` expects it (apps/api/.venv), so a leftover
# dashboard start command running `uv sync` / `uv run` is a fast no-op.
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_COMPILE_BYTECODE=1 \
    UV_NO_DEV=1 \
    UV_FROZEN=1 \
    UV_PYTHON_DOWNLOADS=never \
    PATH="/app/apps/api/.venv/bin:${PATH}"

WORKDIR /app/apps/api

COPY apps/api/pyproject.toml apps/api/uv.lock ./
RUN uv sync --no-install-project

COPY apps/api/ ./
RUN uv sync && uv --version && which uvicorn alembic \
    && python -c "from app.main import app"

WORKDIR /app
CMD ["sh", "-c", "cd apps/api && alembic upgrade head && exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips='*'"]
