# 0010 — Provider-agnostic LLM layer (free providers first) and streamed chat

- Status: Accepted
- Date: 2026-09-27
- Deciders: Platform team

## Context

Phases 2–6 called the Anthropic SDK directly from three modules
(classifier, grounded answers, document drafts). That made a **paid** key a
hard requirement for every AI feature, while the product requirement is that
the platform be runnable and testable on free services only. Embeddings were
already on Gemini's free tier (ADR 0005). Chat answers also arrived only as a
single blocking response, often 10–30s on free tiers, which read as a frozen UI
(and tripped the web client's 10s default timeout).

## Decision

1. **One interface, four providers** — `app/services/llm_provider.py` defines
   `complete`, `stream` and `complete_json` (schema-constrained output for
   classification). Implementations: Gemini (google-genai SDK, same key as
   embeddings), an OpenAI-compatible HTTP client used for both **Groq** and
   **Ollama** (plain `httpx`, no extra SDK), and Anthropic (kept, optional).
   `LLM_PROVIDER=auto` picks the first configured of gemini → groq → ollama →
   anthropic, so free options win by default.
2. **Errors are normalised** to `llm_not_configured`, `llm_rate_limited` and
   `llm_error`; provider messages are logged server-side only.
3. **Structured classification is validated, not trusted** — every provider
   returns a dict; `legal_classifier` re-checks each enum and falls back to the
   existing conservative defaults (risk `HIGH`, out-of-scope) on anything
   unparsable.
4. **Streaming chat over SSE** — `POST /chat/messages/stream` emits `start`
   (classification + sources), `delta`s, then `done` (the same
   `SendMessageResponse` the blocking endpoint returns) or `error`.
   Classification and retrieval run _before_ the stream opens so their failures
   keep proper HTTP status codes; a generation failure mid-stream rolls back
   and persists nothing, matching the blocking endpoint's 503. The blocking
   endpoint is unchanged.
5. **Quota protection** — per-client Redis rate limit on AI endpoints and a
   Redis cache for query embeddings, both fail-open.

## Consequences

- One free Gemini key runs everything; Groq/Ollama are one env var away.
- Output quality now depends on the chosen model; the grounding prompt and
  citation rules are unchanged, and retrieval still gates generation.
- Anthropic-specific behaviour (forced tool call) is preserved for that
  provider only; other providers use JSON-schema output / JSON mode.
- `LLM_MODEL` keeps its name for backwards compatibility but now applies only
  to Anthropic; other providers have their own `*_MODEL` settings.

## Alternatives considered

- **LiteLLM / LangChain as the abstraction** — a large dependency for three
  call shapes; the thin in-house interface is ~400 lines and fully tested.
- **OpenAI-compatible endpoint for Gemini too** — would remove the SDK path,
  but Gemini's native structured output (`response_json_schema`) and task
  types are better supported through its SDK, which we already depend on.
- **WebSockets instead of SSE** — bidirectional isn't needed; SSE works over
  plain `fetch` with POST bodies and through standard proxies.
