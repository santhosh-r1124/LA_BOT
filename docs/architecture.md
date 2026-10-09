# Architecture

Status: describes the system as it is built today (see [`project-status.md`](project-status.md) for
per-feature status). LA_BOT runs on one computer: three application processes, a database and a
cache. There is no hosted deployment, no CDN and no load balancer.

## 1. System overview

```
   Browser
      │
      ├──────────────► Next.js  apps/web             :3000   website: chat, documents, advocates, accounts
      │                Next.js  apps/advocate-portal :3001   advocate app: register, login, profile
      │                    │
      │                    │  fetch / SSE   (NEXT_PUBLIC_API_BASE_URL, CORS-checked)
      ▼                    ▼
   ┌─────────────────────────────────────────────┐
   │ FastAPI  apps/api                     :8000 │
   │  /health, /health/ready                     │
   │  /api/v1/*   auth · chat · documents ·      │
   │              advocates · admin · status     │
   │  request-id middleware, structlog,          │
   │  one error envelope, per-client rate limit  │
   │                                             │
   │  app/services                               │
   │    classification   rules  ⇄  model         │
   │    retrieval        keyword + vector (RRF)  │
   │    answers          sources-only  ⇄  model  │
   │    documents        template      ⇄  model  │
   │    advocate recommendation, CSV import      │
   │    ingestion (Hugging Face, official Acts)  │
   └───────┬───────────────────┬─────────────────┘
           ▼                   ▼
   ┌────────────────┐    ┌───────────┐
   │ PostgreSQL 16  │    │ Redis 7   │   rate-limit counters, query-embedding cache
   │ + pgvector     │    └───────────┘
   │ + pg_trgm      │
   └────────────────┘

   Optional, only when configured or reachable:
     Gemini / Groq / Ollama / Anthropic   AI answers, drafts, embeddings
     huggingface.co                       legal documents loaded on API start
```

`docker-compose.yml` runs `db`, `redis`, `api`, `web` and `advocate-portal`. For development the
database and cache run in Docker while the API and the two Next.js apps run on the host with hot
reload ([`environments.md`](environments.md)).

## 2. Request flows

### Chat

```
message
  → classify            AI mode: model.    Offline, or model unavailable: rules classifier
                        → category, jurisdiction scope, risk (LOW..CRITICAL), out-of-scope?
  → out of scope?       fixed redirect reply, no sources
  → offline greeting?   fixed welcome reply, no sources
  → retrieve            Postgres full-text always; pgvector similarity too when passages are
                        embedded and a Gemini key is set; fused by reciprocal rank
  → answer
       AI mode          model answers only from the passages, cites [1], [2];
                        no passages → labelled "general information" (or a refusal)
       offline          passages laid out as text, numbered like the sources list,
                        text neutralised so it cannot fake a citation
  → HIGH / CRITICAL     append the advocate message; attach up to 3 matching verified advocates
  → persist             conversation, messages, sources, risk level
  → respond             JSON, or SSE: start → delta… → done (error only in AI mode)
```

Every response says how it was made: `answer_mode` is `"ai"` or `"sources_only"`. If a configured
provider fails, the turn returns an error and nothing is stored; classification alone degrades to
the rules classifier. Rules and thresholds: [ADR 0007](adr/0007-hybrid-search-and-grounding.md),
[ADR 0008](adr/0008-risk-scoring.md), [ADR 0010](adr/0010-free-llm-providers-and-streaming.md).

### Document assistant

```
GET /documents/types           the 11 types and their fixed questionnaires (static, not generated)
POST /documents {type, answers}
  → validate required answers  422 with per-field details
  → AI mode                    model writes a labelled draft + Notes
    offline                    deterministic template: label line, numbered clauses,
                               [PLACEHOLDERS], signature/witness blocks, Notes
  → persist, return            generation_mode: "ai" | "template"
```

Not RAG-grounded ([ADR 0009](adr/0009-document-assistant-scope.md)). Template drafts never state
section numbers, case names, stamp-duty figures or time limits.

### Advocates

```
data/advocates.csv ─► import (validate, upsert by id, codes kept as written, is_sample)
                   ─► users + advocate_profiles (VERIFIED, flagged Sample)
GET /advocates?practice_area&state&city&language&page   verified advocates only
GET /advocates/facets                                    filter values with counts
chat HIGH/CRITICAL ─► same table, ranked: practice area, user's state, experience
```

### Startup (background, never blocks or crashes the API)

```
alembic upgrade head (Compose command) → API starts serving
  ├─ create/update admin account            if ADMIN_EMAIL and ADMIN_PASSWORD are set
  ├─ import the advocates CSV               every start, idempotent
  └─ load legal documents from Hugging Face up to HF_MAX_DOCUMENTS, then embed new passages
     if a Gemini key is set; progress and failures are published on GET /api/v1/status
```

