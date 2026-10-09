# External API & Service Inventory

Every external service the platform can call, what happens when it fails, and how to get a key.
**None of them is required.** With no key at all the product runs in offline mode (see below). Every
key is optional and free tiers exist for all the AI options except Anthropic.

> Free-tier limits change. Figures below were checked against the providers' own docs in September
> 2026; confirm on the linked pages and in your provider dashboard before relying on them.

## What each key unlocks

| You configure                   | Mode (`GET /status` `llm.mode`) | Chat and documents                                         | Search                                |
| ------------------------------- | ------------------------------- | ---------------------------------------------------------- | ------------------------------------- |
| Nothing                         | `offline`                       | Sources-only replies; template drafts; rules classifier    | Keyword                               |
| `GEMINI_API_KEY`                | `ai`                            | AI answers and drafts                                      | Keyword + vector                      |
| `GROQ_API_KEY`                  | `ai`                            | AI answers and drafts                                      | Keyword (Groq has no embeddings)      |
| Both Gemini and Groq            | `ai`                            | AI answers; each provider backs up the other automatically | Keyword + vector                      |
| `OLLAMA_BASE_URL` (local model) | `ai`                            | AI answers from a model on your computer                   | Keyword (add a Gemini key for vector) |
| `ANTHROPIC_API_KEY`             | `ai`                            | AI answers (paid)                                          | Keyword (add a Gemini key for vector) |

Offline mode is not a failure state. `llm.configured` is `false`, chat replies carry
`answer_mode: "sources_only"` and documents carry `generation_mode: "template"`. Only "no provider
configured" counts as offline: a configured provider that is down returns a clear error for chat
and drafts (nothing is stored for that turn), while classification quietly falls back to the rules
classifier.

## Summary

| Service                               | Needed for                                    | Free?             | Key                                    | Env var(s)                                                     |
| ------------------------------------- | --------------------------------------------- | ----------------- | -------------------------------------- | -------------------------------------------------------------- |
| Google Gemini API: chat model         | AI answers, classification, drafts            | Free tier         | Optional                               | `GEMINI_API_KEY`, `GEMINI_LLM_MODEL`                           |
| Google Gemini API: embeddings         | Vector search and embedding the legal library | Free tier         | Optional (same key)                    | `GEMINI_API_KEY`, `EMBEDDING_PROVIDER`, `EMBEDDING_MODEL`      |
| GroqCloud                             | AI answers; backup for Gemini                 | Free plan         | Optional                               | `GROQ_API_KEY`, `GROQ_MODEL`                                   |
| Ollama (local)                        | AI answers from a local model, no key         | Free, open source | None                                   | `OLLAMA_BASE_URL`, `OLLAMA_MODEL`                              |
| Anthropic Claude                      | AI answers                                    | Paid              | Optional                               | `ANTHROPIC_API_KEY`, `LLM_MODEL`                               |
| Hugging Face (datasets)               | The legal library: Indian court judgments     | Free              | Optional (`HF_TOKEN`, gated sets only) | `HF_DATASET_NAME`, `HF_MAX_DOCUMENTS`, `LEGAL_CORPUS_AUTOLOAD` |
| India Code / Legislative Dept / MeitY | The 15 official Acts (optional extra)         | Public            | None                                   | URLs in `official_sources.py`                                  |
| PostgreSQL 16 + pgvector              | All persistence and vector search             | Open source       | n/a                                    | `DATABASE_URL`, `DATABASE_URL_SYNC`                            |
| Redis 7                               | Rate limiting, query-embedding cache          | Open source       | n/a                                    | `REDIS_URL`                                                    |

Provider selection is `LLM_PROVIDER` (`auto` | `gemini` | `groq` | `ollama` | `anthropic`). `auto`
uses the first _configured_ provider in the order gemini, groq, ollama, anthropic, so free providers
come first. `LLM_FALLBACK_PROVIDER` (default `auto`) names the provider tried when the first fails:
`auto` is the other of Gemini/Groq if its key is set (never a paid or local one implicitly), `none`
disables it. Implementation: `apps/api/app/services/llm_provider.py`.

All keys are read **only by the API server** (`apps/api`). The browser apps never see a key; their
only variables are public addresses (`NEXT_PUBLIC_API_BASE_URL`, `NEXT_PUBLIC_WEB_BASE_URL` in the
portal, `NEXT_PUBLIC_APP_ENV`).

---

## Google Gemini API (Google AI Studio)

