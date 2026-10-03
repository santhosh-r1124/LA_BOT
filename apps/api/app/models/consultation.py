"""On-demand consultation booking (Phase 8, FRD §9).

Lifecycle: ``REQUESTED`` (consumer books) -> ``ACCEPTED`` (advocate confirms a
time) | ``DECLINED`` -> ``COMPLETED`` (advocate marks the session done) ->
``CLOSED`` (advocate closes the matter); either party may ``CANCELLED`` a
still-active (``REQUESTED``/``ACCEPTED``) booking. Valid transitions are
pure functions in ``app.services.consultation_lifecycle``, kept separate
from this model the same way Phase 5 split `risk_engine.py` out — see
docs/adr/0008.

Payment is tracked here as a status/snapshot only; ``Payment`` (Phase 10) is
the source of truth and keeps ``payment_status`` in sync via its webhook
handler, the same "status lives on the row, decision logic lives elsewhere"
split.
"""

from __future__ import annotations

import enum
import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import DateTime, ForeignKey, Index, Numeric, String, Text, text
from sqlalchemy import Enum as SAEnum
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin
from app.models.user import AdvocateProfile, User


class ConsultationMode(enum.StrEnum):
    VIDEO = "VIDEO"
    PHONE = "PHONE"
    IN_PERSON = "IN_PERSON"


class ConsultationStatus(enum.StrEnum):
    REQUESTED = "REQUESTED"
    ACCEPTED = "ACCEPTED"
    DECLINED = "DECLINED"
    CANCELLED = "CANCELLED"
    COMPLETED = "COMPLETED"
    CLOSED = "CLOSED"


class ConsultationPaymentStatus(enum.StrEnum):
    UNPAID = "UNPAID"
    PENDING = "PENDING"
    PAID = "PAID"
    REFUNDED = "REFUNDED"
    WAIVED = "WAIVED"


class Consultation(TimestampMixin, Base):
    __tablename__ = "consultations"

    id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    consumer_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    advocate_profile_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("advocate_profiles.id", ondelete="CASCADE"), nullable=False
    )
    practice_area: Mapped[str] = mapped_column(String(100), nullable=False)
    topic: Mapped[str] = mapped_column(String(300), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    mode: Mapped[ConsultationMode] = mapped_column(
        SAEnum(ConsultationMode, name="consultation_mode", native_enum=True), nullable=False
    )
    status: Mapped[ConsultationStatus] = mapped_column(
        SAEnum(ConsultationStatus, name="consultation_status", native_enum=True),
        nullable=False,
        default=ConsultationStatus.REQUESTED,
        server_default=ConsultationStatus.REQUESTED.value,
    )
    # The consumer's preferred slot — a request, not a confirmation.
    preferred_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Set when the advocate accepts; the confirmed time.
    scheduled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Advocate-provided join link (external video/call tool) or address for
    # IN_PERSON — there is no built-in WebRTC (roadmap: video/voice
    # consultation is a separate, not-yet-built feature).
    meeting_link: Mapped[str | None] = mapped_column(String(500))
    # Snapshot of AdvocateProfile.consultation_fee at request time — the
    # advocate's listed fee may change later; a booked consultation shouldn't.
    fee_amount: Mapped[Decimal | None] = mapped_column(Numeric(10, 2))
    payment_status: Mapped[ConsultationPaymentStatus] = mapped_column(
        SAEnum(ConsultationPaymentStatus, name="consultation_payment_status", native_enum=True),
        nullable=False,
        default=ConsultationPaymentStatus.UNPAID,
        server_default=ConsultationPaymentStatus.UNPAID.value,
    )
    decline_reason: Mapped[str | None] = mapped_column(Text)
    cancelled_by_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    cancellation_reason: Mapped[str | None] = mapped_column(Text)
    # Private to the advocate/admin — never returned to the consumer.
    advocate_notes: Mapped[str | None] = mapped_column(Text)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    consumer: Mapped[User] = relationship(foreign_keys=[consumer_id])
    advocate_profile: Mapped[AdvocateProfile] = relationship()

    __table_args__ = (
        Index("ix_consultations_consumer_id", "consumer_id"),
        Index("ix_consultations_advocate_profile_id", "advocate_profile_id"),
        Index("ix_consultations_status", "status"),
    )

    def __repr__(self) -> str:  # pragma: no cover
        return f"Consultation(id={self.id!s}, status={self.status})"