## 3. Repository layout

See the tree in the root [`README.md`](../README.md#repository-layout). Principles:

- **`apps/`** are the runnable units: two Next.js apps and one FastAPI app.
- **Domain logic lives in `apps/api/app/services/`** (classifiers, retrieval, answers, documents,
  ingestion, advocates). It is deliberately not split into separately deployed services; see
  [ADR 0004](adr/0004-domain-logic-in-api.md). The earlier `services/` placeholder folders were
  removed.
- **`packages/`** is shared TypeScript: `shared` (enums, constants, disclaimer, the design-system
  CSS), `auth` (token helpers and types), `database` (an unused Node DB client) and `eslint-config`.
- The database schema lives in **`apps/api`** (SQLAlchemy models and Alembic migrations).
  Everything else consumes it through the API.

## 4. Tech stack and rationale

| Concern     | Choice                                            | Why                                                                                                                       |
| ----------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Frontend    | Next.js 15 / React 19                             | App Router, server components, strong ecosystem                                                                           |
| Styling     | Tailwind CSS v4 plus a shared design system       | One look across both apps, light and dark themes, self-hosted fonts                                                       |
| API         | FastAPI + Pydantic v2                             | Async, typed, OpenAPI out of the box                                                                                      |
| ORM         | SQLAlchemy 2.0 (async)                            | Mature, explicit, works with pgvector                                                                                     |
| Migrations  | Alembic                                           | Autogenerate against the ORM metadata                                                                                     |
| Database    | PostgreSQL 16 + pgvector (+ `pg_trgm`)            | One store for relational data, full-text search and vectors                                                               |
| Cache       | Redis 7                                           | Rate-limit counters and the query-embedding cache; both fail open                                                         |
| AI          | Provider layer: Gemini, Groq, Ollama, Anthropic   | Free providers first, automatic Gemini/Groq fallback, optional ([ADR 0010](adr/0010-free-llm-providers-and-streaming.md)) |
| Offline     | Rules classifier, sources-only answers, templates | The product must be fully usable with no key and no network call                                                          |
| Logging     | structlog                                         | Structured, request-id correlated, console or JSON                                                                        |
| JS monorepo | pnpm workspaces + Turborepo                       | Efficient installs, cached task graph                                                                                     |
| Python deps | uv                                                | Fast, reproducible, lockfile-first                                                                                        |
| Run         | Docker Compose                                    | One command brings up the whole stack locally                                                                             |

Decision records: [`adr/`](adr/). Design tokens and components: [`design-system.md`](design-system.md).

## 5. Cross-cutting conventions

- **Config:** one `Settings` object (`apps/api/app/core/config.py`) and no direct `os.environ` reads.
  Frontends validate public env with zod (`src/lib/env.ts`).
- **Errors:** every non-2xx API response is `{ error: { code, message, details?, request_id } }`,
  typed in `@legal-platform/shared` as `ApiError`. AI failures use stable codes:
  `llm_not_configured` (internal; becomes offline mode for chat and documents), `llm_rate_limited`,
  `llm_error`.
- **Correlation:** `X-Request-ID` is accepted or generated per request, echoed in the response and
  attached to every log line.
- **Health:** `/health` (liveness, no dependencies) and `/health/ready` (checks Postgres and Redis,
  503 when unhealthy). `GET /api/v1/status` reports mode, library, directory and dependency state
  without secrets.
- **Themes:** `<html data-theme="light|dark">` forces a theme, no attribute follows the OS; the choice
  is stored in `localStorage["la-theme"]` and applied by an inline script before first paint.
- **Environments:** local only. See [`environments.md`](environments.md).

## 6. Security and safety posture

In place today:

- Role-based access control (consumer, advocate, admin, legal admin), short-lived JWT access tokens
  and rotating, revocable refresh tokens, bcrypt password hashing.
- Per-client rate limiting on chat and document endpoints; request validation with Pydantic; CORS
  limited to the local frontends; security headers on the Next.js apps.
- A prompt-injection boundary: retrieved text is fenced and declared untrusted in AI mode, and
  neutralised before display in offline mode.
- Product safeguards: the disclaimer is shown wherever legal information appears, high-risk matters
  route to an advocate, citations come only from retrieved documents, jurisdiction is flagged, and
  nothing claims an advocate-client relationship. Sample advocates are labelled as synthetic.

Not built (see [`roadmap.md`](roadmap.md), Future scope): audit logs, uploaded-file scanning, a
managed secrets store, tenant isolation for enterprise use, a private-network filter on admin
ingestion URLs, and real email delivery. `OPEN_LOGIN=true` is a demo convenience for a private
machine, and the Docker defaults include a known admin password and JWT secret; change them if the
computer is shared.
