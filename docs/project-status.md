# Project Status

Assessed against the **actual code** on 2026-10-08, after the offline-mode cycle. A feature is
**COMPLETE** only when its behaviour works end to end and is covered by tests; a screen alone does
not count. See [`roadmap.md`](roadmap.md) for the plan, [`api-inventory.md`](api-inventory.md) for
every external service and [`environments.md`](environments.md) for how it is run.

Legend: **COMPLETE** · **PARTIALLY COMPLETE** · **NOT IMPLEMENTED**

LA_BOT is a local-only product: it runs on your own computer with `docker compose up --build` or
natively, and there is no hosted deployment. It needs **no AI key**. With none configured it runs in
offline mode (see below), and adding a Gemini and/or Groq key switches on AI answers.

## Feature status

| Feature                                           | Status             | Notes                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Run locally (Docker Compose and native)           | COMPLETE           | `docker compose up --build` runs db, redis, api, web (:3000) and advocate portal (:3001) with no `.env`. Native dev: `pnpm stack:up`, `uv run alembic upgrade head`, `uvicorn`, `pnpm dev`. All ports bind to 127.0.0.1.                                                                                                                           |
| Offline mode (no AI key)                          | COMPLETE           | Rules-based classification and risk, sources-only chat replies, deterministic template drafts, full advocate directory. `GET /status` reports `llm.mode: "offline"`. See limits below.                                                                                                                                                             |
| Auth & RBAC (consumer / advocate / admin)         | COMPLETE           | JWT with rotating refresh tokens, email verification, password reset. Emails are logged, not sent. Demo sign-in is open by default (`OPEN_LOGIN=true`); advocate and admin accounts still need their real password.                                                                                                                                |
| Public legal chat                                 | COMPLETE           | Classify, retrieve, answer with numbered `[n]` citations. Streams over SSE. `answer_mode` is `"ai"` or `"sources_only"`. Works in both modes.                                                                                                                                                                                                      |
| Chat in offline mode                              | COMPLETE           | The reply is the matching passages laid out as text with their sources, never paraphrased. Hostile passage text cannot forge a citation marker. With no match it says so plainly. Greetings get a fixed welcome.                                                                                                                                   |
| Legal query classification + risk engine          | COMPLETE           | 14 in-scope categories plus out-of-scope, central/state/court/stamp-duty scope, LOW to CRITICAL risk. AI mode uses the model; offline mode, or a model outage, uses the rules classifier. HIGH/CRITICAL add the advocate recommendation.                                                                                                           |
| Advocate recommendation from chat                 | COMPLETE           | HIGH/CRITICAL replies carry up to 3 verified advocates: own practice area first, then related areas, the user's state, then experience. Only fields that exist in the directory are used; there are no ratings.                                                                                                                                    |
| RAG prompt-injection boundary                     | COMPLETE           | AI mode: retrieved text is fenced in `<sources>`, declared untrusted and cannot close the block. Offline mode: source text is flattened and neutralised before display. Tests in `test_llm.py` and `test_sources_only_answer.py`.                                                                                                                  |
| AI providers (Gemini / Groq / Ollama / Anthropic) | COMPLETE           | `LLM_PROVIDER`, plus `LLM_FALLBACK_PROVIDER` (default `auto`) retries a failed request on the other of Gemini/Groq; a stream only falls back before its first token. Covered by contract tests; **no live provider call was made in the latest cycle** (no keys were available).                                                                   |
| Hybrid retrieval (full text + pgvector, RRF)      | COMPLETE           | Verified against real Postgres with pgvector. Keyword-only when chunks are not embedded or `GEMINI_API_KEY` is missing.                                                                                                                                                                                                                            |
| Knowledge-base ingestion pipeline                 | COMPLETE           | Fetch, extract, clean, chunk, embed, store, with per-source failure tracking. Hugging Face loader is resumable. Embedding needs `GEMINI_API_KEY`.                                                                                                                                                                                                  |
| Knowledge-base **content**                        | PARTIALLY COMPLETE | The Hugging Face judgments load on API start when the machine can reach huggingface.co (`LEGAL_CORPUS_AUTOLOAD`); the 15 official Acts need `GEMINI_API_KEY` and `pnpm kb:seed`. Until something is loaded, chat says nothing matched. Offline chat was verified end to end against a few passages clearly labelled FIXTURE, not the live dataset. |
| State/jurisdiction intelligence                   | PARTIALLY COMPLETE | Classification flags state-dependent questions and the UI labels them; template drafts refuse to quote state figures. No state-specific sources (state stamp Acts, rules) are catalogued.                                                                                                                                                          |
| Document assistant                                | COMPLETE           | 11 types, validated questionnaires, draft plus notes, copy and download. AI mode: model-written. Offline mode: `generation_mode: "template"`, a labelled deterministic draft with `[PLACEHOLDERS]` and notes. Not RAG-grounded (ADR 0009).                                                                                                         |
| Advocate directory search                         | PARTIALLY COMPLETE | Filters (practice area, state, city, language), pagination, facets and profiles work. The 1000 bundled advocates are **synthetic samples**, labelled as such. "Consultation type" and ratings filters are not built; no such data exists.                                                                                                          |
| Advocate CSV import                               | COMPLETE           | On every start, by script, and for admins at `/advocates/import`. Validated, idempotent, never deletes.                                                                                                                                                                                                                                            |
| Platform status (web home)                        | COMPLETE           | `GET /api/v1/status` and `/api/health`: provider mode, corpus counts and load progress, directory counts, DB/Redis/pgvector checks.                                                                                                                                                                                                                |
| Rate limiting on AI endpoints                     | COMPLETE           | Redis fixed window per client, fails open, `429` with `Retry-After`. Also applies in offline mode.                                                                                                                                                                                                                                                 |
| Query-embedding cache                             | COMPLETE           | Redis, 24 h default TTL, fails open.                                                                                                                                                                                                                                                                                                               |
| Design system, light/dark themes, responsive UI   | COMPLETE           | Shared tokens and components in `packages/shared/src/styles`. Both apps follow the OS theme, have a header toggle and a no-flash script (`la-theme` in `localStorage`, `data-theme` on `<html>`).                                                                                                                                                  |
| Advocate portal: registration and profile         | COMPLETE           | Register, log in, edit profile, see verification status.                                                                                                                                                                                                                                                                                           |
| Advocate portal: dashboard                        | NOT IMPLEMENTED    | Home shows the advocate's real verification status and profile gaps; requests, consultations and earnings are listed as "not available yet" (no fake widgets).                                                                                                                                                                                     |
| Consultation booking                              | NOT IMPLEMENTED    | Roadmap Phase 8.                                                                                                                                                                                                                                                                                                                                   |
| Payments                                          | NOT IMPLEMENTED    | Phase 10. Needs an Indian payment gateway.                                                                                                                                                                                                                                                                                                         |
| Notifications / real email                        | NOT IMPLEMENTED    | Phase 11. Emails are written to the API log.                                                                                                                                                                                                                                                                                                       |
| Admin UI                                          | NOT IMPLEMENTED    | Only the CSV import page exists. Verifying advocates, managing users and legal sources are API endpoints (`/api/v1/admin/*`), usable through `/docs`.                                                                                                                                                                                              |
| Video/voice consultation                          | NOT IMPLEMENTED    |                                                                                                                                                                                                                                                                                                                                                    |

