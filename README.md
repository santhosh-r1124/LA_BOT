# LA_BOT

**Indian Legal Advisor Bot and advocate directory.** Ask a question about Indian law, get the
passages from a legal library that answer it (with their sources), see how serious the matter looks,
draft common legal documents from a questionnaire, and find an advocate. It runs on your own
computer: there is no hosted version, and your questions stay on it unless you add an AI key (the
only other network use is downloading public legal documents from Hugging Face).

It is a legal-**information** tool, not a lawyer. For serious matters it points you to a qualified
advocate rather than acting as one.

- [What works today](#what-works-today)
- [Quick start](#quick-start)
- [Configuration](#configuration)
- [Offline mode and AI mode](#offline-mode-and-ai-mode)
- [Data](#data)
- [Repository layout](#repository-layout)
- [Common commands](#common-commands)
- [Testing](#testing)
- [Troubleshooting](#troubleshooting)
- [More documentation](#more-documentation)

---

## What works today

**No API key is needed.** With none configured the product runs in _offline mode_ and every feature
below works.

| Feature                  | What it does                                                                                                                                                                                                             |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Legal chat               | Classifies the question (topic, central/state/court scope, risk LOW to CRITICAL), searches the legal library and replies with numbered sources `[1]`, `[2]`. Streams over SSE. Non-legal questions get a plain redirect. |
| Risk and advocate prompt | HIGH and CRITICAL questions (arrest, bail, summons, unpaid wages, a legal notice received...) add "This matter may require advice from a qualified advocate" and up to 3 matching advocates.                             |
| Document assistant       | 11 document types (rental agreement, NDA, affidavit, legal notice, ...), each with a fixed questionnaire. Produces a draft plus notes on stamping, registration and supporting documents. Copy or download as text.      |
| Advocate directory       | Search and filter by practice area, state, city and language; profile pages; facets. The bundled 1000 advocates are **synthetic samples** and are labelled "Sample" everywhere.                                          |
| Accounts                 | Register, log in, email verification, password reset, profile. Emails are written to the API log, not sent. Demo sign-in is open by default (see [Configuration](#configuration)).                                       |
| Advocate portal          | Separate app on :3001: advocate registration, login and profile. Dashboard, requests and earnings are not built.                                                                                                         |
| Admin                    | An admin can upload advocate CSVs at `/advocates/import`. Verifying advocates and managing legal sources are API-only (`/docs`); there is no admin UI.                                                                   |
| Themes                   | Light and dark, following your OS, with a toggle in the header (saved in the browser as `la-theme`).                                                                                                                     |

**Not built yet:** consultation booking, payments, real email/SMS, the advocate dashboard, an admin
UI, video consultation. See [`docs/project-status.md`](docs/project-status.md) for the honest
per-feature status and [`docs/roadmap.md`](docs/roadmap.md) for the plan.

## Quick start

### Option A: Docker (recommended, works with no `.env`)

You need [Docker Desktop](https://www.docker.com/products/docker-desktop/) (Windows, macOS) or Docker
Engine with the Compose plugin (Linux).

```bash
docker compose up --build
```

The first run builds the images and takes a few minutes. When it settles:

| What            | Where                                                 |
| --------------- | ----------------------------------------------------- |
| Website         | <http://localhost:3000>                               |
| Advocate portal | <http://localhost:3001>                               |
| API and docs    | <http://localhost:8000> (interactive docs at `/docs`) |

Everything starts with defaults: database migrations run, the 1000 sample advocates are imported, an
admin account exists (see below) and the legal library starts loading from Hugging Face in the
background if the computer can reach it. All ports are bound to `127.0.0.1`, so nothing is exposed
to your network.

```bash
docker compose up -d      # start again later, in the background
docker compose logs -f api
docker compose down       # stop (data is kept); add -v to wipe the database
```

To add AI answers or change a port, copy the example and edit it (all of it is optional):

```bash
cp .env.example .env              # macOS / Linux
```

```powershell
Copy-Item .env.example .env       # Windows PowerShell
```

Then run `docker compose up --build` again (the website bakes in the API address at build time).

**Windows:** install Docker Desktop, start it and wait until it says the engine is running, then run
the commands above in PowerShell from the project folder. Make sure the file is called `.env`, not
`.env.txt` (see [Troubleshooting](#troubleshooting)).

### Option B: native development (hot reload)

You need Node.js 22.11 or newer, pnpm 10 (`corepack enable`), Python 3.12 or newer,
[uv](https://docs.astral.sh/uv/) (`pip install uv`) and Docker (or your own PostgreSQL 16 with
pgvector, plus Redis 7).

```bash
docker compose up -d db redis        # same as: pnpm stack:up
pnpm install

cd apps/api
cp .env.example .env                 # PowerShell: Copy-Item .env.example .env
uv sync
uv run alembic upgrade head
uv run uvicorn app.main:app --reload --port 8000
```

In a second terminal, from the project root:

```bash
pnpm dev                             # website :3000 and advocate portal :3001
```

`apps/api/.env` points at `localhost` for Postgres and Redis (inside Docker they are `db` and
`redis`) and allows both frontend origins in `CORS_ORIGINS`; without it the portal on :3001 is
blocked by the API. The frontends need no env file. The API imports the sample advocates and starts
the legal-library load by itself on startup.

### Signing in

- **Open login is on by default** (`OPEN_LOGIN=true`): any email with any password signs in as a
  consumer, creating the account on first use. Advocate and admin accounts still need their real
  password. Set `OPEN_LOGIN=false` for normal credential checks.
- **Admin:** with Docker the default admin is `admin@labot.local` / `admin12345`, set by
  `ADMIN_EMAIL` and `ADMIN_PASSWORD`. Change both in `.env` if anyone else uses the computer. Natively,
  set them in `apps/api/.env` or run `uv run python -m app.scripts.create_admin --email you@example.com`.
- **Verification and reset emails** are not sent. The link is printed in the API log
  (`docker compose logs api`, or the uvicorn terminal), on a line named `email_dev_send`.

## Configuration

Docker reads `.env` in the project root; every variable has a default, so the file is optional. The
API run natively reads `apps/api/.env` instead (the full list is in
[`apps/api/.env.example`](apps/api/.env.example)). The frontends read `apps/web/.env.local` and
`apps/advocate-portal/.env.local` (only `NEXT_PUBLIC_*` values, all optional).

| Variable                                            | Default                                         | Meaning                                                                                                      |
| --------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `GEMINI_API_KEY`                                    | empty                                           | Switches on AI answers and vector search. Free key: <https://aistudio.google.com/apikey>.                    |
| `GROQ_API_KEY`                                      | empty                                           | Switches on AI answers (free key: <https://console.groq.com/keys>). With both keys, each backs up the other. |
| `LLM_PROVIDER`                                      | `auto`                                          | `auto` picks the first configured of gemini, groq, ollama, anthropic. Or name one.                           |
| `LLM_FALLBACK_PROVIDER`                             | `auto`                                          | Provider tried when the first fails. `auto` is the other of Gemini/Groq; `none` disables it.                 |
| `EMBEDDING_PROVIDER`                                | `gemini`                                        | Vector search needs this and `GEMINI_API_KEY`. `none` forces keyword-only search.                            |
| `OLLAMA_BASE_URL`, `ANTHROPIC_API_KEY`              | empty                                           | Optional alternative providers (local Ollama, paid Anthropic).                                               |
| `AI_RATE_LIMIT_PER_MINUTE`                          | `20`                                            | Per-client limit on chat and document requests. `0` turns it off.                                            |
| `LEGAL_CORPUS_AUTOLOAD`                             | `true`                                          | Load legal documents from Hugging Face in the background when the API starts.                                |
| `HF_DATASET_NAME`, `HF_MAX_DOCUMENTS`               | `Sumitedu/indian-case-laws`, `200`              | Which dataset, and how many documents to keep indexed.                                                       |
| `HF_TOKEN`                                          | empty                                           | Only for gated or private datasets.                                                                          |
| `OPEN_LOGIN`                                        | `true`                                          | Demo sign-in: any email and password works for consumers.                                                    |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD`                     | `admin@labot.local`, `admin12345` (Docker)      | The admin account created or updated on every start. Empty natively.                                         |
| `JWT_SECRET`                                        | a local-only value                              | Signs login tokens. Change it if anyone else can reach the machine.                                          |
| `WEB_PORT`, `ADVOCATE_PORTAL_PORT`, `API_PORT`      | `3000`, `3001`, `8000`                          | Host ports. Rebuild after changing them (`docker compose up --build`).                                       |
| `POSTGRES_PORT`, `REDIS_PORT`                       | `5432`, `6379`                                  | Host ports for the database and cache.                                                                       |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | `legal`, `legal_dev_password`, `legal_platform` | Database credentials created on first start.                                                                 |
| `LOG_LEVEL`                                         | `INFO`                                          | `DEBUG`, `INFO`, `WARNING` or `ERROR`.                                                                       |

Model names (`GEMINI_LLM_MODEL`, `GROQ_MODEL`, `OLLAMA_MODEL`), the embedding model and every other
setting are listed with comments in the `.env.example` files. [`docs/environments.md`](docs/environments.md)
says which file each setting belongs in.

## Offline mode and AI mode

The mode is decided by whether an AI provider key is configured. `GET /api/v1/status` reports it as
`llm.mode` (`"offline"` or `"ai"`), and the website shows it.

|                  | Offline mode (no key)                                                                                                                                        | AI mode (a Gemini and/or Groq key)                                                                                                                                    |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Classification   | A deterministic rules classifier (English and Hinglish vocabulary) gives category, scope and risk. A greeting gets a short welcome.                          | The model classifies. If it is unreachable, the rules classifier is used instead.                                                                                     |
| Chat reply       | `answer_mode: "sources_only"`. The matching passages are laid out as text, numbered `[1]`, `[2]` to match the sources list. Nothing is paraphrased or added. | `answer_mode: "ai"`. The model answers only from the retrieved passages and cites them. If nothing was retrieved it says so and labels the reply general information. |
| No match         | Says plainly that nothing in the library matched and that AI answers are off.                                                                                | As above, a labelled general answer (`ALLOW_GENERAL_ANSWERS=false` refuses instead).                                                                                  |
| Documents        | `generation_mode: "template"`. A labelled template draft built from your answers, with placeholders for anything unanswered and a Notes section.             | `generation_mode: "ai"`. The model writes the draft and notes.                                                                                                        |
| Search           | Keyword search (Postgres full text).                                                                                                                         | Keyword plus vector search when `EMBEDDING_PROVIDER=gemini` and a Gemini key are set, fused by rank.                                                                  |
| Advocates        | Unchanged: HIGH/CRITICAL questions still return matching advocates.                                                                                          | Unchanged.                                                                                                                                                            |
| Provider failure | Not applicable.                                                                                                                                              | Quota or outage errors surface as a clear message and nothing is saved for that turn. With two keys, the other provider is tried automatically.                       |

Template drafts never quote statute section numbers, case names, stamp-duty figures or time limits.
Stamp duty, notarisation and registration depend on the state, and the notes say so.

## Data

**Legal library.** On startup the API reads court judgments from the Hugging Face dataset
`Sumitedu/indian-case-laws` (up to `HF_MAX_DOCUMENTS`, default 200) into Postgres. This needs a
connection to huggingface.co and no key. If it cannot connect, the API keeps running; the reason is
shown in `GET /api/v1/status` under `knowledge_base.corpus_load` and the library stays empty, so chat
replies "nothing matched". Without embeddings, retrieval is keyword-only. Details and licence
notes: [`docs/legal-dataset.md`](docs/legal-dataset.md).

The official Acts (15 central Acts from India Code) can also be indexed with `pnpm kb:seed`. That one
**needs `GEMINI_API_KEY`**, because the ingestion pipeline embeds every passage.

**Advocates.** `apps/api/data/advocates.csv` holds 1000 **synthetic** advocates
(`advocate_id, name, email, phone, practice_area, state, city, language_code`). The API imports it on
every start and marks every row as a sample, so listings carry a "Sample" badge and profile pages say
the person is not a real, verified advocate. State codes (`TN`, `KA`, `TS`, ...) and language codes
(`ta`, `en`, `hi`, ...) are stored exactly as written; a wrong-case row is rejected with a reason.
Re-importing updates by `advocate_id` and never deletes. To import your own file, log in as admin and
use `/advocates/import`, or run the command in [Common commands](#common-commands). Imported
advocates cannot log in until they set a password through "forgot password".

## Repository layout

```
LA_BOT/
├── apps/
│   ├── web/                # Next.js 15 website: chat, documents, advocates, accounts (:3000)
│   ├── advocate-portal/    # Next.js 15 advocate app: register, login, profile (:3001)
│   └── api/                # FastAPI backend, SQLAlchemy, Alembic (:8000)
│       ├── app/            #   api/ core/ db/ models/ schemas/ middleware/ scripts/
│       │   └── services/   #   domain logic: rag, ingestion, classifiers, llm, document_assistant
│       ├── data/           #   advocates.csv (synthetic)
│       ├── migrations/     #   Alembic versions
│       ├── scripts/        #   smoke_check.py
│       └── tests/          #   pytest suite
├── packages/
│   ├── shared/             # enums, constants, disclaimer, and the design system CSS
│   ├── auth/               # token helpers and types
│   ├── database/           # typed Node DB client (schema is owned by apps/api)
│   └── eslint-config/      # shared lint rules
├── docs/                   # status, architecture, roadmap, environments, ADRs, design system
├── docker-compose.yml      # db, redis, api, web, advocate-portal
└── .env.example            # optional settings for Docker
```

Stack: Next.js 15 (App Router, React 19) with Tailwind CSS v4; FastAPI with Pydantic v2 and async
SQLAlchemy 2; PostgreSQL 16 with pgvector; Redis 7 (rate limits, embedding cache); pnpm workspaces
with Turborepo; Python managed by uv; logging with structlog; CI in
`.github/workflows/ci.yml`. Design decisions are recorded in [`docs/adr/`](docs/adr/).

## Common commands

Run from the project root unless noted.

| Command                                                                                        | What it does                                                                                                                      |
| ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `docker compose up --build`                                                                    | Build and run everything                                                                                                          |
| `pnpm stack:up` / `pnpm stack:down` / `pnpm stack:logs`                                        | Start only Postgres and Redis / stop the stack / follow logs                                                                      |
| `pnpm docker:up`                                                                               | Build and start the full stack in the background                                                                                  |
| `pnpm dev`                                                                                     | Website and portal with hot reload                                                                                                |
| `pnpm api:dev`                                                                                 | API with auto-reload on :8000                                                                                                     |
| `pnpm db:migrate`                                                                              | Apply database migrations                                                                                                         |
| `pnpm db:revision "describe the change"`                                                       | Autogenerate a migration after a model change                                                                                     |
| `pnpm lint`, `pnpm typecheck`, `pnpm test`                                                     | Lint, type-check and test the JavaScript workspace                                                                                |
| `pnpm build`                                                                                   | Production build of both apps (stop `pnpm dev` first; they share `.next`)                                                         |
| `pnpm format` / `pnpm format:check`                                                            | Prettier write / check                                                                                                            |
| `pnpm kb:inspect`                                                                              | Look at the Hugging Face dataset without loading it                                                                               |
| `pnpm seed:legal`                                                                              | Load the Hugging Face documents now, then embed them (the embedding step needs a Gemini key and only prints a notice without one) |
| `pnpm kb:seed`                                                                                 | Index the 15 official Acts (needs `GEMINI_API_KEY`)                                                                               |
| `cd apps/api` then `uv run python -m app.scripts.import_advocates data/advocates.csv --sample` | Re-import the sample advocates (`--dry-run` to preview)                                                                           |
| `cd apps/api` then `uv run python -m app.scripts.create_admin --email you@example.com`         | Create or promote an admin account                                                                                                |
| `cd apps/api` then `uv run python scripts/smoke_check.py http://localhost:8000`                | End-to-end API checks against the running API                                                                                     |

## Testing

```bash
pnpm test                    # website, shared and auth packages (vitest)
pnpm typecheck && pnpm lint  # TypeScript and ESLint

cd apps/api
uv run pytest                # backend
uv run ruff check . && uv run ruff format --check . && uv run mypy .
```

The backend suite needs no AI keys and never reaches Hugging Face. Tests that touch the database
use `DATABASE_URL` (default `postgresql+asyncpg://legal:legal@localhost:5432/legal_platform_test`),
run inside a rolled-back transaction, and **skip** if Postgres is unreachable. To run them against
the Docker database, create a throwaway database, migrate it, and point both URLs at it:

```bash
docker compose up -d db
docker compose exec db createdb -U legal legal_platform_test
cd apps/api
export DATABASE_URL=postgresql+asyncpg://legal:legal_dev_password@localhost:5432/legal_platform_test
export DATABASE_URL_SYNC=postgresql+psycopg://legal:legal_dev_password@localhost:5432/legal_platform_test
uv run alembic upgrade head
uv run pytest
```

In PowerShell use `$env:DATABASE_URL = "..."` instead of `export`. The smoke check needs the API
running with the bundled sample advocates and nothing else in the directory.

## Troubleshooting

| Problem                                                                                   | What to do                                                                                                                                                                                                                                                                                                                  |
| ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "localhost refused to connect" or the page never loads                                    | Run `docker compose ps`: all five services should be `running` (db and redis `healthy`). The first build takes a few minutes. Use `http://` (not `https://`) and `localhost` (not `127.0.0.1`: the API only allows `localhost` origins). Check `docker compose logs web api`.                                               |
| Docker is not running ("cannot connect to the Docker daemon", "dockerDesktopLinuxEngine") | Start Docker Desktop and wait until it reports the engine is running, then retry.                                                                                                                                                                                                                                           |
| "port is already allocated" or "address already in use"                                   | Another program uses that port. Find it (`netstat -ano \| findstr :3000` on Windows, `lsof -i :3000` elsewhere) and stop it, or set `WEB_PORT`, `ADVOCATE_PORTAL_PORT`, `API_PORT`, `POSTGRES_PORT` or `REDIS_PORT` in `.env` and run `docker compose up --build`. A local PostgreSQL service on 5432 is the usual culprit. |
| Settings in `.env` are ignored                                                            | On Windows the file may be `.env.txt` (Notepad adds `.txt` and Explorer hides it). Turn on "File name extensions" in Explorer and rename it to `.env`. Save it as UTF-8. Docker reads the root `.env`; the native API reads `apps/api/.env`.                                                                                |
| Chat says nothing in the library matched                                                  | The library is empty or loading. Check `GET /api/v1/status` (`knowledge_base.documents_indexed` and `corpus_load`). If Hugging Face is blocked on your network, `corpus_load.state` is `failed`: the product still works, but with no documents there is nothing to show.                                                   |
| Hugging Face is blocked on your network                                                   | Set `LEGAL_CORPUS_AUTOLOAD=false` to stop the attempts, and run `pnpm seed:legal` later when the network allows it.                                                                                                                                                                                                         |
| Browser console shows CORS errors (native run)                                            | `apps/api/.env` is missing or `CORS_ORIGINS` lacks the origin you are using. Copy `apps/api/.env.example` and restart the API.                                                                                                                                                                                              |
| API cannot reach Postgres or Redis (native run)                                           | Start them with `docker compose up -d db redis` and check `apps/api/.env` uses `localhost`, not `db` or `redis`.                                                                                                                                                                                                            |
| `pnpm` not found, or "Unsupported engine"                                                 | Install Node.js 22.11 or newer, then `corepack enable` (on Windows, in an administrator shell) or `npm install -g pnpm`. The repo pins pnpm 10 and switches to it automatically.                                                                                                                                            |
| `uv` not found                                                                            | `pip install uv`, or see <https://docs.astral.sh/uv/getting-started/installation/>. Python 3.12 or newer is required.                                                                                                                                                                                                       |
| Chat returns an error after adding an AI key                                              | Free-tier quotas are limited: wait a minute, or add the second provider's key for automatic fallback. `POST /api/v1/status/check-llm` makes one small call to the provider and reports the exact error.                                                                                                                     |
| Start over                                                                                | `docker compose down -v` removes the database volume; `docker compose up --build` recreates it.                                                                                                                                                                                                                             |

## More documentation

- [`docs/project-status.md`](docs/project-status.md): what is complete, partial and not built
- [`docs/architecture.md`](docs/architecture.md): how the pieces fit
- [`docs/environments.md`](docs/environments.md): which settings go where
- [`docs/api-inventory.md`](docs/api-inventory.md): every external service, its limits and failure behaviour
- [`docs/roadmap.md`](docs/roadmap.md): phases and future scope
- [`docs/legal-dataset.md`](docs/legal-dataset.md), [`docs/design-system.md`](docs/design-system.md), [`docs/adr/`](docs/adr/)
- [`apps/api/README.md`](apps/api/README.md), [`apps/web/README.md`](apps/web/README.md), [`packages/database/README.md`](packages/database/README.md)

## Disclaimer

This software provides general legal information and document guidance from the sources it holds.
It is not legal advice, does not create an advocate-client relationship, and is no substitute for a
qualified legal professional. Laws and procedures vary by state and circumstances. Advocate listings
in the bundled data are synthetic samples, not real people.

## License

Proprietary, all rights reserved (placeholder; set the licence before any external use).
