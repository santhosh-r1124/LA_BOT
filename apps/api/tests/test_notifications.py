"""Tests for Phase 11: in-app notifications and SMTP delivery."""

from __future__ import annotations

import smtplib
from email.message import EmailMessage
from typing import ClassVar

import pytest
from httpx import AsyncClient

from app.core.config import Settings
from app.services.email import SmtpEmailSender
from tests.test_consultations import _book, _consumer, _headers, _verified_advocate

# ---------------------------------------------------------------------------
# SMTP sender (no network: smtplib is replaced with a recording fake)
# ---------------------------------------------------------------------------


class _FakeSMTP:
    instances: ClassVar[list[_FakeSMTP]] = []

    def __init__(self, host: str, port: int, timeout: float) -> None:
        self.host, self.port = host, port
        self.calls: list[str] = []
        self.sent: list[EmailMessage] = []
        _FakeSMTP.instances.append(self)

    def __enter__(self) -> _FakeSMTP:
        return self

    def __exit__(self, *exc: object) -> None:
        self.calls.append("quit")

    def starttls(self, context: object = None) -> None:
        self.calls.append("starttls")

    def login(self, user: str, password: str) -> None:
        self.calls.append(f"login:{user}")

    def send_message(self, message: EmailMessage) -> None:
        self.sent.append(message)


def _smtp_settings(**overrides: object) -> Settings:
    return Settings(
        email_backend="smtp",
        smtp_host="smtp.example.com",
        smtp_port=587,
        smtp_username="apikey",
        smtp_password="secret",
        email_from="Legal Advisor <no-reply@example.com>",
        **overrides,  # type: ignore[arg-type]
    )


async def test_smtp_sender_uses_starttls_login_and_builds_message(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _FakeSMTP.instances.clear()
    monkeypatch.setattr(smtplib, "SMTP", _FakeSMTP)
    await SmtpEmailSender(_smtp_settings()).send(
        to="user@example.com", subject="Hello", body="Body text"
    )
    smtp = _FakeSMTP.instances[0]
    assert (smtp.host, smtp.port) == ("smtp.example.com", 587)
    assert smtp.calls[:2] == ["starttls", "login:apikey"]
    message = smtp.sent[0]
    assert message["To"] == "user@example.com"
    assert message["From"] == "Legal Advisor <no-reply@example.com>"
    assert message.get_content().strip() == "Body text"


async def test_smtp_failure_is_logged_not_raised(monkeypatch: pytest.MonkeyPatch) -> None:
    def refuse(*args: object, **kwargs: object) -> None:
        raise ConnectionRefusedError("smtp down")

    monkeypatch.setattr(smtplib, "SMTP", refuse)
    # Must not raise: an email is always a side effect of an already-committed action.
    await SmtpEmailSender(_smtp_settings()).send(to="u@example.com", subject="s", body="b")


# ---------------------------------------------------------------------------
# In-app notifications through the API
# ---------------------------------------------------------------------------


async def test_booking_notifies_advocate_and_feed_is_private(
    db_client: AsyncClient, db_txn_session: object
) -> None:
    advocate_tokens, profile_id = await _verified_advocate(db_client, db_txn_session)
    consumer_tokens = await _consumer(db_client)

    # Verification by admin already produced one notification for the advocate.
    resp = await db_client.get(
        "/api/v1/notifications/unread-count", headers=_headers(advocate_tokens)
    )
    baseline = resp.json()["unread"]

    await _book(db_client, consumer_tokens, profile_id, topic="Lease dispute")

    resp = await db_client.get("/api/v1/notifications", headers=_headers(advocate_tokens))
    assert resp.status_code == 200
    body = resp.json()
    assert body["unread"] == baseline + 1
    latest = body["items"][0]
    assert latest["kind"] == "CONSULTATION_REQUESTED"
    assert "Lease dispute" in latest["body"]
    assert latest["read_at"] is None

    # The consumer can't see or mark the advocate's notification.
    resp = await db_client.get("/api/v1/notifications", headers=_headers(consumer_tokens))
    assert all(n["id"] != latest["id"] for n in resp.json()["items"])
    resp = await db_client.post(
        f"/api/v1/notifications/{latest['id']}/read", headers=_headers(consumer_tokens)
    )
    assert resp.status_code == 404

    resp = await db_client.post(
        f"/api/v1/notifications/{latest['id']}/read", headers=_headers(advocate_tokens)
    )
    assert resp.status_code == 200
    assert resp.json()["read_at"] is not None

    resp = await db_client.post("/api/v1/notifications/read-all", headers=_headers(advocate_tokens))
    assert resp.status_code == 204
    resp = await db_client.get(
        "/api/v1/notifications/unread-count", headers=_headers(advocate_tokens)
    )
    assert resp.json()["unread"] == 0


async def test_lifecycle_events_reach_the_other_party(
    db_client: AsyncClient, db_txn_session: object
) -> None:
    advocate_tokens, profile_id = await _verified_advocate(db_client, db_txn_session)
    consumer_tokens = await _consumer(db_client)
    booking = await _book(db_client, consumer_tokens, profile_id)

    await db_client.post(
        f"/api/v1/consultations/{booking['id']}/decline",
        json={"reason": "Conflict of interest."},
        headers=_headers(advocate_tokens),
    )
    resp = await db_client.get("/api/v1/notifications", headers=_headers(consumer_tokens))
    kinds = [n["kind"] for n in resp.json()["items"]]
    assert "CONSULTATION_DECLINED" in kinds


async def test_notifications_require_auth(db_client: AsyncClient) -> None:
    resp = await db_client.get("/api/v1/notifications")
    assert resp.status_code == 401
