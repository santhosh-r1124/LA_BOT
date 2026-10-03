# Architecture Decision Records

Short, dated records of decisions that are expensive to reverse. One file per
decision, numbered sequentially. Status: `Proposed` → `Accepted` →
(`Superseded by NNNN` | `Deprecated`).

| #    | Title                          | Status   |
| ---- | ----------------------------- | -------- |
| 0001 | Monorepo tooling               | Accepted |
| 0002 | Database provisioning          | Accepted |
| 0003 | Schema ownership and migrations | Accepted |
| 0004 | Domain logic lives in apps/api, not services/* (for now) | Accepted |
| 0005 | Embedding provider: Gemini (free tier)      | Accepted |
| 0006 | Chunking strategy: plain sliding window, no heading detection | Accepted |
| 0007 | Hybrid search via RRF (not a reranker model), retrieval-based grounding guardrail | Accepted |
| 0008 | Risk scoring folded into the existing classification call, not a second LLM call | Accepted |
| 0009 | Document Assistant: static questionnaire, not RAG-grounded, failures not persisted | Accepted |
| 0010 | Provider-agnostic LLM layer (free providers first) and streamed chat | Accepted |
| 0011 | Dynamic legal-source discovery replaces the static catalogue | Accepted |
| 0012 | Payments: Razorpay behind a gateway interface, webhook as source of truth | Accepted |
| 0013 | Notifications: in-app feed as the record, email as a best-effort copy, no SMS | Accepted |
| 0014 | Security hardening: SSRF guard, auth throttling, audit trail, prompt fencing | Accepted |

## Template

```markdown
# NNNN — Title

- Status: Proposed | Accepted | Superseded by NNNN
- Date: YYYY-MM-DD
- Deciders: …

## Context
What forces are at play? What problem are we solving?

## Decision
What we're doing.

## Consequences
Trade-offs accepted; what becomes easier/harder; follow-ups.

## Alternatives considered
Option — why not.
```
