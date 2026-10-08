# Deploying LA_BOT on Railway

One Railway service runs the whole app. The repo-root `Dockerfile` builds the
Next.js web app and the FastAPI API into one image. The web server listens on
Railway's `$PORT` and proxies `/api/v1/*` and `/health` to the API inside the
container, so the site and the API share one URL: no CORS setup and no API
URL to configure.

On every start the container runs the database migrations, imports
`apps/api/data/advocates.csv` into the advocate directory (added or updated,
never deleted), then starts both servers (`infrastructure/railway/start.sh`).

## 1. Services

In the Railway project, alongside the LA_BOT service (deploying from `main`):

- **+ New → Database → pgvector** (not plain Postgres: the first migration
  enables the `vector` extension).
- **+ New → Database → Redis**.

LA_BOT service settings: leave **Custom Start Command** empty (the Dockerfile
starts everything), **Healthcheck Path** `/health`, and under **Networking**
generate a domain. Leave the target port empty or set it to the `PORT`
variable below.

## 2. Variables (LA_BOT service)

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | `${{pgvector.DATABASE_URL}}` (use your database service's name) |
| `REDIS_URL` | `${{Redis.REDIS_URL}}` |
| `GEMINI_API_KEY` | Free key from https://aistudio.google.com/apikey |
| `LLM_PROVIDER` | `gemini` |
| `JWT_SECRET` | Any long random string (without it, sessions reset on every deploy) |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | Optional: an admin account that can upload advocate CSVs |
| `PORT` | `8080` (must match the domain's target port if you set one) |

Optional switches: `OPEN_LOGIN=false` turns off demo login (any email and
password), `ALLOW_GENERAL_ANSWERS=false` makes chat answer only from indexed
official sources, `GEMINI_LLM_MODEL` overrides the model (default
`gemini-flash-latest`; the app falls back to other Gemini models if one is
unavailable).

## 3. Check it

- `https://<your-domain>/health` returns `{"status":"ok",...}`.
- `https://<your-domain>/health/ready` shows database and Redis `ok`.
- The home page's **Platform status** panel shows the AI model as *Working*
  after the first chat message, or *Failing* with the reason (for example a
  rejected API key).

## Updating the advocate directory

Either replace `apps/api/data/advocates.csv` and push (it is imported on the
next deploy), or sign in with the admin account and upload a CSV at
`/advocates/import`. Columns: `advocate_id, name, email, phone,
practice_area, state, city, language_code` (common alternatives such as
`mobile` or `specialization` are recognised; several values in one cell are
separated with `;`).

## Running locally

See `docker-compose.yml`: put `GEMINI_API_KEY=...` in a `.env` file next to
it and run `docker compose up --build`, then open http://localhost:3010 (the
API is also published at http://localhost:8010, docs at `/docs`; set
WEB_PORT / API_PORT in `.env` to use other ports).
