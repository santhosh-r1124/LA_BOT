"""consultations (Phase 8, FRD §9)

Matches ``app/models/consultation.py``.

Revision ID: 0009_consultations
Revises: 0008_legal_source_catalog
Create Date: 2026-01-09 00:00:00
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0009_consultations"
down_revision: str | None = "0008_legal_source_catalog"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_CONSULTATION_MODE = postgresql.ENUM(
    "VIDEO", "PHONE", "IN_PERSON", name="consultation_mode", create_type=False
)
_CONSULTATION_STATUS = postgresql.ENUM(
    "REQUESTED",
    "ACCEPTED",
    "DECLINED",
    "CANCELLED",
    "COMPLETED",
    "CLOSED",
    name="consultation_status",
    create_type=False,
)
_CONSULTATION_PAYMENT_STATUS = postgresql.ENUM(
    "UNPAID",
    "PENDING",
    "PAID",
    "REFUNDED",
    "WAIVED",
    name="consultation_payment_status",
    create_type=False,
)


def upgrade() -> None:
    bind = op.get_bind()
    _CONSULTATION_MODE.create(bind, checkfirst=False)
    _CONSULTATION_STATUS.create(bind, checkfirst=False)
    _CONSULTATION_PAYMENT_STATUS.create(bind, checkfirst=False)

    op.create_table(
        "consultations",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "consumer_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE", name="fk_consultations_consumer_id_users"),
            nullable=False,
        ),
        sa.Column(
            "advocate_profile_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey(
                "advocate_profiles.id",
                ondelete="CASCADE",
                name="fk_consultations_advocate_profile_id_advocate_profiles",
            ),
            nullable=False,
        ),
        sa.Column("practice_area", sa.String(100), nullable=False),
        sa.Column("topic", sa.String(300), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("mode", _CONSULTATION_MODE, nullable=False),
        sa.Column("status", _CONSULTATION_STATUS, nullable=False, server_default="REQUESTED"),
        sa.Column("preferred_time", sa.DateTime(timezone=True), nullable=True),
        sa.Column("scheduled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("meeting_link", sa.String(500), nullable=True),
        sa.Column("fee_amount", sa.Numeric(10, 2), nullable=True),
        sa.Column(
            "payment_status", _CONSULTATION_PAYMENT_STATUS, nullable=False, server_default="UNPAID"
        ),
        sa.Column("decline_reason", sa.Text(), nullable=True),
        sa.Column(
            "cancelled_by_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey(
                "users.id", ondelete="SET NULL", name="fk_consultations_cancelled_by_id_users"
            ),
            nullable=True,
        ),
        sa.Column("cancellation_reason", sa.Text(), nullable=True),
        sa.Column("advocate_notes", sa.Text(), nullable=True),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column(
            "updated_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.func.now(),
            onupdate=sa.func.now(),
        ),
    )
    op.create_index("ix_consultations_consumer_id", "consultations", ["consumer_id"])
    op.create_index(
        "ix_consultations_advocate_profile_id", "consultations", ["advocate_profile_id"]
    )
    op.create_index("ix_consultations_status", "consultations", ["status"])


def downgrade() -> None:
    op.drop_index("ix_consultations_status", table_name="consultations")
    op.drop_index("ix_consultations_advocate_profile_id", table_name="consultations")
    op.drop_index("ix_consultations_consumer_id", table_name="consultations")
    op.drop_table("consultations")

    bind = op.get_bind()
    _CONSULTATION_PAYMENT_STATUS.drop(bind, checkfirst=False)
    _CONSULTATION_STATUS.drop(bind, checkfirst=False)
    _CONSULTATION_MODE.drop(bind, checkfirst=False)
