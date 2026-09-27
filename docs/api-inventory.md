# External API & Service Inventory

Every external service the platform actually calls, what happens when it
fails, and how to get a key. Nothing here is required to be paid: the whole
platform runs on **one free Google AI Studio key**, or with **no key at all**
using a local Ollama model plus Gemini for embeddings.

> Free-tier limits change. The numbers below were checked against the
> providers' own docs in September 2026 — always confirm on the linked pages
> and in your provider dashboard.

## Summary

| Service                               | Needed for                                         | Free?                | Key required   | Env var(s)                           |
| ------------------------------------- | -------------------------------------------------- | -------------------- | -------------- | ------------------------------------ |
| Google Gemini API — embeddings        | Knowledge-base indexing + chat retrieval           | ✅ free tier         | Yes            | `GEMINI_API_KEY`, `EMBEDDING_MODEL`  |
| Google Gemini API — chat model        | Classification, answers, drafts (default provider) | ✅ free tier         | Yes (same key) | `GEMINI_API_KEY`, `GEMINI_LLM_MODEL` |
| GroqCloud                             | Alternative chat model provider                    | ✅ free plan         | Yes            | `GROQ_API_KEY`, `GROQ_MODEL`         |
| Ollama (local)                        | Alternative chat model provider, fully offline     | ✅ free, open source | No             | `OLLAMA_BASE_URL`, `OLLAMA_MODEL`    |
| Anthropic Claude                      | Alternative chat model provider                    | ❌ paid              | Yes            | `ANTHROPIC_API_KEY`, `LLM_MODEL`     |
| India Code / Legislative Dept / MeitY | Source documents for the knowledge base            | ✅ public            | No             | — (URLs in `official_sources.py`)    |
| PostgreSQL 16 + pgvector              | All persistence + vector search                    | ✅ open source       | —              | `DATABASE_URL`, `DATABASE_URL_SYNC`  |
| Redis 7                               | Rate limiting, query-embedding cache               | ✅ open source       | —              | `REDIS_URL`                          |

Provider selection is `LLM_PROVIDER` (`auto` \| `gemini` \| `groq` \| `ollama`
\| `anthropic`). `auto` uses the first _configured_ provider in the order
gemini → groq → ollama → anthropic, i.e. free providers first. Implementation:
`apps/api/app/services/llm_provider.py`.

All keys are read **only by the API server** (`apps/api`). The browser apps
never see a key: they talk to the API, and the only public variables are
`NEXT_PUBLIC_API_BASE_URL` and `NEXT_PUBLIC_APP_ENV`.

---

## Google Gemini API (Google AI Studio)

|                       |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Purpose**           | (1) Embeddings for the legal knowledge base (`gemini-embedding-001`, 768-dim, task-typed `RETRIEVAL_DOCUMENT` / `RETRIEVAL_QUERY`). (2) Default chat model for classification, grounded answers and document drafts (`gemini-3.5-flash`).                                                                                                                                                                                                                                         |
| **Why**               | Retrieval needs embeddings; one free key covers both needs.                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **Free tier**         | Yes. `gemini-3.5-flash`, `gemini-3.5-flash-lite` and other Flash models are listed "free of charge" on the pricing page; `gemini-embedding-001` remains supported for text. No billing account needed.                                                                                                                                                                                                                                                                            |
| **API key**           | Required.                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **Env vars**          | `GEMINI_API_KEY`, `GEMINI_LLM_MODEL` (default `gemini-3.5-flash`), `EMBEDDING_MODEL` (default `gemini-embedding-001`), `EMBEDDING_DIMENSIONS` (768 — fixed by the pgvector column; changing it needs a migration + re-index).                                                                                                                                                                                                                                                     |
| **Get a key**         | <https://aistudio.google.com/apikey>                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **Rate limits**       | Per-project RPM / TPM / RPD limits shown at <https://aistudio.google.com/rate-limit>. Free-tier data may be used by Google to improve products — don't send confidential client data on the free tier.                                                                                                                                                                                                                                                                            |
| **Failure behaviour** | _Chat model:_ 429 → `503 llm_rate_limited` ("free-tier usage limit reached, wait a minute"); other errors → `503 llm_error`. Streaming chat emits an `error` event instead; nothing is persisted for a failed turn. _Embeddings (chat retrieval):_ failure → the answer is "insufficient verified information", never an ungrounded guess. _Embeddings (ingestion):_ 429 is retried with backoff (15s, 30s, 45s); a persistent failure marks the source `FAILED` with the reason. |
| **Docs**              | <https://ai.google.dev/gemini-api/docs/pricing>, <https://ai.google.dev/gemini-api/docs/embeddings>                                                                                                                                                                                                                                                                                                                                                                               |
| **Alternative**       | Chat: Groq or Ollama (set `LLM_PROVIDER`). Embeddings: no drop-in alternative is wired — switching embedding provider means re-embedding the whole corpus (see ADR 0005).                                                                                                                                                                                                                                                                                                         |