|                       |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Purpose**           | (1) Chat model for classification, cited answers and document drafts. (2) Embeddings for the legal library (`gemini-embedding-001`, 768 dimensions, task-typed `RETRIEVAL_DOCUMENT` / `RETRIEVAL_QUERY`).                                                                                                                                                                                                                                                                                          |
| **Why**               | Retrieval needs embeddings; one free key covers both.                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **Free tier**         | Yes at the time of checking: Flash models and `gemini-embedding-001` are listed as free of charge, with no billing account needed. Confirm on the pricing page.                                                                                                                                                                                                                                                                                                                                    |
| **API key**           | Optional. Without it the chat model is unavailable and vectors are not computed.                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **Env vars**          | `GEMINI_API_KEY`, `GEMINI_LLM_MODEL` (default `gemini-flash-latest`), `EMBEDDING_PROVIDER` (`gemini`, or `none` for keyword-only), `EMBEDDING_MODEL` (default `gemini-embedding-001`), `EMBEDDING_DIMENSIONS` (768, fixed by the pgvector column; changing it needs a migration and a re-index).                                                                                                                                                                                                   |
| **Model fallback**    | If the configured model cannot be served (retired, unsupported setting, or its own quota is used up), the provider tries `gemini-flash-latest`, `gemini-2.5-flash` and `gemini-flash-lite-latest` in turn.                                                                                                                                                                                                                                                                                         |
| **Get a key**         | <https://aistudio.google.com/apikey>                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **Rate limits**       | Per-project RPM / TPM / RPD limits shown at <https://aistudio.google.com/rate-limit>. Free-tier data may be used by Google to improve products; do not send confidential client data on the free tier.                                                                                                                                                                                                                                                                                             |
| **Failure behaviour** | _Chat model:_ 429 becomes `503 llm_rate_limited`, other errors `503 llm_error`; with a second provider the same request is retried there first. Streaming chat emits an `error` event instead; nothing is persisted for a failed turn. _Classification:_ any outage falls back to the rules classifier. _Embeddings at question time:_ failure degrades to keyword search. _Embeddings at ingestion:_ 429 is retried with backoff; a persistent failure marks the source `FAILED` with the reason. |
| **Docs**              | <https://ai.google.dev/gemini-api/docs/pricing>, <https://ai.google.dev/gemini-api/docs/embeddings>                                                                                                                                                                                                                                                                                                                                                                                                |
| **Alternative**       | Chat: Groq or Ollama. Embeddings: no drop-in alternative is wired; switching means re-embedding the whole library (ADR 0005). Or run keyword-only.                                                                                                                                                                                                                                                                                                                                                 |

## GroqCloud

|                       |                                                                                                                                                                                                     |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Purpose**           | Alternative chat model (OpenAI-compatible `/chat/completions`, JSON mode, streaming).                                                                                                               |
| **Why**               | Very fast inference on a free plan; a second provider when Gemini's quota is exhausted, and the other way round.                                                                                    |
| **Free tier**         | Yes (free plan).                                                                                                                                                                                    |
| **API key**           | Optional.                                                                                                                                                                                           |
| **Env vars**          | `GROQ_API_KEY`, `GROQ_MODEL` (default `openai/gpt-oss-120b`; `llama-3.3-70b-versatile` and `openai/gpt-oss-20b` also work), `GROQ_BASE_URL`.                                                        |
| **Get a key**         | <https://console.groq.com/keys>                                                                                                                                                                     |
| **Rate limits**       | Free plan (organisation-wide), as checked in September 2026: for example `openai/gpt-oss-120b` 30 RPM, 1K requests/day, 8K tokens/min. Current values: <https://console.groq.com/docs/rate-limits>. |
| **Failure behaviour** | Same normalisation as Gemini (`llm_rate_limited` / `llm_error`).                                                                                                                                    |
| **Note**              | Groq has no embeddings API, so vector search still needs a Gemini key.                                                                                                                              |

## Ollama (local models)

|                       |                                                                                                                                                           |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Purpose**           | Run an open-source chat model on your own machine through Ollama's OpenAI-compatible endpoint.                                                            |
| **Why**               | Zero cost, no rate limits, no data leaves the machine. Quality depends on the model you pull.                                                             |
| **Free tier**         | Free and open source.                                                                                                                                     |
| **API key**           | None.                                                                                                                                                     |
| **Env vars**          | `OLLAMA_BASE_URL` (`http://localhost:11434/v1`, or `http://host.docker.internal:11434/v1` from Docker), `OLLAMA_MODEL` (default `llama3.1:8b`).           |
| **Setup**             | Install from <https://ollama.com>, then `ollama pull llama3.1:8b`.                                                                                        |
| **Failure behaviour** | Server not running or model missing: `503 llm_error`.                                                                                                     |
| **Note**              | `auto` fallback never picks Ollama implicitly; name it with `LLM_FALLBACK_PROVIDER=ollama` if you want it as a backup. Embeddings still come from Gemini. |

## Anthropic Claude (optional, paid)

