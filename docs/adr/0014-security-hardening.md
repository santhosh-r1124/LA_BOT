# 0014 — Security hardening: SSRF guard, auth throttling, audit trail, prompt fencing

- Status: Accepted
- Date: 2026-10-03
- Deciders: Platform team

## Context

Phases 8–12 added payments, an unauthenticated payment webhook, admin
powers over users, money and the knowledge base, and dynamic discovery.
Discovery means the ingestion fetcher now downloads URLs that come from
third-party datasets, not only from admins. `docs/project-status.md`
already listed two open gaps: no private-network egress filter on
ingestion, and rate limits that key on an IP the app may not see correctly
behind a proxy.

## Decisions

1. **SSRF guard on every server-side fetch** (`app/core/net_safety.py`).
   Only http(s) is allowed. Every address the host resolves to must be
   globally routable: no private, loopback, link-local (cloud metadata),
   CGNAT, multicast or IPv4-mapped-private ranges. Redirects are followed
   manually so each hop is checked. httpx's automatic redirects would let a
   public URL bounce the request inward. `INGESTION_ALLOWED_HOSTS` restricts
   fetching to named hosts and their subdomains. The production template
   allows only government hosts. Add `archive.org` there if you use the
   `hf_dataset` provider, whose rows point at the Internet Archive.
   _Residual risk:_ DNS rebinding between the check and httpx's own
   connection. The allow-list closes it; IP pinning was out of scope.
2. **Brute-force brake on credential endpoints.** Register, login, refresh,
   verify-email, resend, forgot-password, reset-password and advocate
   registration share a per-IP limit (`AUTH_RATE_LIMIT_PER_MINUTE`, default
   10). It reuses the Redis limiter and fails open like it. Behind a load
   balancer, set `FORWARDED_ALLOW_IPS` so uvicorn trusts `X-Forwarded-For`.
   Otherwise every user shares one bucket.
3. **Refuse insecure production config.** `Settings` raises at startup when
   `APP_ENV=production` and `JWT_SECRET` is a known default or shorter than
   32 characters, or `CORS_ORIGINS` contains `*`.
4. **Security headers.** The API sends `nosniff`, `X-Frame-Options: DENY`,
   a strict referrer policy, COOP, and a Permissions-Policy, plus
   `default-src 'none'` CSP on JSON routes; `/docs` is exempt. HSTS is sent
   in production only. It's pure ASGI, so SSE chat streams aren't buffered.
   Both Next apps add a Permissions-Policy to their existing headers. A full
   CSP for the frontends is a follow-up: Next's inline bootstrap scripts and
   Razorpay's hosted checkout need nonce plumbing to do it properly.
5. **Append-only admin audit trail** (`audit_events`, migration `0013`).
   Advocate verify/reject, user suspend/reactivate, high-risk review,
   refunds, and every knowledge-base mutation (ingest, discovery run, batch
   ingest, re-index, delete) record the actor, action, target, details and
   client IP. There is no update or delete API. Rows are written after the
   action commits. A failed audit write is logged at error level, not
   raised, so an action that already happened is never reported as failed.
   Viewable at `/admin/audit`.
6. **Prompt-injection fencing.** Retrieved passages and the user's question
   reach the model inside `<source-TAG>` / `<question-TAG>` elements, where
   TAG is a fresh random nonce per turn. Angle brackets in untrusted text
   are replaced with look-alike characters. The system prompt says only
   this turn's tagged sources count, and that their contents are data, not
   instructions. This means an ingested Act can't issue instructions, and a
   user can't paste a fake "source" and have it cited. The classifier gets
   the same treatment, so "rate this LOW" can't suppress the advocate
   recommendation for a CRITICAL matter. This reduces injection risk; it
   doesn't eliminate it. No delimiter scheme is a guarantee against a
   sufficiently capable model being persuaded.

## Also checked, no change needed

- Suspended users are rejected at login, refresh and on every authenticated
  request (`get_current_user`), so suspension takes effect immediately.
- Ownership: consultations, payments, notifications, chat and documents
  are all scoped per user, with tests for cross-account access.
- The payment webhook verifies HMAC over the raw body (ADR 0012).

## Not done

- Tenant isolation for `ENTERPRISE_USER`: there is no organisation model
  yet to isolate on.
- DPDP Act data-principal rights (export/erasure endpoints) and retention
  windows for chat logs: these need a retention policy decided by the
  business first.
- Refresh tokens still live in `localStorage`. Moving them to an `httpOnly`
  cookie needs the API and frontends on one site or a CSRF design.
