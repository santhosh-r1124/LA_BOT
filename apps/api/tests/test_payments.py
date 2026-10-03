"""Tests for Phase 10 payments.

The Razorpay HTTP calls (order create, refund) are monkeypatched; the
signature checks are NOT — they run the real HMAC code against signatures
computed independently here, so a regression in the crypto fails the suite.
"""

from __future__ import annotations

import hashlib
import hmac
import json
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta

import httpx
import pytest
from httpx import AsyncClient

from app.core.config import get_settings
from app.core.errors import ServiceUnavailableError
from app.services.payments.razorpay_gateway import RazorpayGateway
from tests.test_consultations import _book, _consumer, _headers, _verified_advocate

KEY_ID = "rzp_test_key"
KEY_SECRET = "test_key_secret"
WEBHOOK_SECRET = "test_webhook_secret"


@pytest.fixture
def razorpay_configured(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    monkeypatch.setenv("RAZORPAY_KEY_ID", KEY_ID)
    monkeypatch.setenv("RAZORPAY_KEY_SECRET", KEY_SECRET)
    monkeypatch.setenv("RAZORPAY_WEBHOOK_SECRET", WEBHOOK_SECRET)
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


@pytest.fixture
def fake_razorpay_http(monkeypatch: pytest.MonkeyPatch) -> list[dict[str, object]]:
    """Stands in for api.razorpay.com; records each request it receives.
    Anything else (the test client's own calls into the app) passes through."""
    calls: list[dict[str, object]] = []
    real_post = httpx.AsyncClient.post

    async def fake_post(self: httpx.AsyncClient, url: str, **kwargs: object) -> httpx.Response:
        if not str(url).startswith("https://api.razorpay.com"):
            return await real_post(self, url, **kwargs)  # type: ignore[arg-type]
        json = kwargs.get("json")
        calls.append({"url": url, "auth": kwargs.get("auth"), "json": json})
        request = httpx.Request("POST", url)
        if url.endswith("/orders"):
            assert isinstance(json, dict)
            return httpx.Response(
                200,
                json={
                    "id": f"order_test{len(calls)}",
                    "amount": json["amount"],
                    "currency": json["currency"],
                    "status": "created",
                },
                request=request,
            )
        if url.endswith("/refund"):
            return httpx.Response(
                200,
                json={"id": "rfnd_test1", "amount": 150000, "status": "processed"},
                request=request,
            )
        return httpx.Response(404, request=request)

    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)
    return calls


def _checkout_signature(order_id: str, payment_id: str) -> str:
    return hmac.new(
        KEY_SECRET.encode(), f"{order_id}|{payment_id}".encode(), hashlib.sha256
    ).hexdigest()


def _webhook(event: str, *, order_id: str, payment_id: str, **extra: object) -> tuple[bytes, str]:
    payment_entity: dict[str, object] = {
        "id": payment_id,
        "order_id": order_id,
        "amount": 150000,
        "currency": "INR",
        **extra,
    }
    body: dict[str, object] = {"event": event, "payload": {"payment": {"entity": payment_entity}}}
    if event.startswith("refund."):
        body["payload"] = {
            "payment": {"entity": payment_entity},
            "refund": {"entity": {"id": "rfnd_1", "payment_id": payment_id, "amount": 150000}},
        }
    raw = json.dumps(body).encode()
    signature = hmac.new(WEBHOOK_SECRET.encode(), raw, hashlib.sha256).hexdigest()
    return raw, signature


# ---------------------------------------------------------------------------
# Gateway unit tests
# ---------------------------------------------------------------------------


def test_checkout_signature_accepts_valid_and_rejects_tampered(
    razorpay_configured: None,
) -> None:
    gateway = RazorpayGateway()
    settings = get_settings()
    good = _checkout_signature("order_1", "pay_1")
    assert gateway.verify_payment_signature(
        order_id="order_1", payment_id="pay_1", signature=good, settings=settings
    )
    # Same signature, different payment id -> must fail (prevents replaying
    # one successful payment's signature to confirm another).
    assert not gateway.verify_payment_signature(
        order_id="order_1", payment_id="pay_2", signature=good, settings=settings
    )


def test_webhook_signature_is_over_raw_bytes(razorpay_configured: None) -> None:
    gateway = RazorpayGateway()
    raw, signature = _webhook("payment.captured", order_id="order_1", payment_id="pay_1")
    settings = get_settings()
    assert gateway.verify_webhook_signature(raw_body=raw, signature=signature, settings=settings)
    # Semantically identical JSON with different whitespace must NOT verify.
    reserialised = json.dumps(json.loads(raw), indent=2).encode()
    assert not gateway.verify_webhook_signature(
        raw_body=reserialised, signature=signature, settings=settings
    )


