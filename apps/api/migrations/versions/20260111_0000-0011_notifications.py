"""notifications (Phase 11)

Matches ``app/models/notification.py``.

Revision ID: 0011_notifications
Revises: 0010_payments
Create Date: 2026-01-11 00:00:00
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0011_notifications"
down_revision: str | None = "0010_payments"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_NOTIFICATION_KIND = postgresql.ENUM(
    "CONSULTATION_REQUESTED",
    "CONSULTATION_ACCEPTED",
    "CONSULTATION_DECLINED",
    "CONSULTATION_CANCELLED",
    "CONSULTATION_COMPLETED",
    "PAYMENT_RECEIVED",
    "PAYMENT_REFUNDED",
    "ADVOCATE_VERIFIED",
    "ADVOCATE_REJECTED",
    name="notification_kind",
    create_type=False,
)


def upgrade() -> None:
    bind = op.get_bind()
    _NOTIFICATION_KIND.create(bind, checkfirst=False)

    op.create_table(
        "notifications",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE", name="fk_notifications_user_id_users"),
            nullable=False,
        ),
        sa.Column("kind", _NOTIFICATION_KIND, nullable=False),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("link", sa.String(300), nullable=True),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index(
        "ix_notifications_user_id_created_at", "notifications", ["user_id", "created_at"]
    )


def downgrade() -> None:
    op.drop_index("ix_notifications_user_id_created_at", table_name="notifications")
    op.drop_table("notifications")

    bind = op.get_bind()
    _NOTIFICATION_KIND.drop(bind, checkfirst=False)
