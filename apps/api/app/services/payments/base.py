"""Payment gateway abstraction (Phase 10).

Mirrors the "build now, key later" pattern ``app/services/llm_provider.py``
and ``app/services/ingestion/embed.py`` already use for optional external
dependencies: the interface is provider-agnostic, Razorpay
(``razorpay_gateway.py``) is the only implementation today, and nothing
calls it until ``RAZORPAY_KEY_ID``/``RAZORPAY_KEY_SECRET`` are configured.
A second gateway (Cashfree — named as a free-to-integrate test-mode option
in docs/project-status.md) is a new class implementing this ``Protocol``,
not a schema change.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from app.core.config import Settings


@dataclass(frozen=True, slots=True)
class GatewayOrder:
    order_id: str
    amount: int  # smallest currency unit (paise for INR), as the gateway returns it
    currency: str
    status: str


@dataclass(frozen=True, slots=True)
class WebhookEvent:
    event: str  # e.g. "payment.captured", "payment.failed", "refund.processed"
    gateway_order_id: str | None
    gateway_payment_id: str | None
    # Entity amount in the smallest currency unit (payment or refund amount).
    amount: int | None
    error_description: str | None
    raw: dict[str, object]


@dataclass(frozen=True, slots=True)
class GatewayRefund:
    refund_id: str
    amount: int  # smallest currency unit
    status: str


class PaymentGateway(Protocol):
    name: str

    async def create_order(
        self,
        *,
        amount: int,
        currency: str,
        receipt: str,
        notes: dict[str, str],
        settings: Settings,
    ) -> GatewayOrder: ...

    async def refund(
        self, *, payment_id: str, amount: int | None, settings: Settings
    ) -> GatewayRefund: ...

    def verify_payment_signature(
        self, *, order_id: str, payment_id: str, signature: str, settings: Settings
    ) -> bool: ...

    def verify_webhook_signature(
        self, *, raw_body: bytes, signature: str, settings: Settings
    ) -> bool: ...

    def parse_webhook_event(self, raw_body: bytes) -> WebhookEvent: ...
