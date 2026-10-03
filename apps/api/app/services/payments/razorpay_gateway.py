"""Razorpay payment gateway (Phase 10).

Implements three documented Razorpay mechanics:

* **Order creation** — ``POST {base}/orders``, HTTP Basic Auth
  (key_id:key_secret), amount in the smallest currency unit (paise for
  INR). https://razorpay.com/docs/api/orders/create
* **Payment signature verification** (checkout callback) —
  ``HMAC-SHA256(key_secret, f"{order_id}|{payment_id}")`` must equal
  ``razorpay_signature``.
  https://razorpay.com/docs/payments/payment-gateway/web-integration/standard-checkout/
* **Refunds** — ``POST {base}/payments/{payment_id}/refund``, Basic Auth,
  optional ``amount`` in the smallest unit (omitted = full refund).
  https://razorpay.com/docs/api/refunds/create-normal
* **Webhook signature verification** —
  ``HMAC-SHA256(webhook_secret, raw_body)`` must equal the
  ``X-Razorpay-Signature`` header, computed over the *raw* request body
  (never the parsed/re-serialised JSON). https://razorpay.com/docs/webhooks/validate-test

Not exercised against a live Razorpay account from this sandbox — no
network egress to ``api.razorpay.com`` here, the same limitation
docs/adr/0011 hit for the legal-source discovery providers. The shapes and
algorithms above are Razorpay's own documented contract, not guessed; set
``RAZORPAY_KEY_ID``/``RAZORPAY_KEY_SECRET``/``RAZORPAY_WEBHOOK_SECRET``
(test-mode keys are free) and exercise a real order to confirm before
processing a live payment.
"""

from __future__ import annotations

import hashlib
import hmac
import json

import httpx

from app.core.config import Settings
from app.core.errors import ServiceUnavailableError, ValidationAppError
from app.core.logging import get_logger
from app.services.payments.base import GatewayOrder, GatewayRefund, WebhookEvent

logger = get_logger("app.payments.razorpay")

_TIMEOUT_SECONDS = 15.0


class RazorpayGateway:
    name = "razorpay"

    def _require_configured(self, settings: Settings) -> tuple[str, str]:
        if not settings.razorpay_key_id or not settings.razorpay_key_secret:
            raise ServiceUnavailableError(
                "Payments aren't configured yet (missing RAZORPAY_KEY_ID/RAZORPAY_KEY_SECRET).",
                code="payments_not_configured",
            )
        return settings.razorpay_key_id, settings.razorpay_key_secret

    async def create_order(
        self,
        *,
        amount: int,
        currency: str,
        receipt: str,
        notes: dict[str, str],
        settings: Settings,
    ) -> GatewayOrder:
        key_id, key_secret = self._require_configured(settings)
        try:
            async with httpx.AsyncClient(timeout=_TIMEOUT_SECONDS) as client:
                response = await client.post(
                    f"{settings.razorpay_api_base_url}/orders",
                    auth=(key_id, key_secret),
                    json={
                        "amount": amount,
                        "currency": currency,
                        "receipt": receipt,
                        "notes": notes,
                    },
                )
                response.raise_for_status()
        except httpx.HTTPError as exc:
            logger.warning("razorpay_order_create_failed", error=str(exc))
            raise ServiceUnavailableError(
                "Could not reach the payment gateway. Try again shortly.",
                code="payments_gateway_error",
            ) from exc

        body = response.json()
        return GatewayOrder(
            order_id=body["id"],
            amount=body["amount"],
            currency=body["currency"],
            status=body["status"],
        )

    async def refund(
        self, *, payment_id: str, amount: int | None, settings: Settings
    ) -> GatewayRefund:
        key_id, key_secret = self._require_configured(settings)
        body: dict[str, int] = {"amount": amount} if amount is not None else {}
        try:
            async with httpx.AsyncClient(timeout=_TIMEOUT_SECONDS) as client:
                response = await client.post(
                    f"{settings.razorpay_api_base_url}/payments/{payment_id}/refund",
                    auth=(key_id, key_secret),
                    json=body,
                )
                response.raise_for_status()
        except httpx.HTTPError as exc:
            logger.warning("razorpay_refund_failed", error=str(exc))
            raise ServiceUnavailableError(
                "The payment gateway rejected or didn't answer the refund request.",
                code="payments_gateway_error",
            ) from exc

        data = response.json()
        return GatewayRefund(refund_id=data["id"], amount=data["amount"], status=data["status"])

    def verify_payment_signature(
        self, *, order_id: str, payment_id: str, signature: str, settings: Settings
    ) -> bool:
        _, key_secret = self._require_configured(settings)
        expected = hmac.new(
            key_secret.encode(), f"{order_id}|{payment_id}".encode(), hashlib.sha256
        ).hexdigest()
        return hmac.compare_digest(expected, signature)

    def verify_webhook_signature(
        self, *, raw_body: bytes, signature: str, settings: Settings
    ) -> bool:
        if not settings.razorpay_webhook_secret:
            raise ServiceUnavailableError(
                "Payments aren't configured yet (missing RAZORPAY_WEBHOOK_SECRET).",
                code="payments_not_configured",
            )
        expected = hmac.new(
            settings.razorpay_webhook_secret.encode(), raw_body, hashlib.sha256
        ).hexdigest()
        return hmac.compare_digest(expected, signature)

    def parse_webhook_event(self, raw_body: bytes) -> WebhookEvent:
        try:
            payload = json.loads(raw_body)
        except (json.JSONDecodeError, UnicodeDecodeError) as exc:
            raise ValidationAppError("Malformed webhook payload.", code="invalid_webhook") from exc

        if not isinstance(payload, dict):
            raise ValidationAppError("Malformed webhook payload.", code="invalid_webhook")

        # Documented shape: {"event": ..., "payload": {"payment": {"entity": {...}},
        # "refund": {"entity": {...}}}} — refund events carry both entities.
        section = payload.get("payload") or {}
        payment_entity = (section.get("payment") or {}).get("entity") or {}
        refund_entity = (section.get("refund") or {}).get("entity") or {}
        is_refund_event = str(payload.get("event", "")).startswith("refund.")
        amount_source = refund_entity if is_refund_event and refund_entity else payment_entity

        raw_amount = amount_source.get("amount")
        return WebhookEvent(
            event=str(payload.get("event", "")),
            gateway_order_id=payment_entity.get("order_id"),
            gateway_payment_id=payment_entity.get("id") or refund_entity.get("payment_id"),
            amount=raw_amount if isinstance(raw_amount, int) else None,
            error_description=payment_entity.get("error_description"),
            raw=payload,
        )
