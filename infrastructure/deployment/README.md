# infrastructure/deployment

Targets and configuration for non-local environments. Phase 15 fills in the
actual pipelines; this directory holds the contract now so app code can be
written environment-aware from the start.

## Environments

| Env         | Frontend            | API                     | Postgres + pgvector | Redis            |
| ----------- | ------------------- | ----------------------- | ------------------- | --------------- |
| development | local `next dev`    | local `uvicorn` / Docker | Docker Compose      | Docker Compose  |
| staging     | Vercel (preview)    | container host          | **Supabase** (staging project) | managed Redis |
| production  | Vercel (production) | container host          | **Supabase** (prod project)    | managed Redis |

Decision record: [`docs/adr/0002-database-provisioning.md`](../../docs/adr/0002-database-provisioning.md).

## Config

- `staging.env.example` / `production.env.example` — the variable set each
  environment needs. Real values live in the deployment platform's secret
  store, never in this repo.
- The API reads the same `Settings` model everywhere (`apps/api/app/core/config.py`);
  only `APP_ENV`, the datastore URLs and secrets change between environments.

## Migrations against Supabase

Alembic is datastore-agnostic. Point `DATABASE_URL_SYNC` at the Supabase
connection string (session pooler, port 5432) and run:

```bash
cd apps/api && uv run alembic upgrade head
```

Run this as a release step before the new API image starts taking traffic.
The runtime image has the virtualenv on `PATH`, so the same image can run it
as a one-off job:

```bash
docker run --rm --env-file production.env <api-image> alembic upgrade head
```

Migrations through `0013` are additive (new tables/columns/indexes only), so
an older API image keeps working against the upgraded schema during a
rolling deploy.

## Launch runbook

Provider choices (container host, managed Redis, SMTP relay) are the
business's call; everything below works with any of them. Do these in order
on **staging** first, then production.

### 1. Datastores

- [ ] Supabase project created; `pgvector` enabled (Database → Extensions).
- [ ] Managed Redis (Upstash, Redis Cloud, …) with TLS — use `rediss://`.
- [ ] Backups: Supabase daily backups are on by default on paid plans;
      enable Point-in-Time Recovery for production. Run one **restore
      drill** into a scratch project before launch and note how long it took.

### 2. Configuration

- [ ] Every variable in `production.env.example` set in the platform's
      secret store. `JWT_SECRET` from
      `python -c "import secrets; print(secrets.token_urlsafe(48))"` — the
      API refuses to start in production with a weak one (docs/adr/0014).
- [ ] `CORS_ORIGINS` = the two frontend origins, exactly.
- [ ] `FORWARDED_ALLOW_IPS` = the load balancer's address range, so
      per-IP rate limits see real client IPs.
- [ ] `INGESTION_ALLOWED_HOSTS` reviewed (add `archive.org` if you'll use
      the `hf_dataset` discovery provider).

### 3. Release

- [ ] Images built by CI (`docker` job) and pushed to your registry.
- [ ] `alembic upgrade head` run as the release step (above).
- [ ] First admin created — there is deliberately no HTTP endpoint for this:
      `docker run --rm -it --env-file production.env <api-image> python -m app.scripts.create_admin --email you@company.in`
- [ ] Frontends deployed with `NEXT_PUBLIC_API_BASE_URL` pointing at the API.

### 4. Integrations (each is optional; the app degrades honestly without it)

- [ ] **Model + embeddings:** `GEMINI_API_KEY` (and/or `GROQ_API_KEY`).
      Check `GET /api/v1/status` reports the provider as configured.
- [ ] **Knowledge base:** in `/admin/knowledge`, run discovery and ingest a
      first batch (or `pnpm kb:discover:ingest` from a machine with
      production env). Until then chat answers "insufficient verified
      information" — correct, but not useful.
- [ ] **Email:** `EMAIL_BACKEND=smtp` + `SMTP_*`; register a test account and
      confirm the verification email arrives (check SPF/DKIM for the
      `EMAIL_FROM` domain or it'll land in spam).
- [ ] **Payments:** Razorpay **test** keys first. In the dashboard set the
      webhook URL to `<api>/api/v1/payments/webhooks/razorpay` with events
      `payment.captured`, `payment.failed`, `refund.processed`. Make one test
      payment and one refund end to end; then switch to live keys.

### 5. Verify and watch

- [ ] Run the browser journey against staging:
      `pnpm e2e` with the staging URLs (or locally against a staging DB copy).
- [ ] Uptime checks on `GET /health` (liveness) and `GET /health/ready`
      (checks Postgres + Redis; returns 503 when either is down).
- [ ] Log shipping: the API logs JSON in production (`LOG_FORMAT=json`);
      alert on `audit_write_failed`, `payment_webhook_*` errors, and
      sustained 5xx.
- [ ] Legal sign-off on the payment/fee model and disclaimers against the
      applicable Bar Council and consumer rules (docs/roadmap.md).

## Not covered by code (decide before scaling)

- Error tracking (Sentry and similar have free tiers; not wired in).
- Object storage — no feature uploads files yet.
- Data-retention windows for chat logs and DPDP Act export/erasure
  requests (docs/adr/0014).