## GroqCloud

|                       |                                                                                                                                                       |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Purpose**           | Alternative chat model (OpenAI-compatible `/chat/completions`, JSON mode, streaming).                                                                 |
| **Why**               | Very fast inference on a free plan; useful as a second provider if Gemini's quota is exhausted.                                                       |
| **Free tier**         | Yes (free plan).                                                                                                                                      |
| **API key**           | Required.                                                                                                                                             |
| **Env vars**          | `GROQ_API_KEY`, `GROQ_MODEL` (default `openai/gpt-oss-120b`; `llama-3.3-70b-versatile` and `openai/gpt-oss-20b` also work), `GROQ_BASE_URL`.          |
| **Get a key**         | <https://console.groq.com/keys>                                                                                                                       |
| **Rate limits**       | Free plan (org-wide): e.g. `openai/gpt-oss-120b` 30 RPM, 1K requests/day, 8K tokens/min. Current values: <https://console.groq.com/docs/rate-limits>. |
| **Failure behaviour** | Same normalisation as Gemini (`llm_rate_limited` / `llm_error`).                                                                                      |
| **Alternative**       | Gemini, Ollama.                                                                                                                                       |

## Ollama (local models)

|                       |                                                                                                                                                 |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| **Purpose**           | Run an open-source chat model on your own machine through Ollama's OpenAI-compatible endpoint.                                                  |
| **Why**               | Zero cost, no rate limits, no data leaves the machine. Quality depends on the model you pull.                                                   |
| **Free tier**         | Free and open source.                                                                                                                           |
| **API key**           | None.                                                                                                                                           |
| **Env vars**          | `OLLAMA_BASE_URL` (`http://localhost:11434/v1`, or `http://host.docker.internal:11434/v1` from Docker), `OLLAMA_MODEL` (default `llama3.1:8b`). |
| **Setup**             | Install from <https://ollama.com>, then `ollama pull llama3.1:8b`.                                                                              |
| **Failure behaviour** | Server not running / model missing → `503 llm_error`.                                                                                           |
| **Note**              | Embeddings still come from Gemini.                                                                                                              |

## Anthropic Claude (optional, paid)

|                       |                                                                                                                                                        |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Purpose**           | Alternative chat model. Was the only provider before this upgrade; kept for teams that already have a key.                                             |
| **Free tier**         | No — paid usage. Never required.                                                                                                                       |
| **Env vars**          | `ANTHROPIC_API_KEY`, `LLM_MODEL` (applies to Anthropic only). Select with `LLM_PROVIDER=anthropic` (or leave `auto` with no free provider configured). |
| **Get a key**         | <https://console.anthropic.com/>                                                                                                                       |
| **Failure behaviour** | Same normalisation as the other providers.                                                                                                             |

## Official legal sources (knowledge base)

|                       |                                                                                                                                                                                    |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Purpose**           | The documents chat answers are grounded in.                                                                                                                                        |
| **Hosts**             | `indiacode.nic.in` (India Code, Legislative Department), `legislative.gov.in`, `meity.gov.in`.                                                                                     |
| **Free?**             | Public government publications; no key.                                                                                                                                            |
| **Catalogue**         | `apps/api/app/services/ingestion/official_sources.py` — 15 Acts across IT law, contracts/corporate, consumer protection, IP, registration/stamp duty and the Constitution.         |
| **Load**              | `pnpm kb:seed` (or `cd apps/api && uv run python -m app.scripts.seed_corpus`). Idempotent; `--retry-failed`, `--only it ip`, `--list`.                                             |
| **Freshness**         | Snapshots as of ingestion — **updated when re-seeded**, not live. Each source keeps its URL and SHA-256 checksum; the status API reports when the knowledge base was last indexed. |
| **Failure behaviour** | A moved/unavailable file is recorded as `FAILED` with the reason (`GET /api/v1/admin/legal-sources?status=FAILED`); other sources continue.                                        |

## Infrastructure

| Service               | Env                                 | Failure behaviour                                                                                              |
| --------------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| PostgreSQL + pgvector | `DATABASE_URL`, `DATABASE_URL_SYNC` | `/health/ready` → 503; `/api/v1/status` reports `knowledge_base.available=false` instead of erroring.          |
| Redis                 | `REDIS_URL`                         | `/health/ready` → 503. Rate limiter and embedding cache **fail open** (requests still served, failure logged). |

## Protecting free-tier quotas

- `AI_RATE_LIMIT_PER_MINUTE` (default 20): per-client (IP, or user id when
  logged in) limit on `POST /chat/messages`, `/chat/messages/stream` and
  `POST /documents`. Returns `429 rate_limited` with `Retry-After`.
- `EMBEDDING_CACHE_TTL_SECONDS` (default 24h): repeated questions reuse their
  query embedding from Redis instead of calling the embedding API.
- Classification + answer are two model calls per chat turn; out-of-scope and
  no-evidence turns skip the second call.
