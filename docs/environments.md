# Environments

LA_BOT runs on your own computer. There is no hosted staging or production setup, no launcher
script and no platform configuration for a hosting service. `APP_ENV` (`NEXT_PUBLIC_APP_ENV` on the
frontends) defaults to `development`.

You can run it two ways. Both use the same code and the same defaults; the difference is where each
piece runs and which file holds your settings.

|                       | Docker (run it)                             | Native (develop it)                                                                      |
| --------------------- | ------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Start                 | `docker compose up --build`                 | `docker compose up -d db redis`, then `uv run uvicorn ...` and `pnpm dev`                |
| Website / portal      | built images on :3000 / :3001               | `next dev` with hot reload on :3000 / :3001                                              |
| API                   | image on :8000                              | `uvicorn --reload` on :8000                                                              |
| Postgres + pgvector   | `pgvector/pgvector:pg16` container          | the same container (or your own PostgreSQL 16 with pgvector)                             |
| Redis                 | `redis:7-alpine` container                  | the same container (or your own Redis 7)                                                 |
| Settings file         | root `.env` (optional)                      | `apps/api/.env`, `apps/web/.env.local`, `apps/advocate-portal/.env.local` (all optional) |
| Database host in URLs | `db` (set by Compose)                       | `localhost`                                                                              |
| Logging               | `console`, level `LOG_LEVEL` (default INFO) | `console`, level `LOG_LEVEL` (example uses DEBUG)                                        |
| API docs (`/docs`)    | enabled                                     | enabled                                                                                  |

Every published port is bound to `127.0.0.1`, so nothing is reachable from other devices on your
network.

## Run it with Docker

```bash
docker compose up --build        # first run builds the images (a few minutes)
docker compose up -d             # later: start in the background
docker compose down              # stop, keep the data (add -v to wipe it)
```

It works with **no `.env` at all**: every variable has a default in `docker-compose.yml`. The API
container migrates the database, imports the sample advocates and, if it can reach huggingface.co,
loads legal documents in the background. To change anything, copy the example and edit it:

```bash
cp .env.example .env             # macOS / Linux
```

```powershell
Copy-Item .env.example .env      # Windows PowerShell
```

Copying the example unchanged leaves behaviour exactly as it is without a file. Windows: Docker
Desktop is required and must be running; the file must be named `.env`, not `.env.txt`, and saved as
UTF-8.

Compose reads the root `.env` for substitution only. It passes just the variables listed in the
`api` service of `docker-compose.yml` into the container, which is why the root example is short.
The web and portal images get `NEXT_PUBLIC_API_BASE_URL=http://localhost:${API_PORT}` as a build
argument, so after changing a port run `docker compose up --build` again.

## Develop natively

```bash
docker compose up -d db redis          # or: pnpm stack:up
pnpm install

cd apps/api
cp .env.example .env                   # PowerShell: Copy-Item .env.example .env
uv sync
uv run alembic upgrade head            # or, from the root: pnpm db:migrate
uv run uvicorn app.main:app --reload --port 8000     # or, from the root: pnpm api:dev
```

Then, from the repo root: `pnpm dev` (website :3000, portal :3001).

- `apps/api/.env` uses `localhost` for Postgres and Redis and lists both frontend origins in
  `CORS_ORIGINS`. The code default allows only `http://localhost:3000`, so without the file the
  advocate portal on :3001 is blocked by the API.
- The frontends need no env file. `apps/web/.env.example` and `apps/advocate-portal/.env.example`
  exist for pointing them at a different API address.
- Settings are read once at start. Restart `uvicorn` after editing `apps/api/.env`, and restart
  `pnpm dev` after editing a `.env.local` (`NEXT_PUBLIC_*` values are inlined at build time).

## Which setting goes where

| Setting group                                                                                               | Docker (root `.env`)              | Native API (`apps/api/.env`)    | Native frontends (`.env.local`)   |
| ----------------------------------------------------------------------------------------------------------- | --------------------------------- | ------------------------------- | --------------------------------- |
| AI keys and providers (Gemini, Groq, Ollama, Anthropic, fallback, embedding provider)                       | yes                               | yes                             | no (keys never reach the browser) |
| Legal library (`LEGAL_CORPUS_*`, `HF_*`)                                                                    | yes                               | yes                             | no                                |
| Sign-in (`OPEN_LOGIN`, `ADMIN_*`, `JWT_SECRET`)                                                             | yes                               | yes                             | no                                |
| Ports and database credentials                                                                              | yes (`*_PORT`, `POSTGRES_*`)      | via `DATABASE_URL`, `REDIS_URL` | no                                |
| Token lifetimes, pool sizes, models for embeddings and Anthropic, `ALLOW_GENERAL_ANSWERS`, ingestion limits | no (defaults apply)               | yes                             | no                                |
| `CORS_ORIGINS`, `FRONTEND_BASE_URL`                                                                         | derived from the ports            | yes                             | no                                |
| `NEXT_PUBLIC_API_BASE_URL`, `NEXT_PUBLIC_WEB_BASE_URL`, `NEXT_PUBLIC_APP_ENV`                               | build argument (API address only) | no                              | yes                               |

## AI mode is optional

With no AI key the product runs in **offline mode** (`GET /api/v1/status` shows `llm.mode:
"offline"`). Adding `GEMINI_API_KEY` and/or `GROQ_API_KEY` to the file for your run style (and
restarting) switches to `"ai"`. With both keys each backs up the other (`LLM_FALLBACK_PROVIDER`).
Vector search additionally needs `GEMINI_API_KEY` with `EMBEDDING_PROVIDER=gemini` (the default).
What each mode does is described in the root [`README.md`](../README.md#offline-mode-and-ai-mode)
and the services in [`api-inventory.md`](api-inventory.md).

## Defaults worth knowing

- **Sign-in:** `OPEN_LOGIN=true`, so any email and password signs in as a consumer. Advocate and
  admin accounts always need their real password.
- **Admin:** Compose defaults to `admin@labot.local` / `admin12345`. Change both in `.env` if anyone
  else uses the computer. Natively there is no admin until you set `ADMIN_EMAIL` and
  `ADMIN_PASSWORD` or run `uv run python -m app.scripts.create_admin --email you@example.com`.
- **`JWT_SECRET`:** a fixed local value. Fine on a private machine; change it otherwise.
- **Emails:** verification and reset links are written to the API log (event `email_dev_send`), not
  sent.
- **Secrets:** real keys go in the git-ignored `.env` files, never in a `.env.example`.

## Checks without disturbing a running dev stack

`pnpm exec tsc --noEmit`, `pnpm exec eslint .` and `pnpm exec vitest run` (in `apps/web` or
`apps/advocate-portal`) and `uv run pytest` (in `apps/api`) are safe while the stack runs. Avoid
`pnpm build` then: it writes the same `.next` folders as `next dev`. See the root
[`README.md`](../README.md#testing) for running the database tests.