## Offline mode: what it is and where it stops

Offline mode is the default when no provider key is set. It is a complete mode, not an error state:

- **Classification** is deterministic vocabulary matching (English and Hinglish, whole words,
  case-insensitive). Typos are not corrected, only common spellings are covered, and a question with
  legal words but no recognisable topic is treated as `ADVOCATE_REQUIRED` at HIGH risk rather than
  guessed at. Clearly non-legal text (code, recipes, weather, sports, films, maths) is out of scope.
- **Chat** shows source text, not an explanation of it. Replies are only as good as the passages
  retrieved, and retrieval is keyword-only without embeddings.
- **Documents** are templates assembled from your answers. They give no section numbers, case names,
  stamp-duty figures or time limits, and say so in the notes.
- **Not available offline:** vector search, written explanations, `kb:seed` for the official Acts
  (embedding needs a Gemini key).

## What each incomplete item needs

**Knowledge-base content** - Exists: the Hugging Face loader (autoload on start), a catalogue of 15
official Acts and `pnpm kb:seed`. Missing: a guarantee that the library is populated, which depends
on the machine reaching huggingface.co. Do: check `GET /api/v1/status` (`knowledge_base.corpus_load`);
for the Acts, set `GEMINI_API_KEY` (free) and run `pnpm kb:seed`.

