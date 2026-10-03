"""payments (Phase 10)

Matches ``app/models/payment.py``.

Revision ID: 0010_payments
Revises: 0009_consultations
Create Date: 2026-01-10 00:00:00
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0010_payments"
down_revision: str | None = "0009_consultations"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_PAYMENT_STATUS = postgresql.ENUM(
    "CREATED", "CAPTURED", "FAILED", "REFUNDED", name="payment_status", create_type=False
)


def upgrade() -> None:
    bind = op.get_bind()
    _PAYMENT_STATUS.create(bind, checkfirst=False)

    op.create_table(
        "payments",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "consultation_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey(
                "consultations.id", ondelete="CASCADE", name="fk_payments_consultation_id_consultations"
            ),
            nullable=False,
        ),
        sa.Column("provider", sa.String(50), nullable=False),
        sa.Column("gateway_order_id", sa.String(100), nullable=False),
        sa.Column("gateway_payment_id", sa.String(100), nullable=True),
        sa.Column("amount", sa.Numeric(10, 2), nullable=False),
        sa.Column("currency", sa.String(3), nullable=False, server_default="INR"),
        sa.Column("status", _PAYMENT_STATUS, nullable=False, server_default="CREATED"),
        sa.Column("failure_reason", sa.Text(), nullable=True),
        sa.Column("refunded_amount", sa.Numeric(10, 2), nullable=True),
        sa.Column("raw_webhook_payload", postgresql.JSONB(), nullable=True),
        sa.Column("captured_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column(
            "updated_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.func.now(),
            onupdate=sa.func.now(),
        ),
    )
    op.create_index("ix_payments_consultation_id", "payments", ["consultation_id"])
    op.create_index(
        "ix_payments_gateway_order_id", "payments", ["gateway_order_id"], unique=True
    )


def downgrade() -> None:
    op.drop_index("ix_payments_gateway_order_id", table_name="payments")
    op.drop_index("ix_payments_consultation_id", table_name="payments")
    op.drop_table("payments")

    bind = op.get_bind()
    _PAYMENT_STATUS.drop(bind, checkfirst=False)
