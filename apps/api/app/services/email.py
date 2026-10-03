"""Email sending abstraction.

``EMAIL_BACKEND=console`` (default) logs each email via structlog — no
account needed to develop or test. ``EMAIL_BACKEND=smtp`` delivers through
any SMTP relay (Phase 11, docs/adr/0013), so switching providers is a
config change, not a code change.

Delivery is best-effort by design: a failed send is logged, never raised.
An email is always a side effect of something already committed (a
registration, a booking) and must not turn that into a 500 — the user can
resend a verification link, and every consultation event is also recorded
as an in-app notification (``app/services/notifications.py``).
"""

from __future__ import annotations

import asyncio
import smtplib
import ssl
from email.message import EmailMessage
from email.utils import make_msgid
from typing import Protocol

from app.core.config import Settings, get_settings
from app.core.logging import get_logger

logger = get_logger("app.email")


class EmailSender(Protocol):
    async def send(self, *, to: str, subject: str, body: str) -> None: ...


class ConsoleEmailSender:
    """Dev/test default: logs instead of sending."""

    async def send(self, *, to: str, subject: str, body: str) -> None:
        logger.info("email_dev_send", to=to, subject=subject, body=body)


class SmtpEmailSender:
    """Plain-text email over SMTP. ``smtplib`` is blocking, so each send runs
    in a worker thread rather than stalling the event loop."""

    def __init__(self, settings: Settings) -> None:
        self._settings = settings

    def _build(self, *, to: str, subject: str, body: str) -> EmailMessage:
        message = EmailMessage()
        message["From"] = self._settings.email_from
        message["To"] = to
        message["Subject"] = subject
        message["Message-ID"] = make_msgid()
        message.set_content(body)
        return message

    def _send_blocking(self, message: EmailMessage) -> None:
        s = self._settings
        if not s.smtp_host:
            raise OSError("SMTP_HOST is not configured.")
        context = ssl.create_default_context()
        smtp: smtplib.SMTP
        if s.smtp_ssl:
            smtp = smtplib.SMTP_SSL(
                s.smtp_host, s.smtp_port, timeout=s.smtp_timeout_seconds, context=context
            )
        else:
            smtp = smtplib.SMTP(s.smtp_host, s.smtp_port, timeout=s.smtp_timeout_seconds)
        with smtp:
            if s.smtp_starttls and not s.smtp_ssl:
                smtp.starttls(context=context)
            if s.smtp_username and s.smtp_password:
                smtp.login(s.smtp_username, s.smtp_password)
            smtp.send_message(message)

    async def send(self, *, to: str, subject: str, body: str) -> None:
        message = self._build(to=to, subject=subject, body=body)
        try:
            await asyncio.to_thread(self._send_blocking, message)
        except (OSError, smtplib.SMTPException) as exc:
            logger.warning("email_send_failed", to=to, subject=subject, error=str(exc)[:300])
            return
        logger.info("email_sent", to=to, subject=subject)


_sender: EmailSender | None = None


def get_email_sender() -> EmailSender:
    global _sender
    if _sender is None:
        settings = get_settings()
        if settings.email_backend == "smtp" and settings.smtp_host:
            _sender = SmtpEmailSender(settings)
        else:
            if settings.email_backend == "smtp":
                logger.warning("email_smtp_not_configured_falling_back_to_console")
            _sender = ConsoleEmailSender()
    return _sender


def set_email_sender(sender: EmailSender | None) -> None:
    """Override the process-wide sender (tests); ``None`` re-resolves from settings."""
    global _sender
    _sender = sender


async def send_email(*, to: str, subject: str, body: str) -> None:
    await get_email_sender().send(to=to, subject=subject, body=body)


async def send_verification_email(*, to: str, token: str, settings: Settings) -> None:
    link = f"{settings.frontend_base_url}/verify-email?token={token}"
    await send_email(
        to=to,
        subject="Verify your email — Legal Advisor",
        body=f"Confirm your email address: {link}\n\nThis link expires in 24 hours.",
    )


async def send_password_reset_email(*, to: str, token: str, settings: Settings) -> None:
    link = f"{settings.frontend_base_url}/reset-password?token={token}"
    await send_email(
        to=to,
        subject="Reset your password — Legal Advisor",
        body=f"Reset your password: {link}\n\nThis link expires in 1 hour. "
        "If you didn't request this, you can ignore this email.",
    )
