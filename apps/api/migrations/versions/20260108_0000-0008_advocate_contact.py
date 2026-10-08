"""advocate_profiles: phone + external_id (CSV directory import)

``external_id`` is the identifier a bulk-imported row carries in its source
file (e.g. ``ADV100001``); re-importing a file matches on it, so updates don't
create duplicates. Matches ``app/models/user.py::AdvocateProfile``.

Revision ID: 0008_advocate_contact
Revises: 0007_document_requests
Create Date: 2026-01-08 00:00:00
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0008_advocate_contact"
down_revision: str | None = "0007_document_requests"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("advocate_profiles", sa.Column("phone", sa.String(32), nullable=True))
    op.add_column("advocate_profiles", sa.Column("external_id", sa.String(64), nullable=True))
    op.create_index(
        "ix_advocate_profiles_external_id", "advocate_profiles", ["external_id"], unique=True
    )


def downgrade() -> None:
    op.drop_index("ix_advocate_profiles_external_id", table_name="advocate_profiles")
    op.drop_column("advocate_profiles", "external_id")
    op.drop_column("advocate_profiles", "phone")
