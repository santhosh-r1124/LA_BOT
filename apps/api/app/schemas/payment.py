"""Payment schemas (Phase 10)."""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field

from app.models.payment import PaymentStatus


class PaymentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    consultation_id: uuid.UUID
    provider: str
    gateway_order_id: str
    gateway_payment_id: str | None
    amount: Decimal
    currency: str
    status: PaymentStatus
    failure_reason: str | None
    refunded_amount: Decimal | None
    captured_at: datetime | None
    created_at: datetime


class PaymentOrderOut(BaseModel):
    """Everything the browser needs to open the gateway's checkout."""

    payment: PaymentOut
    gateway: str
    gateway_order_id: str
    # Smallest currency unit (paise), exactly what checkout.js expects.
    amount_minor: int
    currency: str
    # Publishable key — safe to send to the browser (the secret never is).
    key_id: str | None


class PaymentVerifyRequest(BaseModel):
    payment_id: uuid.UUID
    gateway_payment_id: str = Field(min_length=1, max_length=100)
    signature: str = Field(min_length=1, max_length=200)


class RefundRequest(BaseModel):
    # Omit for a full refund.
    amount: Decimal | None = Field(default=None, gt=0)


class RefundRequestedOut(BaseModel):
    refund_id: str
    amount_minor: int
    status: str


class PaginatedPayments(BaseModel):
    items: list[PaymentOut]
    total: int
    limit: int
    offset: int
