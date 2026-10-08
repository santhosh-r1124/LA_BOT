# LA_BOT production image: the Next.js web app and the FastAPI API in one
# container. The web server listens on $PORT and proxies /api/v1 and /health
# to the API on 127.0.0.1:18000, so the browser only talks to one origin (no
# CORS, no API URL to configure). Started by infrastructure/railway/start.sh.

# ---- web app: Next.js standalone build ------------------------------------
FROM node:22-slim AS web
ENV NEXT_TELEMETRY_DISABLED=1 \
    NEXT_OUTPUT=standalone \
    NEXT_PUBLIC_API_BASE_URL= \
    NEXT_PUBLIC_APP_ENV=production \
    API_INTERNAL_URL=http://127.0.0.1:18000 \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /repo

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/web/package.json apps/web/
COPY apps/advocate-portal/package.json apps/advocate-portal/
COPY packages/shared/package.json packages/shared/
COPY packages/auth/package.json packages/auth/
COPY packages/database/package.json packages/database/
COPY packages/eslint-config/package.json packages/eslint-config/
RUN pnpm install --frozen-lockfile --filter "@legal-platform/web..."

COPY packages/ packages/
COPY apps/web/ apps/web/
RUN pnpm --filter @legal-platform/web build

# ---- runtime: Python 3.13 + uv + the Node binary --------------------------
FROM python:3.13-slim
COPY --from=web /usr/local/bin/node /usr/local/bin/node
RUN pip install --no-cache-dir uv==0.11.32 && uv --version && node --version

# The venv lives where `uv` expects it (apps/api/.venv), so a leftover
# dashboard start command running `uv sync` / `uv run` is a fast no-op.
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_COMPILE_BYTECODE=1 \
    UV_NO_DEV=1 \
    UV_FROZEN=1 \
    UV_PYTHON_DOWNLOADS=never \
    NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    API_INTERNAL_URL=http://127.0.0.1:18000 \
    APP_ENV=production \
    LOG_FORMAT=json \
    PATH="/app/apps/api/.venv/bin:${PATH}"

WORKDIR /app/apps/api
COPY apps/api/pyproject.toml apps/api/uv.lock ./
RUN uv sync --no-install-project
COPY apps/api/ ./
RUN uv sync && which uvicorn alembic && python -c "from app.main import app"

COPY --from=web /repo/apps/web/.next/standalone /app/web/
COPY --from=web /repo/apps/web/.next/static /app/web/apps/web/.next/static
COPY --from=web /repo/apps/web/public /app/web/apps/web/public
COPY infrastructure/railway/start.sh /app/start.sh
# A copy edited on Windows may have CRLF line endings, which bash rejects.
RUN sed -i 's/\r$//' /app/start.sh

WORKDIR /app
CMD ["bash", "/app/start.sh"]
