# legal-platform-api

FastAPI backend for LA_BOT, the Indian Legal Advisor Bot and advocate directory. It runs with **no AI
key** (offline mode) and gains AI-written answers and drafts when a Gemini and/or Groq key is
configured.

- [Run it](#run-it)
- [Layout](#layout)
- [Endpoints](#endpoints)
- [Offline mode and AI mode](#offline-mode-and-ai-mode)
- [Chat pipeline](#chat-pipeline)
- [Document assistant](#document-assistant)
- [Legal library and ingestion](#legal-library-and-ingestion)
- [Advocate directory](#advocate-directory)
- [Auth](#auth)
- [Migrations](#migrations)
- [Testing and quality gates](#testing-and-quality-gates)

## Run it

Most people run the whole product with `docker compose up --build` from the repo root (see the root
README). To develop the API with auto-reload:

```bash
docker compose up -d db redis            # from the repo root; same as: pnpm stack:up
cd apps/api
cp .env.example .env                     # PowerShell: Copy-Item .env.example .env
uv sync
uv run alembic upgrade head
uv run uvicorn app.main:app --reload --port 8000
```

Open <http://localhost:8000/docs> for the interactive docs. To call protected routes, click
**Authorize** and paste an access token from `/api/v1/auth/login`. Settings are read from
`apps/api/.env` (every key is optional; see `.env.example`). On startup the API, in the background
and without blocking requests: applies the optional admin account, imports
`data/advocates.csv`, and loads legal documents from Hugging Face when reachable. Failures are
logged, never raised.

## Layout

```
app/
├── main.py                  # app factory, middleware, lifespan (starts the background tasks)
├── core/
│   ├── config.py            # typed settings (the only place the environment is read)
│   ├── errors.py            # AppError hierarchy, handlers, the {error: {code, message, ...}} envelope
│   ├── security.py          # password hashing, one-time tokens, JWT access/refresh
│   ├── legal_text.py        # fixed product copy: disclaimer, out-of-scope, offline messages
│   ├── india.py             # state and language codes and names
│   └── logging.py           # structlog setup (console or JSON)
├── db/                      # SQLAlchemy base and async session
├── models/                  # user (+ advocate profile, tokens), chat, legal_document (+ chunks), document_request
├── schemas/                 # Pydantic request/response models
├── middleware/              # request id, access log, timing
├── services/
│   ├── llm_provider.py      # Gemini / Groq / Ollama / Anthropic behind one interface, with fallback
│   ├── legal_classifier.py  # category, scope, risk: model first, rules classifier as fallback
│   ├── rules_classifier.py  # deterministic keyword classifier used in offline mode
│   ├── risk_engine.py       # risk level -> "recommend an advocate?" decision
│   ├── llm.py               # grounded answers, sources-only answers, streaming
│   ├── rag/retrieval.py     # hybrid search (keyword + vector) fused by reciprocal rank
│   ├── ingestion/           # fetch, extract, clean, chunk, embed, store; Hugging Face loader
│   ├── document_assistant/  # questionnaires, AI generation, deterministic templates
│   ├── advocate_import.py   # CSV validation and upsert
│   ├── advocate_recommendation.py  # chat -> matching verified advocates
│   ├── startup.py           # admin bootstrap, advocate import, legal-library load
│   ├── rate_limit.py        # per-client limit on AI endpoints (Redis, fails open)
│   ├── email.py             # logs emails instead of sending them
│   └── redis.py, tokens.py, anthropic_client.py
├── scripts/                 # create_admin, import_advocates, ingest_hf_dataset, seed_corpus
└── api/
    ├── deps.py              # DB/Redis sessions, current user, role checks
    └── v1/routes/           # health, meta, auth, users, advocates, admin, chat, documents, legal_sources
data/advocates.csv           # 1000 synthetic advocates
migrations/                  # Alembic versions (0001 to 0009)
scripts/smoke_check.py       # end-to-end checks against a running API
tests/                       # pytest
```

## Endpoints

All under `/api/v1` unless noted. Every error uses one envelope:
`{"error": {"code", "message", "details"?, "request_id"}}`.

| Area      | Endpoints                                                                                                                                                    |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Health    | `GET /health` (liveness) and `GET /health/ready` (checks Postgres and Redis), both at the root                                                              |
| Meta      | `GET /meta`, `GET /status` (feature availability, no secrets), `POST /status/check-llm` (one small model call)                                                |
| Auth      | `POST /auth/register`, `/login`, `/refresh`, `/logout`, `/verify-email`, `/resend-verification`, `/forgot-password`, `/reset-password`; `GET`/`PATCH /users/me` |
| Chat      | `POST /chat/messages`, `POST /chat/messages/stream` (SSE), `GET /chat/conversations`, `GET /chat/conversations/{id}`                                          |
| Documents | `GET /documents/types`, `POST /documents`, `GET /documents`, `GET /documents/{id}`                                                                            |
| Advocates | `GET /advocates` (search), `GET /advocates/facets`, `GET /advocates/{id}`; `POST /advocates/register`, `GET`/`PATCH /advocates/me` for the advocate's own profile |
| Admin     | `GET /admin/users`, `PATCH /admin/users/{id}`, `GET /admin/advocates/pending`, `POST /admin/advocates/{id}/verify` and `/reject`, `POST /admin/advocates/import` |
| Sources   | `POST`, `GET` `/admin/legal-sources`, `GET /admin/legal-sources/search`, `GET`/`DELETE /admin/legal-sources/{id}`, `POST /admin/legal-sources/{id}/reindex`   |

Chat, documents and the advocate directory work without logging in. Admin and legal-source routes
need an ADMIN or LEGAL_ADMIN token. Chat and document requests are rate limited per client
(`AI_RATE_LIMIT_PER_MINUTE`, default 20, answered with `429` and `Retry-After`).

## Offline mode and AI mode

`GET /status` returns `llm.mode`: `"ai"` when a provider is configured, otherwise `"offline"`
(`llm.configured` keeps its meaning). A provider is configured by `GEMINI_API_KEY`, `GROQ_API_KEY`,
`OLLAMA_BASE_URL` or `ANTHROPIC_API_KEY`; `LLM_PROVIDER=auto` picks the first in that order. When two
free providers are configured, a failed request is retried once on the other
(`LLM_FALLBACK_PROVIDER`); a stream only falls back before its first token.

| Feature        | Offline mode                                                                  | AI mode                                                       |
| -------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Classification | `rules_classifier`: weighted whole-word vocabulary, English and Hinglish      | The model; on any provider outage, the rules classifier       |
| Chat reply     | `answer_mode: "sources_only"`, built from the retrieved passages              | `answer_mode: "ai"`, written by the model from the passages   |
| Documents      | `generation_mode: "template"`, deterministic draft                            | `generation_mode: "ai"`                                       |
| Errors         | No `503 llm_not_configured`; everything above still works                     | `llm_rate_limited` / `llm_error` surface as `503`, nothing is stored for that turn |

Only "no provider configured" means offline. A configured provider that fails is an error, not
offline mode.

## Chat pipeline

`POST /chat/messages` (and the streaming variant) works with or without a bearer token. Request:
`{"message": "...", "conversation_id": null}` (message up to 4000 characters).

1. **Classify** (`legal_classifier.classify_query`): category (14 in-scope categories, plus
   `OUT_OF_SCOPE`), jurisdiction scope (central, state, court, stamp duty, ...), risk level
   LOW/MEDIUM/HIGH/CRITICAL, and whether the text is out of scope. See
   [ADR 0008](../../docs/adr/0008-risk-scoring.md).
2. **Out of scope** returns `OUT_OF_SCOPE_MESSAGE` with `sources: null`. In offline mode a greeting
   or "what can you do" returns a fixed welcome message, also with `sources: null`.
3. **Retrieve** (`rag/retrieval.hybrid_search`): Postgres full-text search, plus pgvector cosine
   similarity when chunks are embedded and `GEMINI_API_KEY` is set, fused with reciprocal rank
   fusion ([ADR 0007](../../docs/adr/0007-hybrid-search-and-grounding.md)). If the embedding service
   is unavailable, search falls back to keywords only.
4. **Answer**:
   - AI mode: the model answers using only the retrieved passages and cites them as `[1]`, `[2]`.
     Passages are fenced as untrusted text. With no passages, the reply opens with a "general
     information only" notice (`ALLOW_GENERAL_ANSWERS=false` refuses instead).
   - Offline mode (`llm.build_sources_only_answer`): a fixed intro, then per source
     `[n] Title[, Section X][, Article Y] (court - date - citation)` and a 600-character excerpt, then
     a fixed outro. Numbering matches the `sources` list. Source text is untrusted: it is flattened to
     one line, control and bidi characters are removed, `< >` become quote marks, `[ ]` become `( )`,
     and leading Markdown markers are stripped, so a hostile passage cannot forge a `[n]` marker.
     Missing parts are omitted, never invented. With no matching passages the text says plainly that
     nothing in the library matched and AI answers are off, and `sources` is `[]`.
5. **Advocates**: for HIGH and CRITICAL, the reply gets "This matter may require advice from a
   qualified advocate." and `recommended_advocates` (up to 3 verified advocates: the question's own
   practice area first, then related ones; the user's profile state; then experience). Same in both
   modes.

The response carries `assistant_message.sources` (document title, section/article, court, date,
citation, case name, dataset, source URL, excerpt), `recommended_advocates`, `disclaimer` and
`answer_mode`. The stream sends `start` (classification, `answer_mode`, sources, advocates), one or
more `delta` events, then `done` (the same body as the non-streaming response) or `error`. In
offline mode there is one `delta` for the text and one for the advocate suffix, and no `error`.

## Document assistant

`GET /documents/types` returns the 11 document types and each one's fixed questionnaire
([ADR 0009](../../docs/adr/0009-document-assistant-scope.md)). `POST /documents` validates the
answers against that type's required questions (`422` with per-field details), builds the draft and
stores it. `generation_mode` says how:

- `"ai"`: one model call writes a labelled draft plus a Notes section.
- `"template"` (`document_assistant/templates.py`): the first line is always the label below, then a
  title, numbered sections, signature and witness blocks, and Notes. Unanswered items are
  `[BRACKETED PLACEHOLDERS]`, and bare numbers are formatted as `Rs. 25,000` with Indian digit
  grouping. It never states statute section numbers, case names, stamp-duty figures or statutory
  time limits; the notes say stamp duty, notarisation and registration depend on the state the user
  named, and that the draft needs an advocate's review.

  > TEMPLATE DRAFT - generated without AI from your answers. Review with an advocate before use.

Drafts are not RAG-grounded. A configured provider that fails returns `503` and nothing is stored.

## Legal library and ingestion

Documents live in `legal_documents` and `legal_chunks` (with a pgvector column and a generated
`tsvector` column for keyword search).

- **Hugging Face** (`ingestion/hf_dataset.py`): on startup, and via
  `uv run python -m app.scripts.ingest_hf_dataset` (`--inspect`, `--max-documents N`,
  `--embed-missing`, `--from-start`). Defaults come from `HF_*`; no key is needed for public
  datasets. Progress and failures appear in `GET /status` under `knowledge_base.corpus_load`.
- **Official Acts** (`ingestion/official_sources.py`, 15 central Acts):
  `uv run python -m app.scripts.seed_corpus` (`--list`, `--only`, `--retry-failed`). Needs
  `GEMINI_API_KEY`, because every passage is embedded.
- **Admin ingestion**: `POST /admin/legal-sources` fetches a URL, extracts PDF or HTML, cleans,
  chunks (about 1500 characters, 200 overlap, [ADR 0006](../../docs/adr/0006-chunking-strategy.md)),
  embeds and stores. Failures are recorded on the row (`ingestion_status=FAILED`, reason), not raised.

Without embeddings (no Gemini key, or `EMBEDDING_PROVIDER=none`) retrieval is keyword-only.
`section`/`article` are not extracted from PDFs, so citations name the document.

## Advocate directory

`GET /advocates` returns verified advocates only, paginated (`page` and `page_size`, or `limit` and
`offset`). Filters: `practice_area` (name or code), `state` / `state_code`, `city` (substring),
`language` / `language_code`, `min_experience_years`, `max_consultation_fee`. State and language
codes are exact and case-sensitive; unknown codes return `422` naming the field. `GET
/advocates/facets` lists the values present, with counts. Unknown and unverified ids return the same
`404`. `data/advocates.csv` is imported with `is_sample=true`, so entries are flagged as samples.
Re-importing is idempotent and never deletes or changes a rejection.

## Auth

- Access tokens are short-lived JWTs (`ACCESS_TOKEN_TTL_MINUTES`). Refresh tokens carry a `jti`, are
  stored hashed, and are rotated on every `/auth/refresh`, so logout really revokes.
- Roles: CONSUMER, ADVOCATE, ADMIN, LEGAL_ADMIN, ENTERPRISE_USER; routes use
  `require_roles(...)`.
- `OPEN_LOGIN=true` (the default) lets any email and password sign in as a consumer. Advocate and
  admin accounts always need their real password.
- There is no public admin sign-up. Set `ADMIN_EMAIL` and `ADMIN_PASSWORD` (created or updated on
  every start), or run `uv run python -m app.scripts.create_admin --email you@example.com`.
- Verification and reset emails are logged, not sent (event `email_dev_send`); read the link from the
  API output.

## Migrations

```bash
uv run alembic upgrade head                              # apply
uv run alembic revision --autogenerate -m "describe it"  # create
uv run alembic downgrade -1                              # roll back one
```

Alembic reads `DATABASE_URL_SYNC` (psycopg), falling back to `DATABASE_URL` with the driver swapped.
Every model module must be imported in `app/models/__init__.py` for autogenerate to see it. Native
Postgres enums use the `create_type=False` plus explicit `.create()`/`.drop()` pattern (see
`migrations/versions/20260102_0000-0002_auth_tables.py`). CI runs `alembic check` to catch model
changes without a migration.

## Testing and quality gates

```bash
uv run pytest -q
uv run ruff check . && uv run ruff format --check .
uv run mypy .
```

The suite needs no AI keys, Redis is used on database 1, and Hugging Face is never contacted. Two
fixtures live in `tests/conftest.py`: `client` (no database) and `db_client` (every request runs
inside one transaction that is rolled back afterwards). Tests that need Postgres **skip
automatically** when it is unreachable. They connect to `DATABASE_URL`, defaulting to
`postgresql+asyncpg://legal:legal@localhost:5432/legal_platform_test`, so create that database (or set
`DATABASE_URL` and `DATABASE_URL_SYNC` to another empty one), run `uv run alembic upgrade head`
against it, then `uv run pytest`. The root README has a copy-paste recipe for the Docker database.

`scripts/smoke_check.py` checks a running API end to end, in both modes:

```bash
uv run python scripts/smoke_check.py http://localhost:8000
```

Pass the API address explicitly: the script's built-in default is the website's port. It compares
advocate counts with `data/advocates.csv`, so run it against a directory that holds only that file.
