# 0013 — Notifications: in-app feed as the record, email as a best-effort copy, no SMS

- Status: Accepted
- Date: 2026-10-03
- Deciders: Platform team

## Context

Since Phase 1 every email went through `ConsoleEmailSender`, which only
logged. Phases 8 and 10 added events both parties need to hear about:
booking, accept, decline, cancel, complete, payment received, refund. The
roadmap's Phase 11 asks for email, SMS/OTP and in-app delivery.

## Decision

1. **In-app notifications are the durable record.** A `notifications` table
   (migration `0011`) gets one row per user-facing event, written by
   `app/services/notifications.py::notify`. Both frontends show a bell with
   the unread count (polled once a minute) and a `/notifications` page.
   Users can only list or mark their own; a foreign id returns 404.
2. **Email is a copy, not the source of truth.** `notify` also sends the
   same text by email. Delivery failures are logged and swallowed: an email
   is always a side effect of something already committed, and must not
   turn a successful booking or registration into a 500.
3. **Generic SMTP, not a provider SDK.** `EMAIL_BACKEND=smtp` plus
   `SMTP_*` settings works with Brevo, Resend, SES, Mailgun or Gmail,
   several of which have free tiers. Switching provider is a config change.
   `smtplib` runs in a worker thread so it doesn't block the event loop.
4. **Notify after commit, once per real transition.** `notify` commits its
   own row separately, so a notification failure can't roll back the
   business change. Payment notifications fire only on the transition into
   CAPTURED or REFUNDED, so a gateway's duplicate webhook doesn't
   double-notify (tested).
5. **No SMS or SMS-OTP.** Commercial SMS to Indian numbers requires sender-ID
   and template registration on a TRAI DLT platform before any message can
   be delivered. That is an account and regulatory step only the business
   can complete, and there's no free tier to build against. Email
   verification (Phase 1) remains the account-verification channel. Adding
   SMS later means adding a sender behind the same `notify` call.

## Consequences

- With no SMTP configured, everything still works: in-app notifications
  appear, and emails are logged as before.
- Notification text uses the consumer's display name, falling back to "A
  consumer". It never uses their email address, matching what the
  consultation API exposes to advocates.
- Not verified against a real SMTP relay from the build sandbox, which has
  no outbound SMTP. The sender is tested against a recording fake for
  STARTTLS, login and message headers, and for failures being swallowed.
  Send one real email after configuring `SMTP_*`.
