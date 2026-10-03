"""In-app notifications (Phase 11).

The durable record of every user-facing event. Email is a best-effort copy
(``app/services/email.py`` never raises); this table is what the bell icon
in both frontends reads, so an event is never lost just because an email
bounced or SMTP isn't configured.
"""

from __future__ import annotations

import enum
import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, String, Text, text
from sqlalchemy import Enum as SAEnum
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class NotificationKind(enum.StrEnum):
    CONSULTATION_REQUESTED = "CONSULTATION_REQUESTED"
    CONSULTATION_ACCEPTED = "CONSULTATION_ACCEPTED"
    CONSULTATION_DECLINED = "CONSULTATION_DECLINED"
    CONSULTATION_CANCELLED = "CONSULTATION_CANCELLED"
    CONSULTATION_COMPLETED = "CONSULTATION_COMPLETED"
    PAYMENT_RECEIVED = "PAYMENT_RECEIVED"
    PAYMENT_REFUNDED = "PAYMENT_REFUNDED"
    ADVOCATE_VERIFIED = "ADVOCATE_VERIFIED"
    ADVOCATE_REJECTED = "ADVOCATE_REJECTED"


class Notification(Base):
    __tablename__ = "notifications"

    id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    kind: Mapped[NotificationKind] = mapped_column(
        SAEnum(NotificationKind, name="notification_kind", native_enum=True), nullable=False
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    # Relative path in the recipient's app, e.g. "/consultations".
    link: Mapped[str | None] = mapped_column(String(300))
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()"), nullable=False
    )

    __table_args__ = (Index("ix_notifications_user_id_created_at", "user_id", "created_at"),)

    def __repr__(self) -> str:  # pragma: no cover
        return f"Notification(id={self.id!s}, kind={self.kind})"
