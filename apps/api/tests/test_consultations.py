"""Integration tests for /api/v1/consultations (Phase 8)."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from httpx import AsyncClient
from sqlalchemy import select

from app.models.user import AdvocateProfile, VerificationStatus
from tests.conftest import unique_email


async def _register(client: AsyncClient, path: str, **overrides: object) -> dict[str, object]:
    resp = await client.post(f"/api/v1/{path}", json=overrides)
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _verified_advocate(
    db_client: AsyncClient, db_txn_session: object
) -> tuple[dict[str, object], str]:
    tokens = await _register(
        db_client,
        "advocates/register",
        email=unique_email("advocate"),
        password="correct horse battery staple",
        display_name="Adv. Meera Iyer",
        practice_areas=["CONTRACT_LAW"],
        state_code="ka",
        city="Bengaluru",
        languages=["en"],
        consultation_fee="1500.00",
        experience_years=5,
    )
    profile = (
        await db_txn_session.execute(  # type: ignore[attr-defined]
            select(AdvocateProfile).order_by(AdvocateProfile.created_at.desc()).limit(1)
        )
    ).scalar_one()
    profile.verification_status = VerificationStatus.VERIFIED
    await db_txn_session.commit()  # type: ignore[attr-defined]
    return tokens, str(profile.id)


async def _consumer(db_client: AsyncClient) -> dict[str, object]:
    return await _register(
        db_client,
        "auth/register",
        email=unique_email("consumer"),
        password="correct horse battery staple",
    )


def _headers(tokens: dict[str, object]) -> dict[str, str]:
    return {"Authorization": f"Bearer {tokens['access_token']}"}


async def _book(
    db_client: AsyncClient,
    consumer_tokens: dict[str, object],
    advocate_profile_id: str,
    **overrides: object,
) -> dict[str, object]:
    payload = {
        "advocate_profile_id": advocate_profile_id,
        "practice_area": "CONTRACT_LAW",
        "topic": "Reviewing a vendor agreement",
        "description": "Need help understanding a termination clause.",
        "mode": "VIDEO",
        **overrides,
    }
    resp = await db_client.post(
        "/api/v1/consultations", json=payload, headers=_headers(consumer_tokens)
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


async def test_consumer_can_book_only_a_verified_advocate(
    db_client: AsyncClient, db_txn_session: object
) -> None:
    consumer_tokens = await _consumer(db_client)
    advocate_tokens = await _register(
        db_client,
        "advocates/register",
        email=unique_email("advocate"),
        password="correct horse battery staple",
        display_name="Adv. Unverified",
        practice_areas=["CONTRACT_LAW"],
        state_code="ka",
        city="Bengaluru",
        languages=["en"],
        consultation_fee="1000.00",
        experience_years=2,
    )
    profile_resp = await db_client.get("/api/v1/advocates/me", headers=_headers(advocate_tokens))
    profile_id = profile_resp.json()["id"]

    resp = await db_client.post(
        "/api/v1/consultations",
        json={
            "advocate_profile_id": profile_id,
            "practice_area": "CONTRACT_LAW",
            "topic": "x",
            "description": "x",
            "mode": "VIDEO",
        },
        headers=_headers(consumer_tokens),
    )
    assert resp.status_code == 404


async def test_full_booking_lifecycle_accept_complete_close(
    db_client: AsyncClient, db_txn_session: object
) -> None:
    advocate_tokens, profile_id = await _verified_advocate(db_client, db_txn_session)
    consumer_tokens = await _consumer(db_client)

    booking = await _book(db_client, consumer_tokens, profile_id)
    assert booking["status"] == "REQUESTED"
    assert booking["fee_amount"] == "1500.00"
    assert booking["advocate_notes"] is None
    consultation_id = booking["id"]

    scheduled_at = (datetime.now(UTC) + timedelta(days=2)).isoformat()
    resp = await db_client.post(
        f"/api/v1/consultations/{consultation_id}/accept",
        json={"scheduled_at": scheduled_at, "meeting_link": "https://meet.example.com/x"},
        headers=_headers(advocate_tokens),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "ACCEPTED"
    assert resp.json()["meeting_link"] == "https://meet.example.com/x"

    # Consumer cannot complete or close — only the advocate can.
    resp = await db_client.post(
        f"/api/v1/consultations/{consultation_id}/complete",
        json={},
        headers=_headers(consumer_tokens),
    )
    assert resp.status_code == 403

    resp = await db_client.post(
        f"/api/v1/consultations/{consultation_id}/complete",
        json={"advocate_notes": "Advised on clause 4.2; drafted a response."},
        headers=_headers(advocate_tokens),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "COMPLETED"
    # The advocate sees their own notes...
    assert resp.json()["advocate_notes"] == "Advised on clause 4.2; drafted a response."

    # ...but the consumer never does.
    resp = await db_client.get(
        f"/api/v1/consultations/{consultation_id}", headers=_headers(consumer_tokens)
    )
    assert resp.status_code == 200
    assert resp.json()["advocate_notes"] is None

    resp = await db_client.post(
        f"/api/v1/consultations/{consultation_id}/close", headers=_headers(advocate_tokens)
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "CLOSED"
    assert resp.json()["closed_at"] is not None

    # A closed consultation can't be cancelled or re-accepted.
    resp = await db_client.post(
        f"/api/v1/consultations/{consultation_id}/cancel",
        json={"reason": "too late"},
        headers=_headers(consumer_tokens),
    )
    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "invalid_transition"


async def test_advocate_can_decline_a_request(
    db_client: AsyncClient, db_txn_session: object
) -> None:
    advocate_tokens, profile_id = await _verified_advocate(db_client, db_txn_session)
    consumer_tokens = await _consumer(db_client)
    booking = await _book(db_client, consumer_tokens, profile_id)

    resp = await db_client.post(
        f"/api/v1/consultations/{booking['id']}/decline",
        json={"reason": "Outside my practice area."},
        headers=_headers(advocate_tokens),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "DECLINED"
    assert resp.json()["decline_reason"] == "Outside my practice area."


async def test_consumer_can_cancel_before_acceptance(
    db_client: AsyncClient, db_txn_session: object
) -> None:
    advocate_tokens, profile_id = await _verified_advocate(db_client, db_txn_session)
    consumer_tokens = await _consumer(db_client)
    booking = await _book(db_client, consumer_tokens, profile_id)

    resp = await db_client.post(
        f"/api/v1/consultations/{booking['id']}/cancel",
        json={"reason": "Found another advocate."},
        headers=_headers(consumer_tokens),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "CANCELLED"

    # Advocate can no longer accept a cancelled request.
    resp = await db_client.post(
        f"/api/v1/consultations/{booking['id']}/accept",
        json={"scheduled_at": datetime.now(UTC).isoformat()},
        headers=_headers(advocate_tokens),
    )
    assert resp.status_code == 422


async def test_a_third_party_cannot_see_or_act_on_a_consultation(
    db_client: AsyncClient, db_txn_session: object
) -> None:
    _advocate_tokens, profile_id = await _verified_advocate(db_client, db_txn_session)
    consumer_tokens = await _consumer(db_client)
    other_consumer_tokens = await _consumer(db_client)
    booking = await _book(db_client, consumer_tokens, profile_id)

    resp = await db_client.get(
        f"/api/v1/consultations/{booking['id']}", headers=_headers(other_consumer_tokens)
    )
    assert resp.status_code == 403

    resp = await db_client.post(
        f"/api/v1/consultations/{booking['id']}/cancel",
        json={"reason": "not mine"},
        headers=_headers(other_consumer_tokens),
    )
    assert resp.status_code == 403


async def test_list_consultations_scopes_by_role(
    db_client: AsyncClient, db_txn_session: object
) -> None:
    advocate_tokens, profile_id = await _verified_advocate(db_client, db_txn_session)
    consumer_tokens = await _consumer(db_client)
    other_consumer_tokens = await _consumer(db_client)

    await _book(db_client, consumer_tokens, profile_id, topic="First matter")
    await _book(db_client, other_consumer_tokens, profile_id, topic="Second matter")

    resp = await db_client.get("/api/v1/consultations", headers=_headers(consumer_tokens))
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 1
    assert body["items"][0]["topic"] == "First matter"

    resp = await db_client.get("/api/v1/consultations", headers=_headers(advocate_tokens))
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 2


async def test_booking_requires_authentication(db_client: AsyncClient) -> None:
    resp = await db_client.post(
        "/api/v1/consultations",
        json={
            "advocate_profile_id": "00000000-0000-0000-0000-000000000000",
            "practice_area": "CONTRACT_LAW",
            "topic": "x",
            "description": "x",
            "mode": "VIDEO",
        },
    )
    assert resp.status_code == 401


async def test_advocate_accounts_cannot_book_consultations(
    db_client: AsyncClient, db_txn_session: object
) -> None:
    advocate_tokens, profile_id = await _verified_advocate(db_client, db_txn_session)
    resp = await db_client.post(
        "/api/v1/consultations",
        json={
            "advocate_profile_id": profile_id,
            "practice_area": "CONTRACT_LAW",
            "topic": "x",
            "description": "x",
            "mode": "VIDEO",
        },
        headers=_headers(advocate_tokens),
    )
    assert resp.status_code == 403
