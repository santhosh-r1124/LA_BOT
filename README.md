# legal-platform

**Indian Legal Advisor Bot & Advocate Connect** — an AI-powered legal-information
platform for Indian consumers, IT professionals, startups and organisations, plus
an advocate discovery and consultation marketplace.

The AI answers are **grounded in verified Indian legal sources via RAG**, not the
LLM's parametric memory. For matters needing professional help, the platform
routes users to a qualified advocate rather than acting as one.

> **All MVP features are built** (Phases 0–14): auth & RBAC, grounded and
> **streamed** legal chat over a hybrid-search RAG index, risk scoring, the
> document assistant, advocate discovery, **consultation booking**, the
> advocate dashboard, **Razorpay payments**, in-app + email
> **notifications**, an **admin & legal-ops console**, security hardening,
> and a browser E2E suite. Legal sources are found **dynamically** (India
> Code OAI-PMH, an open central + state Acts corpus, plus a curated list).
> **Runs entirely on free services** — see
> [`docs/api-inventory.md`](docs/api-inventory.md). Payments and email need
> your own accounts and stay safely "not configured" until you add them.
> Load the legal corpus from `/admin/knowledge` or `pnpm kb:discover:ingest`;
> until then chat correctly answers "insufficient verified information".
> Going live: [`infrastructure/deployment/README.md`](infrastructure/deployment/README.md).
>
> Status per feature (based on the code, not the UI):
> [`docs/project-status.md`](docs/project-status.md) · phase plan:
> [`docs/roadmap.md`](docs/roadmap.md) · design:
> [`docs/architecture.md`](docs/architecture.md).

---

## Monorepo layout

```
legal-platform/
├── apps/
│   ├── web/                 # Next.js — consumer web app (chat, docs, advocate search)
│   ├── api/                 # FastAPI — core backend API (Python, SQLAlchemy, Alembic)
│   └── advocate-portal/     # Next.js — advocate dashboard
├── services/                # Python domain services — stubs for now; real
│   │                        # logic lives in apps/api/app/services/ until the
│   │                        # Docker build context is repo-root (docs/adr/0004)
│   ├── rag/                 # Phase 4 — real impl: apps/api/app/services/rag/ + app/services/llm.py
│   ├── document-processing/ # Phase 3 — real impl: apps/api/app/services/ingestion/
│   ├── legal-classifier/    # Phase 5 — real impl: apps/api/app/services/legal_classifier.py
│   ├── risk-engine/         # Phase 5 — real impl: apps/api/app/services/risk_engine.py
│   └── notifications/       # Phase 11 — email / SMS / in-app fan-out
├── packages/                # Shared TypeScript packages
│   ├── database/            # DB client + generated types (schema owned by apps/api)
│   ├── auth/                # Shared auth types + token helpers
│   └── shared/              # Cross-cutting enums, constants, API contracts
├── infrastructure/
│   ├── docker/              # docker-compose + service Dockerfiles + Postgres init
│   └── deployment/          # staging/prod config, deploy notes (Phase 15)
└── docs/                    # architecture, roadmap, ADRs, runbooks
```

## Tech stack

| Layer            | Choice                                                    |
| ---------------- | -------------------------------------------------------- |
| Frontend         | Next.js 15 (App Router, React 19), Tailwind CSS v4, shared design system (`packages/shared/src/styles`) |
| Backend API      | FastAPI, Pydantic v2, SQLAlchemy 2.0 (async), Uvicorn    |
| Database         | PostgreSQL 16 + `pgvector` (local: Docker; staging/prod: Supabase) |
| Cache / queue    | Redis 7                                                  |
| Migrations       | Alembic (schema owned by `apps/api`)                     |
| Logging          | `structlog` (console in dev, JSON in staging/prod)       |
| LLM              | Provider-agnostic: Google Gemini (free tier, default), Groq (free), Ollama (local), Anthropic (optional, paid) |
| Embeddings       | Google Gemini (`gemini-embedding-001`, free tier)         |
| JS monorepo      | pnpm workspaces + Turborepo                              |
| Python packaging | `uv`                                                     |
| CI               | GitHub Actions (`.github/workflows/ci.yml`)              |

Key decisions are recorded as ADRs in [`docs/adr/`](docs/adr/).

## Prerequisites