def test_parse_refund_webhook_uses_refund_amount_and_payment_id() -> None:
    raw, _ = _webhook("refund.processed", order_id="order_1", payment_id="pay_1")
    event = RazorpayGateway().parse_webhook_event(raw)
    assert event.event == "refund.processed"
    assert event.gateway_payment_id == "pay_1"
    assert event.gateway_order_id == "order_1"
    assert event.amount == 150000


async def test_create_order_without_keys_is_not_configured() -> None:
    with pytest.raises(ServiceUnavailableError) as exc_info:
        await RazorpayGateway().create_order(
            amount=100, currency="INR", receipt="r", notes={}, settings=get_settings()
        )
    assert exc_info.value.code == "payments_not_configured"


async def test_create_order_sends_documented_request_shape(
    razorpay_configured: None, fake_razorpay_http: list[dict[str, object]]
) -> None:
    order = await RazorpayGateway().create_order(
        amount=150000, currency="INR", receipt="rcpt", notes={"k": "v"}, settings=get_settings()
    )
    assert order.order_id.startswith("order_")
    call = fake_razorpay_http[0]
    assert call["url"] == "https://api.razorpay.com/v1/orders"
    assert call["auth"] == (KEY_ID, KEY_SECRET)
    assert call["json"] == {
        "amount": 150000,
        "currency": "INR",
        "receipt": "rcpt",
        "notes": {"k": "v"},
    }


# ---------------------------------------------------------------------------
# End-to-end through the API
# ---------------------------------------------------------------------------


async def _accepted_consultation(
    db_client: AsyncClient, db_txn_session: object
) -> tuple[dict[str, object], dict[str, object], str]:
    advocate_tokens, profile_id = await _verified_advocate(db_client, db_txn_session)
    consumer_tokens = await _consumer(db_client)
    booking = await _book(db_client, consumer_tokens, profile_id)
    resp = await db_client.post(
        f"/api/v1/consultations/{booking['id']}/accept",
        json={"scheduled_at": (datetime.now(UTC) + timedelta(days=1)).isoformat()},
        headers=_headers(advocate_tokens),
    )
    assert resp.status_code == 200, resp.text
    return advocate_tokens, consumer_tokens, str(booking["id"])


async def test_cannot_pay_before_acceptance(
    db_client: AsyncClient,
    db_txn_session: object,
    razorpay_configured: None,
    fake_razorpay_http: list[dict[str, object]],
) -> None:
    _advocate, profile_id = await _verified_advocate(db_client, db_txn_session)
    consumer_tokens = await _consumer(db_client)
    booking = await _book(db_client, consumer_tokens, profile_id)
    resp = await db_client.post(
        f"/api/v1/consultations/{booking['id']}/payment/order", headers=_headers(consumer_tokens)
    )
    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "not_payable"
    assert fake_razorpay_http == []


