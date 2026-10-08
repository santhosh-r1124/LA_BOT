# Project Status

Assessed against the **actual code** on 2026-09-27, after the "real data +
free providers + design system" upgrade. A feature is **COMPLETE** only when
its underlying behaviour works end-to-end and is covered by tests — UI alone
doesn't count. See [`roadmap.md`](roadmap.md) for the phase plan and
[`api-inventory.md`](api-inventory.md) for every external service.

Legend: **COMPLETE** · **PARTIALLY COMPLETE** · **IN PROGRESS** · **NOT IMPLEMENTED** · **BLOCKED**

## Feature status

| Feature                                          | Status             | Notes                                                                                                                                                                                               |
| ------------------------------------------------ | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auth & RBAC (consumer / advocate / admin)        | COMPLETE           | JWT + rotating refresh tokens, email verification, password reset. Emails are logged, not sent (see below).                                                                                         |
| Public legal chat (FR-01)                        | COMPLETE           | Classify → hybrid retrieval → grounded, cited answer. Streams over SSE. Works with any configured provider.                                                                                         |
| Advocate recommendation from chat                | COMPLETE           | HIGH/CRITICAL answers carry up to 3 verified advocates (own practice area first, then related areas; same state as the user's profile; then experience). Only fields that exist in the directory are used — no ratings.            |
| RAG prompt-injection boundary                    | COMPLETE           | Retrieved text is delimited in `<sources>`, declared untrusted in the system prompt, and cannot close the block (tag stripping). Tests in `test_llm.py`.                                                                              |
| Legal query classification + risk engine         | COMPLETE           | 15 FRD categories, jurisdiction scope, LOW–CRITICAL risk; HIGH/CRITICAL append the advocate recommendation.                                                                                         |
| Free model providers (Gemini / Groq / Ollama)    | COMPLETE           | `LLM_PROVIDER`; Anthropic now optional. `LLM_FALLBACK_PROVIDER` (default `auto`) retries a failed request on the other of Gemini/Groq; a stream only falls back before its first token. An unconfigured explicit provider is never silently replaced.                                                                                                                                                             |
| Hybrid RAG (pgvector + full-text, RRF)           | COMPLETE           | Verified against real Postgres + pgvector.                                                                                                                                                          |
| Knowledge-base ingestion pipeline                | COMPLETE           | Fetch → extract → clean → chunk → embed → persist, with per-source failure tracking.                                                                                                                |
| Knowledge-base **content**                       | PARTIALLY COMPLETE | Catalogue of 15 official Acts + `pnpm kb:seed` exist. **The corpus is only loaded once you run the seed with a Gemini key** — until then chat honestly answers "insufficient verified information". |
| State/jurisdiction intelligence (FRD §12)        | PARTIALLY COMPLETE | Classifier flags state-dependent questions and the prompt forbids single national figures; the UI labels them. No state-specific sources (state stamp Acts, rules) are catalogued yet.              |
| Document assistant (FRD §7)                      | COMPLETE           | 11 document types, validated questionnaires, draft + notes, copy/download. Deliberately not RAG-grounded (ADR 0009).                                                                                |
| Advocate directory search (FRD §8)               | PARTIALLY COMPLETE | Filters, pagination, profiles work on real verified advocates. "Consultation type" and ratings filters not implemented — no such data exists yet.                                                   |
| Platform status (web home)                       | COMPLETE           | `GET /api/v1/status` + `/api/health`: real provider config, corpus counts, last-indexed time, verified-advocate count, DB/Redis health.                                                             |
| Rate limiting on AI endpoints                    | COMPLETE           | Redis fixed window, fail-open, `429` + `Retry-After`.                                                                                                                                               |
| Query-embedding cache                            | COMPLETE           | Redis, 24h TTL, fail-open.                                                                                                                                                                          |
| Design system + responsive/accessible UI         | COMPLETE           | Shared tokens/components in `packages/shared/src/styles/design-system.css`; both apps restyled.                                                                                                     |
| Advocate portal — registration & profile         | COMPLETE           |                                                                                                                                                                                                     |
| Advocate portal — dashboard (FRD §10)            | NOT IMPLEMENTED    | Home now shows the advocate's real verification status and profile gaps; requests/consultations/earnings are listed as "not available yet" (no fake widgets).                                       |
| Consultation booking (FRD §9)                    | NOT IMPLEMENTED    | Roadmap Phase 8.                                                                                                                                                                                    |
| Payments                                         | NOT IMPLEMENTED    | Phase 10. Needs an Indian gateway (Razorpay/Cashfree test mode are free to integrate; live mode charges per transaction).                                                                           |
| Notifications / real email                       | NOT IMPLEMENTED    | Phase 11. Emails are logged to the API console. A free option: Brevo or Resend free tiers over SMTP/API.                                                                                            |
| Admin UI (verification queue, source management) | NOT IMPLEMENTED    | APIs exist (`/api/v1/admin/*`, usable via `/docs`); no UI (Phase 12).                                                                                                                               |
| Video/voice consultation (WebRTC)                | NOT IMPLEMENTED    |                                                                                                                                                                                                     |

## What each incomplete item needs

**Knowledge-base content** — Exists: catalogue + seed script + pipeline.
Missing: an actual run. Do: set `GEMINI_API_KEY` (free), run `pnpm kb:seed`.
Expected: `/api/v1/status` shows ~15 sources and thousands of passages; chat
answers cite sections.

**State-specific sources** — Exists: jurisdiction classification. Missing:
state stamp Acts / registration rules. Do: add entries (with `state_code`) to
`official_sources.py` from state government or India Code state sections;
filter retrieval by state when the user names one. API: none new (free).

**Advocate dashboard, booking, payments, notifications** — Exist: data model
for advocates only. Missing: requests/consultations/matters tables, flows and
UI (Phases 8–11). Required services: payment gateway (test mode free), email
provider free tier (`SMTP_*` / provider key env vars to be added then).

**Admin UI** — Exists: all admin endpoints. Missing: pages. No external API.

## Known limitations

- Free-tier quotas are per project/org, not per user. Under real traffic,
  expect `llm_rate_limited` responses; configure a second provider or upgrade.
- Gemini free-tier prompts may be used by Google to improve its products —
  don't use it for confidential client matters.
- The knowledge base is a point-in-time snapshot; amendments appear only after
  re-seeding (`reingest` endpoint or `--retry-failed`).
- `section`/`article` metadata on chunks is not populated (ADR 0006), so
  citations show the Act title; the model often names the section in text.
- Admin ingestion fetches any URL an admin submits (admin-only, but no
  private-network egress filter yet — add one before multi-tenant admin).
- The rate limiter keys on the connecting IP; behind a proxy run uvicorn with
  `--proxy-headers` or all users share one bucket.

## Verification performed (this upgrade)

- Backend: `ruff`, `ruff format --check`, `mypy --strict`: clean.
  `pytest`: full suite passing against real Postgres 16 + pgvector and Redis
  (new: provider layer, SSE streaming, status endpoint, rate limiter,
  embedding retry/cache).
- Frontend: `tsc`, `eslint`, `vitest` (incl. SSE client parsing/error paths),
  `next build` for both apps: clean.
- End-to-end in a browser (Playwright): home status panel, streaming chat
  with real hybrid retrieval and rendered citations, empty-KB warning,
  documents validation, advocate directory empty state, mobile navigation.
  The model in that run was a local OpenAI-compatible stub standing in for
  Ollama (the sandbox can't reach Google/Groq), so **real Gemini/Groq calls
  were not exercised here** — they're covered by contract tests against their
  documented request/response shapes. First run with your key: check
  `/api/v1/status`, then ask a question.
- Two pre-existing bugs found and fixed: chat inserts failed on real Postgres
  (`message_role` enum stored names instead of values), and the web client's
  10-second default timeout aborted normal-length chat/draft requests.