**State-specific sources** - Exists: jurisdiction classification. Missing: state stamp Acts and
registration rules. Do: add entries with a `state_code` to `official_sources.py` and filter retrieval
by state when the user names one.

**Advocate dashboard, booking, payments, notifications** - Exist: the advocate data model only.
Missing: requests, consultations and matters tables, flows and UI (Phases 8 to 11). Needs a payment
gateway and an email provider.

**Admin UI** - Exists: all admin endpoints and the CSV import page. Missing: pages for verification
and source management. No external service needed.

## Known limitations

- Free-tier AI quotas are per project, not per user. Expect `llm_rate_limited` under real traffic;
  configure a second provider.
- Gemini free-tier prompts may be used by Google to improve its products. Do not send confidential
  client matters.
- The legal library is a point-in-time snapshot of whatever was loaded; amendments appear only after
  re-loading.
- `section`/`article` metadata on passages is not populated for PDF sources (ADR 0006), so citations
  name the document or the case.
- Open login (`OPEN_LOGIN=true`) is a demo convenience. The Compose defaults include a known admin
  password; change `ADMIN_PASSWORD` and `JWT_SECRET` if the computer is shared.
- Admin ingestion fetches any URL an admin submits, with no private-network egress filter.
- The rate limiter keys on the connecting IP; behind a proxy run uvicorn with `--proxy-headers` or all
  users share one bucket.
- Compose does not pass `ALLOW_GENERAL_ANSWERS` or the Anthropic model into the API container; set
  those in `apps/api/.env` when running natively.

## Verification performed (2026-10-08)

- **Backend:** `uv run pytest` against local Postgres 16 with pgvector and Redis: **637 passed**.
  This includes the rules classifier (about 160 cases), the sources-only builder with hostile text,
  offline chat end to end (stream and non-stream) with seeded passages and advocates, and template
  drafts for all 11 document types. Provider-failure tests are intact.
- **Frontend:** `vitest` (186 tests in 14 files in `apps/web` at the time of writing), `tsc` and
  `eslint` are the checks for each app.
- **Running API, no keys configured** (checked on the dev stack during the offline-mode work;
  `GET /status` was re-checked while writing these docs and reports `llm.mode: "offline"`): the
  acceptance question ("employer has not paid my salary") returns `EMPLOYMENT_LAW`, central scope, HIGH risk,
  `answer_mode: "sources_only"`, a cited passage and 3 matching advocates, in both the streaming and
  non-streaming endpoints; a greeting gets the welcome message; a coding question gets the
  out-of-scope reply; an unmatched trademark question gets "nothing matched"; document requests for
  four types (rental agreement, affidavit, legal notice, NDA) return `generation_mode: "template"`
  with the label as line 1 and a Notes sentence naming the state.
- **Configuration:** `docker compose config` parses; copying the root `.env.example` to `.env`
  produces the identical configuration to having no `.env`. The API example file loads through
  `Settings` and every key in it is a real setting.
- **Not verified here:** building the Docker images (no Docker daemon in this environment; CI builds
  all three), live Gemini or Groq calls, and a real Hugging Face download.
