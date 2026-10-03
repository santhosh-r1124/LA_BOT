"""Consultation payments (Phase 10).

One ``Payment`` row per payment attempt against a ``Consultation`` — a
retried/failed-then-retried payment gets a new row rather than overwriting
the failed one, so the attempt history is never lost (an admin reviewing a
disputed charge needs to see the failed attempts too). ``Consultation.
payment_status`` (app/models/consultation.py) is the summary the rest of the
app reads; this table is the detailed, gateway-facing record it's kept in
sync with by ``app/services/payments/service.py``.
"""

from __future__ import annotations

import enum
import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import DateTime, ForeignKey, Index, Numeric, String, Text, text
from sqlalchemy import Enum as SAEnum
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin


class PaymentStatus(enum.StrEnum):
    CREATED = "CREATED"  # gateway order created, checkout not completed yet
    CAPTURED = "CAPTURED"  # payment succeeded and funds captured
    FAILED = "FAILED"
    REFUNDED = "REFUNDED"


class Payment(TimestampMixin, Base):
    __tablename__ = "payments"

    id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    consultation_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("consultations.id", ondelete="CASCADE"), nullable=False
    )
    # Gateway name, e.g. "razorpay" — app/services/payments/base.py.
    provider: Mapped[str] = mapped_column(String(50), nullable=False)
    gateway_order_id: Mapped[str] = mapped_column(String(100), nullable=False)
    gateway_payment_id: Mapped[str | None] = mapped_column(String(100))
    amount: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="INR")
    status: Mapped[PaymentStatus] = mapped_column(
        SAEnum(PaymentStatus, name="payment_status", native_enum=True),
        nullable=False,
        default=PaymentStatus.CREATED,
        server_default=PaymentStatus.CREATED.value,
    )
    failure_reason: Mapped[str | None] = mapped_column(Text)
    refunded_amount: Mapped[Decimal | None] = mapped_column(Numeric(10, 2))
    # Last webhook payload received for this payment — audit trail, admin-only.
    raw_webhook_payload: Mapped[dict[str, object] | None] = mapped_column(JSONB)
    captured_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    __table_args__ = (
        Index("ix_payments_consultation_id", "consultation_id"),
        Index("ix_payments_gateway_order_id", "gateway_order_id", unique=True),
    )

    def __repr__(self) -> str:  # pragma: no cover
        return f"Payment(id={self.id!s}, status={self.status})"
