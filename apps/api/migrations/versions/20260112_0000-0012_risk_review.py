"""chat_messages review columns (Phase 12 high-risk query review)

Matches ``ChatMessage.reviewed_at/reviewed_by_id/review_note`` in
``app/models/chat.py``.

Revision ID: 0012_risk_review
Revises: 0011_notifications
Create Date: 2026-01-12 00:00:00
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0012_risk_review"
down_revision: str | None = "0011_notifications"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "chat_messages", sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column(
        "chat_messages",
        sa.Column(
            "reviewed_by_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey(
                "users.id", ondelete="SET NULL", name="fk_chat_messages_reviewed_by_id_users"
            ),
            nullable=True,
        ),
    )
    op.add_column("chat_messages", sa.Column("review_note", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("chat_messages", "review_note")
    op.drop_column("chat_messages", "reviewed_by_id")
    op.drop_column("chat_messages", "reviewed_at")