async def test_checkout_flow_order_then_verify_marks_paid(
    db_client: AsyncClient,
    db_txn_session: object,
    razorpay_configured: None,
    fake_razorpay_http: list[dict[str, object]],
) -> None:
    advocate_tokens, consumer_tokens, consultation_id = await _accepted_consultation(
        db_client, db_txn_session
    )

    # The advocate can't start the consumer's checkout.
    resp = await db_client.post(
        f"/api/v1/consultations/{consultation_id}/payment/order", headers=_headers(advocate_tokens)
    )
    assert resp.status_code == 403

    resp = await db_client.post(
        f"/api/v1/consultations/{consultation_id}/payment/order", headers=_headers(consumer_tokens)
    )
    assert resp.status_code == 201, resp.text
    order = resp.json()
    assert order["amount_minor"] == 150000  # ₹1500.00 in paise
    assert order["key_id"] == KEY_ID
    assert order["payment"]["status"] == "CREATED"

    # A forged signature is rejected and the consultation isn't marked paid.
    resp = await db_client.post(
        f"/api/v1/consultations/{consultation_id}/payment/verify",
        json={
            "payment_id": order["payment"]["id"],
            "gateway_payment_id": "pay_forged",
            "signature": "0" * 64,
        },
        headers=_headers(consumer_tokens),
    )
    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "invalid_payment_signature"

    resp = await db_client.post(
        f"/api/v1/consultations/{consultation_id}/payment/verify",
        json={
            "payment_id": order["payment"]["id"],
            "gateway_payment_id": "pay_real1",
            "signature": _checkout_signature(order["gateway_order_id"], "pay_real1"),
        },
        headers=_headers(consumer_tokens),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "CAPTURED"

    resp = await db_client.get(
        f"/api/v1/consultations/{consultation_id}", headers=_headers(consumer_tokens)
    )
    assert resp.json()["payment_status"] == "PAID"

    # Paying twice is refused.
    resp = await db_client.post(
        f"/api/v1/consultations/{consultation_id}/payment/order", headers=_headers(consumer_tokens)
    )
    assert resp.status_code == 409


async def test_webhook_capture_failure_ordering_and_refund(
    db_client: AsyncClient,
    db_txn_session: object,
    razorpay_configured: None,
    fake_razorpay_http: list[dict[str, object]],
) -> None:
    advocate_tokens, consumer_tokens, consultation_id = await _accepted_consultation(
        db_client, db_txn_session
    )
    resp = await db_client.post(
        f"/api/v1/consultations/{consultation_id}/payment/order", headers=_headers(consumer_tokens)
    )
    order_id = resp.json()["gateway_order_id"]

    # Bad signature -> 401, nothing applied.
    raw, _sig = _webhook("payment.captured", order_id=order_id, payment_id="pay_w1")
    resp = await db_client.post(
        "/api/v1/payments/webhooks/razorpay",
        content=raw,
        headers={"X-Razorpay-Signature": "f" * 64, "Content-Type": "application/json"},
    )
    assert resp.status_code == 401

    # Valid capture, delivered twice (gateways retry) -> idempotent.
    raw, sig = _webhook("payment.captured", order_id=order_id, payment_id="pay_w1")
    for _ in range(2):
        resp = await db_client.post(
            "/api/v1/payments/webhooks/razorpay",
            content=raw,
            headers={"X-Razorpay-Signature": sig, "Content-Type": "application/json"},
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["outcome"] == "captured"

    # ...and the advocate is told exactly once despite the duplicate delivery.
    resp = await db_client.get("/api/v1/notifications", headers=_headers(advocate_tokens))
    kinds = [n["kind"] for n in resp.json()["items"]]
    assert kinds.count("PAYMENT_RECEIVED") == 1

    # A late payment.failed for the same order must not un-capture it.
    raw, sig = _webhook(
        "payment.failed", order_id=order_id, payment_id="pay_w1", error_description="declined"
    )
    resp = await db_client.post(
        "/api/v1/payments/webhooks/razorpay",
        content=raw,
        headers={"X-Razorpay-Signature": sig, "Content-Type": "application/json"},
    )
    assert resp.status_code == 200
    resp = await db_client.get(
        f"/api/v1/consultations/{consultation_id}/payments", headers=_headers(consumer_tokens)
    )
    assert resp.json()[0]["status"] == "CAPTURED"

    raw, sig = _webhook("refund.processed", order_id=order_id, payment_id="pay_w1")
    resp = await db_client.post(
        "/api/v1/payments/webhooks/razorpay",
        content=raw,
        headers={"X-Razorpay-Signature": sig, "Content-Type": "application/json"},
    )
    assert resp.json()["outcome"] == "refunded"
    resp = await db_client.get(
        f"/api/v1/consultations/{consultation_id}", headers=_headers(consumer_tokens)
    )
    assert resp.json()["payment_status"] == "REFUNDED"


async def test_webhook_for_unknown_order_is_acknowledged(
    db_client: AsyncClient, razorpay_configured: None
) -> None:
    raw, sig = _webhook("payment.captured", order_id="order_nobody", payment_id="pay_x")
    resp = await db_client.post(
        "/api/v1/payments/webhooks/razorpay",
        content=raw,
        headers={"X-Razorpay-Signature": sig, "Content-Type": "application/json"},
    )
    assert resp.status_code == 200
    assert resp.json()["outcome"] == "unmatched"


async def test_admin_refund_calls_gateway_and_rejects_uncaptured(
    db_client: AsyncClient,
    db_txn_session: object,
    razorpay_configured: None,
    fake_razorpay_http: list[dict[str, object]],
) -> None:
    from tests.test_discovery import _admin_headers

    _advocate, consumer_tokens, consultation_id = await _accepted_consultation(
        db_client, db_txn_session
    )
    resp = await db_client.post(
        f"/api/v1/consultations/{consultation_id}/payment/order", headers=_headers(consumer_tokens)
    )
    order = resp.json()
    admin = await _admin_headers(db_txn_session)

    resp = await db_client.post(
        f"/api/v1/admin/payments/{order['payment']['id']}/refund", json={}, headers=admin
    )
    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "not_refundable"

    await db_client.post(
        f"/api/v1/consultations/{consultation_id}/payment/verify",
        json={
            "payment_id": order["payment"]["id"],
            "gateway_payment_id": "pay_r1",
            "signature": _checkout_signature(order["gateway_order_id"], "pay_r1"),
        },
        headers=_headers(consumer_tokens),
    )
    resp = await db_client.post(
        f"/api/v1/admin/payments/{order['payment']['id']}/refund", json={}, headers=admin
    )
    assert resp.status_code == 200, resp.text
    assert fake_razorpay_http[-1]["url"] == "https://api.razorpay.com/v1/payments/pay_r1/refund"

    resp = await db_client.get("/api/v1/admin/payments", headers=admin)
    assert resp.status_code == 200
    assert resp.json()["total"] >= 1
