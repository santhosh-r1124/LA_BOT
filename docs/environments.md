# Environments

LA_BOT runs on your own computer. There is no hosted staging or production
setup; `APP_ENV` (`NEXT_PUBLIC_APP_ENV` on the frontends) defaults to
`development`.

| | local |
| --- | --- |
| Frontends | `next dev`, or the Docker image behind `START-LA-BOT.bat` |
| API | `uvicorn` locally, or Docker Compose |
| Postgres + pgvector | Docker Compose (`pgvector/pgvector`) |
| Redis | Docker Compose (`redis:7`) |
| Logging | `console`, `DEBUG` |
| API docs (`/docs`) | enabled |

## Easiest: the launcher

On Windows, copy `.env.example` to `.env`, add `GEMINI_API_KEY` and/or
`GROQ_API_KEY`, then double-click `START-LA-BOT.bat` (needs Docker Desktop).
Anywhere else: `docker compose up --build`.

## Developing

```bash
cp .env.example .env
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
cp apps/advocate-portal/.env.example apps/advocate-portal/.env.local

pnpm install
pnpm stack:up          # postgres + redis + api  (Docker)
pnpm db:migrate        # alembic upgrade head
pnpm --filter @legal-platform/web dev
pnpm --filter @legal-platform/advocate-portal dev
```

Full stack in Docker (adds the two Next apps):

```bash
docker compose -f infrastructure/docker/docker-compose.yml --project-directory . --profile web up -d --build
```
