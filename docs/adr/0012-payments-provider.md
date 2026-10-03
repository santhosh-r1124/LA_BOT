# 0012 — Payments: Razorpay behind a gateway interface, webhook as source of truth

- Status: Accepted
- Date: 2026-10-03
- Deciders: Platform team

## Context

Phase 8 introduced consultations with a fee snapshot but no way to pay.
Phase 10 needs consultation payments, refunds and receipts. Constraints:
an Indian gateway (INR, UPI/cards/netbanking), free to integrate in test
mode, and the existing "build now, key later" rule — the app must run with
no gateway account configured, and fail clearly rather than fake success.

## Decision

1. **Razorpay, behind a `PaymentGateway` protocol**
   (`app/services/payments/base.py`). Razorpay is the only implementation
   (`razorpay_gateway.py`); Cashfree — the other free-test-mode option named
   in `docs/project-status.md` — would be a second class, not a schema change.
   `Payment.provider` records which gateway handled each row.
2. **Standard Checkout flow.** The server creates a gateway order
   (`POST /consultations/{id}/payment/order`), the browser opens Razorpay's
   hosted checkout with the order id, and posts the returned
   `payment_id` + `signature` back (`.../payment/verify`). The server checks
   `HMAC-SHA256(key_secret, order_id|payment_id)` before marking anything
   paid — the browser's "success" callback is never trusted on its own.
3. **The webhook is the source of truth.**
   `POST /api/v1/payments/webhooks/razorpay` verifies
   `HMAC-SHA256(webhook_secret, raw_body)` against `X-Razorpay-Signature`
   over the exact received bytes, then applies `payment.captured`,
   `payment.failed` and `refund.processed`. The checkout callback exists only
   so the consumer sees "paid" immediately. Both paths are idempotent and
   monotonic: duplicates are no-ops, and a late `payment.failed` can never
   un-capture a captured payment. Unknown orders/events are acknowledged
   (200) so the gateway stops retrying; a bad signature is a 401.
4. **One `payments` row per attempt** (migration `0010`), never overwritten,
   so failed attempts stay visible to an admin reviewing a dispute.
   `Consultation.payment_status` is the summary the rest of the app reads.
5. **Refunds are requested, then confirmed.** `POST /admin/payments/{id}/refund`
   calls the gateway; the local row flips to `REFUNDED` only when the
   `refund.processed` webhook arrives, since an accepted refund can still fail.
6. **Receipts, not tax invoices.** `GET /consultations/{id}/payments` lists
   each attempt (amount, gateway ids, capture time) for both parties.
   GST-compliant invoicing depends on the platform's registration and
   whether it or the advocate is the supplier — a legal/accounting decision
   (see the roadmap's "review the payment model against Indian professional
   rules" item), deliberately not encoded here.

## What was verified, and what wasn't

The four gateway mechanics — order creation (`POST /v1/orders`, Basic auth,
amount in paise), checkout signature, webhook signature over the raw body,
and refunds (`POST /v1/payments/{id}/refund`) — follow Razorpay's published
API documentation. They are exercised in `tests/test_payments.py` with the
HTTP layer faked but the HMAC code real (signatures computed independently
in the test). **No call was made to a real Razorpay account**: this was
built in a sandbox with no egress to `api.razorpay.com` (same limitation as
ADR 0011). Before taking a live payment, set test-mode keys, run one
checkout end to end, and fire a test webhook from the dashboard.

## Consequences

- New settings `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`,
  `RAZORPAY_WEBHOOK_SECRET`; unset means `503 payments_not_configured`.
- The webhook is the API's only unauthenticated write endpoint; its
  security rests entirely on the webhook secret staying secret.
- Payment success is not yet a precondition for the consultation itself —
  an advocate can still complete an unpaid consultation. Whether to enforce
  pay-before-session is a product decision, left open.
