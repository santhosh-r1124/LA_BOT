# Project Status

Assessed against the **actual code** on 2026-10-03, after the marketplace
build-out (Phases 8–14) and dynamic source discovery. A feature is
**COMPLETE** only when its behaviour works end-to-end and is covered by
tests — UI alone doesn't count. **CODE-COMPLETE** means built and tested, but
the external account it depends on (payment gateway, SMTP relay, open
network) hasn't been exercised for real. See [`roadmap.md`](roadmap.md) for
the phase plan and [`api-inventory.md`](api-inventory.md) for every external
service.

Legend: **COMPLETE** · **CODE-COMPLETE** · **PARTIALLY COMPLETE** · **NOT IMPLEMENTED**

## Feature status

| Feature                                       | Status                          | Notes                                                                                                                                                                                                         |
| --------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auth & RBAC (consumer / advocate / admin)     | COMPLETE                        | JWT + rotating refresh tokens, email verification, password reset, per-IP brute-force limit.                                                                                                                  |
| Public legal chat (FR-01)                     | COMPLETE                        | Classify → hybrid retrieval → grounded, cited answer over SSE. Prompt-injection fencing (ADR 0014).                                                                                                           |
| Classification + risk engine                  | COMPLETE                        | 15 categories, jurisdiction scope, LOW–CRITICAL; HIGH/CRITICAL add the advocate recommendation.                                                                                                               |
| Free model providers (Gemini / Groq / Ollama) | COMPLETE                        | `LLM_PROVIDER`; Anthropic optional.                                                                                                                                                                           |
| Hybrid RAG (pgvector + full-text, RRF)        | COMPLETE                        | Verified against real Postgres + pgvector.                                                                                                                                                                    |
| Ingestion pipeline                            | COMPLETE                        | Fetch → extract → clean → chunk → embed → persist, with an SSRF guard on every fetch and redirect.                                                                                                            |
| **Dynamic source discovery**                  | CODE-COMPLETE                   | DB-backed catalog; `curated` (15 Acts) works offline; `india_code_oai` and `hf_dataset` (incl. state Acts) built but not run live — the build sandbox had no egress to those hosts (ADR 0011).                |
| Knowledge-base **content**                    | PARTIALLY COMPLETE              | Nothing is ingested until someone runs discovery + ingest with `GEMINI_API_KEY` set (`/admin/knowledge` or `pnpm kb:discover:ingest`). Until then chat correctly answers "insufficient verified information". |
| State/jurisdiction intelligence               | PARTIALLY COMPLETE              | Classifier flags state-dependent questions; state Acts now have a discovery path (`hf_dataset`) but retrieval doesn't yet filter by the user's state.                                                         |
| Document assistant                            | COMPLETE                        | 11 types, validated questionnaires, draft + notes. Not RAG-grounded by design (ADR 0009).                                                                                                                     |
| Advocate directory                            | COMPLETE                        | Filters, pagination, verified-only profiles. Ratings filter not built (no review data yet).                                                                                                                   |
| **Consultation booking** (Phase 8)            | COMPLETE                        | Request → accept/decline → complete → close, cancel from active states; fee snapshot; private advocate notes. Browser E2E.                                                                                    |
| **Advocate dashboard** (Phase 9)              | COMPLETE                        | Live request/scheduled/awaiting-close counts; full request management at `/consultations`. Earnings view waits on live payments.                                                                              |
| **Payments** (Phase 10)                       | CODE-COMPLETE                   | Razorpay orders, checkout-signature + webhook verification, refunds, receipts. Unconfigured → `503 payments_not_configured` (verified in-browser). Not run against a real Razorpay account (ADR 0012).        |
| **Notifications** (Phase 11)                  | COMPLETE (email: CODE-COMPLETE) | In-app feed + bell in both apps for every lifecycle/payment/verification event. SMTP sender tested against a fake relay; no real relay exercised. No SMS (DLT registration, ADR 0013).                        |
| **Admin & legal-ops console** (Phase 12)      | COMPLETE                        | `/admin`: overview, advocate verification, high-risk query review queue, knowledge base (discovery/catalog/ingest/re-index), payments + refunds, users, audit log.                                            |
| **Security hardening** (Phase 13)             | COMPLETE                        | SSRF guard, auth throttling, production config guard, security headers, append-only audit trail, prompt fencing (ADR 0014).                                                                                   |
| **Testing** (Phase 14)                        | COMPLETE                        | 283 API tests (real Postgres/pgvector/Redis), 28 web + 7 shared unit tests, 7-step Playwright journey across all three apps; CI runs all of it plus `alembic check`.                                          |
| Platform status / health                      | COMPLETE                        | `/api/v1/status`, `/health`, `/health/ready` (503 when a dependency is down).                                                                                                                                 |
| Deployment (Phase 15)                         | PARTIALLY COMPLETE              | Images, CI, env templates and a launch runbook (`infrastructure/deployment/README.md`) exist; no hosting provider has been chosen or provisioned.                                                             |
| Video/voice consultation (WebRTC)             | NOT IMPLEMENTED                 | Advocates share an external meeting link when accepting.                                                                                                                                                      |
| Client messaging / document exchange          | NOT IMPLEMENTED                 |                                                                                                                                                                                                               |
| DPDP export/erasure, retention policy         | NOT IMPLEMENTED                 | Needs a business retention decision first (ADR 0014).                                                                                                                                                         |

## What each incomplete item needs

**Knowledge-base content** — Set `GEMINI_API_KEY`; in `/admin/knowledge` run
discovery and ingest (or `pnpm kb:discover:ingest`). The live providers need
outbound access to `indiacode.nic.in` / `huggingface.co`; if a provider
reports a wrong OAI path or unmapped columns, fix the named setting (ADR 0011).

**Payments go-live** — Razorpay test keys + webhook secret, one test
payment and refund end to end, then live keys (runbook step 4).

**Email go-live** — Any SMTP relay's credentials in `SMTP_*`, SPF/DKIM for
the sender domain, then send one real verification email.

**Hosting** — Pick a container host and managed Redis, follow the launch
runbook in `infrastructure/deployment/README.md`.

## Known limitations

- Free-tier model quotas are per project, not per user; expect
  `llm_rate_limited` under real traffic.
- Gemini free-tier prompts may be used to improve Google's products — not
  for confidential client matters.
- Payment success isn't enforced before a session; an advocate can complete
  an unpaid consultation (product decision, ADR 0012).
- Receipts are not GST tax invoices (ADR 0012).
- SSRF: DNS rebinding between check and connect remains possible without
  `INGESTION_ALLOWED_HOSTS` (ADR 0014).
- Frontend CSP is baseline-only; refresh tokens are in `localStorage`
  (ADR 0014).
- `section`/`article` metadata on chunks is not populated (ADR 0006).

## Verification performed (this build-out)

- API: `ruff`, `ruff format --check`, `mypy --strict`, `alembic check` (no
  drift — this was failing before and is fixed), 283 `pytest` tests against
  real Postgres 16 + pgvector + Redis.
- Frontend: `tsc`, `eslint`, `vitest` (35 tests), `next build` for both apps.
- Browser: the Playwright journey (register → verify → book → accept → pay
  attempt → complete/close → notifications → admin gate) passes against
  real servers; admin console pages were also exercised manually in
  Chromium with no console errors.
- **Not** exercised: real Razorpay, real SMTP, live India Code / Hugging Face
  discovery, real Gemini/Groq calls — the build sandbox had no egress to
  those hosts. Each is covered by contract tests against its documented
  request/response shape.
