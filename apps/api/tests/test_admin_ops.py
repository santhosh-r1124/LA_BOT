"""Tests for Phase 12 admin endpoints: overview, risk review, pending list."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

from httpx import AsyncClient

from app.models.chat import ChatMessage, Conversation, MessageRole
from tests.test_discovery import _admin_headers


async def _seed_conversation(db: object) -> dict[str, uuid.UUID]:
    """One anonymous conversation: a HIGH and a CRITICAL user message (CRITICAL
    newer), each followed by an assistant reply, plus a LOW message."""
    conversation = Conversation(user_id=None)
    db.add(conversation)  # type: ignore[attr-defined]
    await db.flush()  # type: ignore[attr-defined]
    # chat_messages.created_at is TIMESTAMP WITHOUT TIME ZONE (migration 0003).
    base = datetime.now(UTC).replace(tzinfo=None) - timedelta(hours=1)
    ids: dict[str, uuid.UUID] = {}
    for offset, (key, role, content, risk) in enumerate(
        [
            ("high", MessageRole.USER, "My landlord changed the locks.", "HIGH"),
            ("high_reply", MessageRole.ASSISTANT, "Reply about tenancy.", None),
            ("critical", MessageRole.USER, "I was arrested without a warrant.", "CRITICAL"),
            ("critical_reply", MessageRole.ASSISTANT, "Reply about arrest rights.", None),
            ("low", MessageRole.USER, "What is an NDA?", "LOW"),
        ]
    ):
        message = ChatMessage(
            conversation_id=conversation.id,
            role=role,
            content=content,
            risk_level=risk,
            created_at=base + timedelta(minutes=offset),
        )
        db.add(message)  # type: ignore[attr-defined]
        await db.flush()  # type: ignore[attr-defined]
        ids[key] = message.id
    return ids


async def test_admin_endpoints_reject_non_admins(db_client: AsyncClient) -> None:
    consumer = await db_client.post(
        "/api/v1/auth/register",
        json={"email": f"c-{uuid.uuid4().hex[:8]}@example.com", "password": "correct horse 12"},
    )
    headers = {"Authorization": f"Bearer {consumer.json()['access_token']}"}
    for path in ("/api/v1/admin/overview", "/api/v1/admin/risk-review"):
        resp = await db_client.get(path, headers=headers)
        assert resp.status_code == 403, path


async def test_risk_review_queue_orders_critical_first_and_empties(
    db_client: AsyncClient, db_txn_session: object
) -> None:
    ids = await _seed_conversation(db_txn_session)
    headers = await _admin_headers(db_txn_session)

    resp = await db_client.get("/api/v1/admin/risk-review", headers=headers)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert [item["id"] for item in body["items"]] == [str(ids["critical"]), str(ids["high"])]
    critical = body["items"][0]
    assert critical["assistant_reply"] == "Reply about arrest rights."
    assert critical["is_anonymous"] is True

    resp = await db_client.get("/api/v1/admin/overview", headers=headers)
    assert resp.json()["risk_review_pending"] == 2

    resp = await db_client.post(
        f"/api/v1/admin/risk-review/{ids['critical']}/review",
        json={"note": "Advocate recommendation was shown; no action."},
        headers=headers,
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["reviewed_at"] is not None

    resp = await db_client.get("/api/v1/admin/risk-review", headers=headers)
    assert [item["id"] for item in resp.json()["items"]] == [str(ids["high"])]
    resp = await db_client.get(
        "/api/v1/admin/risk-review", params={"reviewed": True}, headers=headers
    )
    assert resp.json()["items"][0]["review_note"].startswith("Advocate recommendation")

    # LOW-risk messages aren't part of the queue.
    resp = await db_client.post(
        f"/api/v1/admin/risk-review/{ids['low']}/review", json={}, headers=headers
    )
    assert resp.status_code == 404


async def test_overview_shape(db_client: AsyncClient, db_txn_session: object) -> None:
    headers = await _admin_headers(db_txn_session)
    resp = await db_client.get("/api/v1/admin/overview", headers=headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["users_by_role"].get("ADMIN", 0) >= 1
    for key in (
        "consultations_by_status",
        "payments_by_status",
        "legal_documents_by_status",
        "catalog_by_status",
    ):
        assert isinstance(body[key], dict)


async def test_pending_advocates_include_account_details(
    db_client: AsyncClient, db_txn_session: object
) -> None:
    email = f"adv-{uuid.uuid4().hex[:8]}@example.com"
    resp = await db_client.post(
        "/api/v1/advocates/register",
        json={
            "email": email,
            "password": "correct horse battery staple",
            "display_name": "Adv. Pending",
            "practice_areas": ["IT_LAW"],
            "state_code": "MH",
            "city": "Mumbai",
            "languages": ["en"],
        },
    )
    assert resp.status_code == 201
    headers = await _admin_headers(db_txn_session)
    resp = await db_client.get("/api/v1/admin/advocates/pending", headers=headers)
    entry = next(i for i in resp.json()["items"] if i["email"] == email)
    assert entry["display_name"] == "Adv. Pending"


async def test_admin_cannot_suspend_self(db_client: AsyncClient, db_txn_session: object) -> None:
    headers = await _admin_headers(db_txn_session)
    me = await db_client.get("/api/v1/users/me", headers=headers)
    resp = await db_client.patch(
        f"/api/v1/admin/users/{me.json()['id']}", json={"is_active": False}, headers=headers
    )
    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "cannot_suspend_self"