|                       |                                                                                                                                                       |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Purpose**           | Alternative chat model for people who already have a key.                                                                                             |
| **Free tier**         | No, paid usage. Never required.                                                                                                                       |
| **Env vars**          | `ANTHROPIC_API_KEY`, `LLM_MODEL` (applies to Anthropic only). Select with `LLM_PROVIDER=anthropic`, or leave `auto` with no free provider configured. |
| **Get a key**         | <https://console.anthropic.com/>                                                                                                                      |
| **Failure behaviour** | Same normalisation as the other providers.                                                                                                            |

## Hugging Face datasets (the legal library)

|                       |                                                                                                                                                                                                                                                                 |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Purpose**           | Real Indian court judgments, read into the legal library that chat retrieves from.                                                                                                                                                                              |
| **Hosts**             | `huggingface.co`, `datasets-server.huggingface.co`, and the download CDN (`cdn-lfs.huggingface.co`, `*.xethub.hf.co`). A network that blocks these cannot load the library.                                                                                     |
| **Free?**             | Public datasets are free and need no key. `HF_TOKEN` is only for gated or private datasets.                                                                                                                                                                     |
| **Env vars**          | `HF_DATASET_NAME` (default `Sumitedu/indian-case-laws`), `HF_MAX_DOCUMENTS` (200), `HF_BATCH_SIZE` (20), `HF_DATASET_SPLIT`, `HF_DATASET_FILE`, `HF_TOKEN`, `LEGAL_CORPUS_AUTOLOAD` (true), `LEGAL_CORPUS_EMBED_ON_START` (true; embedding needs a Gemini key). |
| **Load**              | In the background on every API start, or by hand: `uv run python -m app.scripts.ingest_hf_dataset` (`--inspect`, `--embed-missing`), or `pnpm seed:legal`. Rows are read a page at a time; nothing is downloaded whole. Re-running continues where it stopped.  |
| **Failure behaviour** | No connection, blocked host, gated dataset or viewer outage: the API keeps serving. The reason shows in `GET /status` under `knowledge_base.corpus_load` (`state: "failed"`), and with no documents chat says nothing in the library matched.                   |
| **Details**           | Why this dataset and what was checked: [`legal-dataset.md`](legal-dataset.md).                                                                                                                                                                                  |

## Official legal sources (optional extra)

|                       |                                                                                                                                                                                    |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Purpose**           | Statute text (central Acts) added to the same library.                                                                                                                             |
| **Hosts**             | `indiacode.nic.in` (India Code, Legislative Department), `legislative.gov.in`, `meity.gov.in`.                                                                                     |
| **Free?**             | Public government publications; no key for the sources themselves.                                                                                                                 |
| **Needs**             | `GEMINI_API_KEY`: the pipeline embeds every passage, and the loader exits with a notice without one.                                                                               |
| **Catalogue**         | `apps/api/app/services/ingestion/official_sources.py`: 15 Acts across IT law, contracts and corporate, consumer protection, IP, registration and stamp duty, and the Constitution. |
| **Load**              | `pnpm kb:seed` (or `cd apps/api && uv run python -m app.scripts.seed_corpus`). Idempotent; `--retry-failed`, `--only it ip`, `--list`.                                             |
| **Freshness**         | Snapshots as of ingestion, **updated when re-seeded**, not live. Each source keeps its URL and SHA-256 checksum; the status API reports when the library was last indexed.         |
| **Failure behaviour** | A moved or unavailable file is recorded as `FAILED` with the reason (`GET /api/v1/admin/legal-sources?status=FAILED`); other sources continue.                                     |

## Infrastructure

| Service               | Env                                 | Failure behaviour                                                                                                                   |
| --------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| PostgreSQL + pgvector | `DATABASE_URL`, `DATABASE_URL_SYNC` | `/health/ready` returns 503; `GET /status` reports `knowledge_base.available=false` instead of erroring.                            |
| Redis                 | `REDIS_URL`                         | `/health/ready` returns 503. The rate limiter and embedding cache **fail open** (requests are still served, the failure is logged). |

## Protecting free-tier quotas

- `AI_RATE_LIMIT_PER_MINUTE` (default 20): per-client (IP, or user id when logged in) limit on
  `POST /chat/messages`, `/chat/messages/stream` and `POST /documents`. Returns `429 rate_limited`
  with `Retry-After`. It applies in offline mode too.
- `EMBEDDING_CACHE_TTL_SECONDS` (default 24 h): repeated questions reuse their query embedding from
  Redis instead of calling the embedding API.
- In AI mode a chat turn is a classification call plus an answer call. Out-of-scope turns skip the
  answer call, and so do turns with no matching passage when `ALLOW_GENERAL_ANSWERS=false`. In
  offline mode a turn makes no model call at all.