- **Node.js** ≥ 22.11 and **pnpm** ≥ 10 (`corepack enable`)
- **Python** ≥ 3.12 and **uv** ≥ 0.5 (`pip install uv` or see <https://docs.astral.sh/uv/>)
- **Docker** ≥ 24 with the Compose plugin

## Quick start

```bash
# 1. Install JS dependencies
pnpm install

# 2. Configure environment
cp .env.example .env
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
cp apps/advocate-portal/.env.example apps/advocate-portal/.env.local

# 3. Start the backing services in Docker: Postgres, Redis and the API.
#    The two frontends are NOT started by this command (step 5).
pnpm stack:up

# 4. Run database migrations
pnpm db:migrate

# 5. Start the frontends, each in its own terminal
pnpm --filter @legal-platform/web dev               # consumer web on :3000
pnpm --filter @legal-platform/advocate-portal dev   # advocate portal on :3001
#    (or run them in Docker instead:
#     docker compose -f infrastructure/docker/docker-compose.yml --profile web up -d)

# 6. Verify
curl http://localhost:8000/health           # API liveness
curl http://localhost:8000/health/ready      # API readiness (checks DB + Redis)
open http://localhost:3000                    # consumer web — /chat, /register, /login, /profile
open http://localhost:3001                    # advocate portal — /register, /login, /profile
open http://localhost:8000/docs               # API OpenAPI docs
```

Verification/reset emails are logged (not sent) in development — read the link
out of the API log output. To create an admin account (there's no public
admin sign-up): `cd apps/api && uv run python -m app.scripts.create_admin --email you@example.com`.

### Configure the AI (free)

1. Get a free Google AI Studio key: <https://aistudio.google.com/apikey>.
2. Put it in `apps/api/.env` (and the root `.env` for Docker):
   `GEMINI_API_KEY=...` — it powers both the chat model and the knowledge-base
   embeddings. Nothing else is required.
3. Load the official legal sources (India Code / Legislative Department /
   MeitY — 15 Acts, takes a few minutes on the free tier):

   ```bash
   pnpm kb:seed          # idempotent; add -- --retry-failed to retry failures
   ```

4. Check <http://localhost:3000> — the **Platform status** panel reads the
   real configuration and corpus size from `GET /api/v1/status`.

Prefer another provider? Set `LLM_PROVIDER=groq` + `GROQ_API_KEY` (free), or
`LLM_PROVIDER=ollama` + `OLLAMA_BASE_URL=http://localhost:11434/v1` for a local
model with no key at all (embeddings still need the Gemini key). Anthropic
remains supported (`LLM_PROVIDER=anthropic`, paid). Every variable, rate limit
and failure mode is documented in
[`docs/api-inventory.md`](docs/api-inventory.md).

Without any provider configured, chat/documents return a clear
`503 llm_not_configured` and the UI says so; without indexed sources, chat
replies with the "insufficient verified information" message instead of
guessing — see
[`docs/adr/0007-hybrid-search-and-grounding.md`](docs/adr/0007-hybrid-search-and-grounding.md)
and [`docs/adr/0010-free-llm-providers-and-streaming.md`](docs/adr/0010-free-llm-providers-and-streaming.md).

### Running apps individually (without Docker)

```bash
# Backend
cd apps/api && uv sync && uv run uvicorn app.main:app --reload --port 8000

# Frontend(s)
pnpm --filter @legal-platform/web dev
pnpm --filter @legal-platform/advocate-portal dev
```

Remember to point `DATABASE_URL` / `REDIS_URL` at `localhost` when the API runs
on the host — see the comments in `.env.example`.

### Using different ports

If port 3000 (or 3001) is already taken on your machine, start the frontend on
another port — for example 5000:

```bash
pnpm --filter @legal-platform/web exec next dev --turbopack --port 5000
```

(`pnpm --filter @legal-platform/web dev -- -p 5000` does **not** work — the
`dev` script already fixes the port.) The API only accepts browser requests
from the origins it's told about, so also set these in the root `.env` (read by
Docker) and in `apps/api/.env`, then restart the API (`pnpm stack:down && pnpm stack:up`):

```bash
CORS_ORIGINS=http://localhost:5000,http://localhost:3001
FRONTEND_BASE_URL=http://localhost:5000   # links in verification/reset emails
```

When the frontends run in Docker (`--profile web`), set `WEB_PORT=5000` /
`ADVOCATE_PORTAL_PORT=...` in the root `.env` instead. `API_PORT` moves the API;
if you change it, update `NEXT_PUBLIC_API_BASE_URL` in `apps/web/.env.local`
and `apps/advocate-portal/.env.local` to match.

## Common tasks

| Command                       | Description                                  |
| ----------------------------- | ------------------------------------------- |
| `pnpm dev`                    | Run all JS apps in dev mode (Turborepo)     |
| `pnpm build`                  | Build all JS apps + packages                |
| `pnpm lint` / `pnpm typecheck`| Lint / type-check the JS workspace          |
| `pnpm test`                   | Run JS tests                                |
| `pnpm stack:up` / `stack:down`| Start / stop Postgres, Redis and the API in Docker (not the frontends) |
| `pnpm db:migrate`             | Apply Alembic migrations                    |
| `pnpm db:revision -- "msg"`   | Autogenerate a new migration                |
| `pnpm kb:seed`                | Index the curated official Indian sources   |
| `pnpm kb:discover[:ingest]`   | Discover (and ingest) Indian legal sources dynamically |
| `pnpm e2e`                    | Browser end-to-end journey (needs Postgres + Redis) |
| `cd apps/api && uv run pytest`| Run backend tests                           |
| `cd apps/api && uv run ruff check . && uv run mypy .` | Lint + type-check backend |

## License

Proprietary — all rights reserved (placeholder; update before any external use).
