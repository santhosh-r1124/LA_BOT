"""legal_source_catalog (dynamic sourcing upgrade)

Matches ``app/models/legal_source_catalog.py``. Decouples discovery (finding
candidate sources) from ingestion (fetching/embedding/persisting one as a
``legal_documents`` row, migration 0004).

Revision ID: 0008_legal_source_catalog
Revises: 0007_document_requests
Create Date: 2026-01-08 00:00:00
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0008_legal_source_catalog"
down_revision: str | None = "0007_document_requests"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_CATALOG_ENTRY_STATUS = postgresql.ENUM(
    "NEW", "INGESTED", "INVALID", "SKIPPED", name="catalog_entry_status", create_type=False
)


def upgrade() -> None:
    bind = op.get_bind()
    _CATALOG_ENTRY_STATUS.create(bind, checkfirst=False)

    op.create_table(
        "legal_source_catalog",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("provider", sa.String(50), nullable=False),
        sa.Column("external_id", sa.String(500), nullable=True),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("law_name", sa.String(300), nullable=True),
        sa.Column("source_url", sa.Text(), nullable=False),
        # Reuses the enum type created by migration 0004 (legal_document_type).
        sa.Column(
            "document_type",
            postgresql.ENUM(
                "ACT",
                "RULES",
                "REGULATION",
                "NOTIFICATION",
                "JUDGMENT",
                "OTHER",
                name="legal_document_type",
                create_type=False,
            ),
            nullable=False,
        ),
        sa.Column("jurisdiction", sa.String(10), nullable=False, server_default="IN"),
        sa.Column("state_code", sa.String(2), nullable=True),
        sa.Column("status", _CATALOG_ENTRY_STATUS, nullable=False, server_default="NEW"),
        sa.Column(
            "ingested_document_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey(
                "legal_documents.id",
                ondelete="SET NULL",
                name="fk_legal_source_catalog_ingested_document_id_legal_documents",
            ),
            nullable=True,
        ),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("last_seen_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column(
            "updated_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.func.now(),
            onupdate=sa.func.now(),
        ),
        sa.UniqueConstraint("source_url", name="uq_legal_source_catalog_source_url"),
    )
    op.create_index(
        "ix_legal_source_catalog_status", "legal_source_catalog", ["status"]
    )
    op.create_index(
        "ix_legal_source_catalog_jurisdiction_state",
        "legal_source_catalog",
        ["jurisdiction", "state_code"],
    )


def downgrade() -> None:
    op.drop_index("ix_legal_source_catalog_jurisdiction_state", table_name="legal_source_catalog")
    op.drop_index("ix_legal_source_catalog_status", table_name="legal_source_catalog")
    op.drop_table("legal_source_catalog")

    bind = op.get_bind()
    _CATALOG_ENTRY_STATUS.drop(bind, checkfirst=False)
