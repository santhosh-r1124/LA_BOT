"""Legal-dataset metadata, optional embeddings, sample advocates, search indexes

* ``legal_documents``: ``source_dataset`` + ``external_id`` (unique together)
  identify a row ingested from a dataset such as a Hugging Face dataset, so
  re-running ingestion never duplicates it; ``doc_metadata`` keeps the
  dataset's own fields (case name, court, date, citation...) as given.
* ``legal_chunks.embedding`` becomes nullable: text can be indexed for
  keyword search before (or without) an embedding provider being configured.
* ``advocate_profiles.is_sample`` marks synthetic demo listings, plus indexes
  for the directory's state / practice-area / language filters.

Revision ID: 0009_datasets_and_samples
Revises: 0008_advocate_contact
Create Date: 2026-01-09 00:00:00
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from pgvector.sqlalchemy import Vector
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "0009_datasets_and_samples"
down_revision: str | None = "0008_advocate_contact"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("legal_documents", sa.Column("source_dataset", sa.String(200), nullable=True))
    op.add_column("legal_documents", sa.Column("external_id", sa.String(200), nullable=True))
    op.add_column("legal_documents", sa.Column("doc_metadata", JSONB, nullable=True))
    op.create_index(
        "ux_legal_documents_dataset_row",
        "legal_documents",
        ["source_dataset", "external_id"],
        unique=True,
    )
    op.alter_column("legal_chunks", "embedding", existing_type=Vector(768), nullable=True)

    op.add_column(
        "advocate_profiles",
        sa.Column("is_sample", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.create_index("ix_advocate_profiles_state_code", "advocate_profiles", ["state_code"])
    op.create_index(
        "ix_advocate_profiles_practice_areas",
        "advocate_profiles",
        ["practice_areas"],
        postgresql_using="gin",
    )
    op.create_index(
        "ix_advocate_profiles_languages", "advocate_profiles", ["languages"], postgresql_using="gin"
    )


def downgrade() -> None:
    op.drop_index("ix_advocate_profiles_languages", table_name="advocate_profiles")
    op.drop_index("ix_advocate_profiles_practice_areas", table_name="advocate_profiles")
    op.drop_index("ix_advocate_profiles_state_code", table_name="advocate_profiles")
    op.drop_column("advocate_profiles", "is_sample")
    op.execute("DELETE FROM legal_chunks WHERE embedding IS NULL")
    op.alter_column("legal_chunks", "embedding", existing_type=Vector(768), nullable=False)
    op.drop_index("ux_legal_documents_dataset_row", table_name="legal_documents")
    op.drop_column("legal_documents", "doc_metadata")
    op.drop_column("legal_documents", "external_id")
    op.drop_column("legal_documents", "source_dataset")
