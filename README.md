# legal-platform

**Indian Legal Advisor Bot & Advocate Connect** — an AI-powered legal-information
platform for Indian consumers, IT professionals, startups and organisations, plus
an advocate discovery and consultation marketplace.

The AI answers are **grounded in verified Indian legal sources via RAG**, not the
LLM's parametric memory. For matters needing professional help, the platform
routes users to a qualified advocate rather than acting as one.

> **Phases 0–7 are done**: foundation, authentication & RBAC, the legal
> knowledge-base ingestion pipeline, production RAG (hybrid search +
> grounded, cited, **streamed** chat answers), risk scoring, a
> document-drafting assistant, and advocate marketplace discovery.
> **Runs entirely on free services**: one free Google AI Studio key (or a
> local Ollama model) — see [`docs/api-inventory.md`](docs/api-inventory.md).
> Real Indian court judgments are loaded from a Hugging Face dataset on
> start (see [Legal knowledge base](#legal-knowledge-base-hugging-face)); when
> nothing relevant is retrieved, chat says so before giving general
> information.
>
> Status per feature (based on the code, not the UI):
> [`docs/project-status.md`](docs/project-status.md) · phase plan:
> [`docs/roadmap.md`](docs/roadmap.md) · design:
> [`docs/architecture.md`](docs/architecture.md).

---

## Run it on your computer

**Windows, easiest:** install [Docker Desktop](https://www.docker.com/products/docker-desktop/),
then double-click **`START-LA-BOT.bat`**. It checks Docker, asks once for a
free Gemini key (optional), frees port 3000 if another app holds it (or picks
another port), builds and starts everything, and opens the browser. It fixes
common problems itself (pnpm version mismatch, CRLF/UTF-16 `.env`, a crashed
database). `STOP-LA-BOT.bat` stops it.

**Any OS, by hand:**

```bash
# 1. Install
pnpm install                        # JS workspace (pnpm 10; corepack enable)
cd apps/api && uv sync && cd ../..  # Python API (uv)

# 2. Configure: copy the example and fill in only what you need
cp .env.example .env                # GEMINI_API_KEY=... (free) enables the AI
                                    # HF_TOKEN=... only for gated datasets

# 3. Start backend + frontend (Postgres, Redis, API, web) on http://localhost:3000
docker compose up -d --build        # WEB_PORT=3020 docker compose up -d  if 3000 is taken

# 4. Import advocates (also runs automatically on every start)
docker compose exec -w /app/apps/api app python -m app.scripts.import_advocates data/advocates.csv --sample --expect 1000

# 5. Load real legal data from Hugging Face (also runs in the background on start)
docker compose exec -w /app/apps/api app python -m app.scripts.ingest_hf_dataset --inspect      # look first
docker compose exec -w /app/apps/api app python -m app.scripts.ingest_hf_dataset                # HF_MAX_DOCUMENTS docs
docker compose exec -w /app/apps/api app python -m app.scripts.ingest_hf_dataset --embed-missing  # needs GEMINI_API_KEY

# 6. Tests
cd apps/api && uv run pytest        # backend (needs Postgres: see conftest.py)
pnpm test                           # frontend + shared
python infrastructure/local/e2e_api_checks.py http://localhost:3000   # against the running app
```

Without Docker: run Postgres (with pgvector) and Redis yourself, then
`cd apps/api && uv run alembic upgrade head && uv run uvicorn app.main:app --port 8000`
and `pnpm --filter @legal-platform/web dev`. The same `uv run python -m app.scripts...`
commands work from `apps/api`.

### Architecture

```
 Browser ──► Next.js web (:3000) ──/api/v1 proxy──► FastAPI (:18000 in the container, :8000 on the host)
                                                      │
          ┌───────────────────────────────────────────┼─────────────────────────────┐
          │ Advocate directory                         │ Legal chat (RAG)             │
          │  advocates.csv ─► import (validate, upsert │  question ─► classifier      │
          │  by advocate_id, codes kept as written,    │   ─► hybrid retrieval:        │
          │  is_sample) ─► advocate_profiles           │      keyword (Postgres FTS)   │
          │  GET /advocates?practice_area&state&city   │      + vector (pgvector, when │
          │      &language_code&page&page_size         │        chunks are embedded)   │
          │  GET /advocates/facets                     │   ─► sources? grounded answer │
          │                                            │      with [n] citations       │
          │                                            │    : notice + general answer  │
          │                                            │   ─► LLM (Gemini / Groq /     │
          │                                            │      Ollama / Anthropic)      │
          └────────────────────────────────────────────┴───────────────────────────────┘
                                                      │
 Hugging Face dataset ─► loader (viewer API pages, or parquet/JSONL via HTTP range
   requests) ─► normalise ─► chunk ─► legal_documents + legal_chunks (Postgres)
   ─► embeddings (Gemini, resumable) ─► pgvector          Redis: rate limits, query-embedding cache
```

The synthetic advocate CSV and the legal knowledge base are separate tables:
advocate records never enter retrieval, and legal documents come only from the
configured dataset (or `pnpm kb:seed` official texts), never from generated
text.

### Advocate directory

`apps/api/data/advocates.csv` (1000 rows: `advocate_id, name, email, phone,
practice_area, state, city, language_code`) is **synthetic demo data**. It is
imported on every start with `is_sample=true`, so every listing carries a
**Sample** badge and the profile page says it is not a real, verified advocate.

- State codes (`TN`, `KA`, `TS`, `OD`, `CG`, ...) and language codes (`ta`,
  `en`, `hi`, ...) are stored **exactly as written** and are case-sensitive: a
  row with `tn` or `TA` is rejected with a reason instead of being rewritten.
  ISO variants (`CT`, `TG`, `OR`, `UT`, `GA`) are accepted and kept as written.
- Practice areas are the 14 platform categories (Cyber Law, Family Law, ...,
  Document Guidance, Advocate Required); names and codes are both accepted.
- Re-importing is idempotent (upsert by `advocate_id`); duplicate ids or
  emails inside one file, missing columns and malformed rows are reported.
- Search: `GET /api/v1/advocates?practice_area=Cyber%20Law&state=TN&city=Chennai&language_code=ta&page=1&page_size=20`
  returns `{items, total, page, page_size, limit, offset}`; invalid filters
  return `422` with the failing field. Admins can upload more CSVs at
  `/advocates/import`.

### Legal knowledge base (Hugging Face)

| Variable | Default | Meaning |
| --- | --- | --- |
| `HF_DATASET_NAME` | `Sumitedu/indian-case-laws` | Dataset id on huggingface.co |
| `HF_DATASET_SPLIT` / `HF_DATASET_FILE` | empty | Viewer split, or one parquet/`.jsonl` file of the repo to read directly |
| `HF_MAX_DOCUMENTS` | `200` | Documents to keep indexed; raise it to load more (continues where it stopped) |
| `HF_BATCH_SIZE` | `20` | Rows per request |
| `HF_TOKEN` | empty | Read token, only for gated/private datasets |
| `LEGAL_CORPUS_AUTOLOAD` / `LEGAL_CORPUS_EMBED_ON_START` | `true` | Load / embed in the background on API start |

Why this dataset, what was checked and what wasn't:
[`docs/legal-dataset.md`](docs/legal-dataset.md). Nothing is downloaded whole;
progress and failures (no internet, gated dataset, viewer unavailable) are
shown on the home page's **Platform status** panel and in `GET /api/v1/status`.
Retrieval works keyword-only until chunks are embedded, so a Gemini key is not
required to get cited answers.

**Answer rules:** answers cite only retrieved documents; case names, courts,
dates and citations come from the dataset's own fields and are never inferred.
When nothing relevant is retrieved, the reply starts with *"I couldn't find
sufficiently relevant material in the legal library for this question, so this
is general information only, not drawn from any source document."* Every reply
carries the disclaimer that this is general information, not a substitute for
an advocate.

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

# 3. Start infrastructure + backing services (Postgres, Redis, API, web, portal)
pnpm stack:up

# 4. Run database migrations
pnpm db:migrate

# 5. Verify
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
3. Court judgments from Hugging Face load on start (above). Optionally also
   load the official Acts (India Code / Legislative Department / MeitY — 15
   Acts, takes a few minutes on the free tier):

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
`503 llm_not_configured` and the UI says so; when no indexed source is
relevant, chat says so first and labels the reply general information
(`ALLOW_GENERAL_ANSWERS=false` refuses instead) — see
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

## Common tasks

| Command                       | Description                                  |
| ----------------------------- | ------------------------------------------- |
| `pnpm dev`                    | Run all JS apps in dev mode (Turborepo)     |
| `pnpm build`                  | Build all JS apps + packages                |
| `pnpm lint` / `pnpm typecheck`| Lint / type-check the JS workspace          |
| `pnpm test`                   | Run JS tests                                |
| `pnpm stack:up` / `stack:down`| Start / stop the Docker stack               |
| `pnpm db:migrate`             | Apply Alembic migrations                    |
| `pnpm db:revision -- "msg"`   | Autogenerate a new migration                |
| `pnpm kb:seed`                | Index the official Indian legal sources     |
| `cd apps/api && uv run python -m app.scripts.ingest_hf_dataset` | Load court judgments from Hugging Face (`--inspect`, `--embed-missing`) |
| `cd apps/api && uv run python -m app.scripts.import_advocates FILE.csv` | Import advocates (`--dry-run`, `--sample`, `--expect N`) |
| `cd apps/api && uv run pytest`| Run backend tests                           |
| `cd apps/api && uv run ruff check . && uv run mypy .` | Lint + type-check backend |

## License

Proprietary — all rights reserved (placeholder; update before any external use).
