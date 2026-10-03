"""Discovered legal-source catalog (dynamic sourcing upgrade).

Decouples *discovery* (finding candidate Indian legal sources) from
*ingestion* (fetching, embedding and persisting one as a ``LegalDocument``,
Phase 3). A row here is a candidate a :mod:`app.services.ingestion.discovery`
provider found; it becomes a ``LegalDocument`` only once an admin (or the
bulk-ingest script) actually ingests it — see docs/adr/0011.

This replaces the old model of hand-typing every source URL in
``official_sources.py`` (kept as the ``curated`` provider, a guaranteed
fallback) with a table that `kb:discover` can refresh at any time without a
code change, and that naturally grows to cover state-level Acts — the gap
flagged in docs/project-status.md.
"""

from __future__ import annotations

import enum
import uuid
from datetime import datetime

from sqlalchemy import Enum as SAEnum
from sqlalchemy import ForeignKey, Index, String, Text, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin
from app.models.legal_document import DocumentType


class CatalogEntryStatus(enum.StrEnum):
    NEW = "NEW"  # discovered, not yet ingested
    INGESTED = "INGESTED"  # ingest_source() ran; see ingested_document_id
    INVALID = "INVALID"  # provider or an ingest attempt flagged it unusable
    SKIPPED = "SKIPPED"  # admin chose not to ingest it


class LegalSourceCatalogEntry(TimestampMixin, Base):
    __tablename__ = "legal_source_catalog"

    id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    # Discovery provider name (app.services.ingestion.discovery), e.g.
    # "curated", "india_code_oai", "hf_dataset".
    provider: Mapped[str] = mapped_column(String(50), nullable=False)
    # Provider-specific identifier (OAI record identifier, HF row index, ...)
    # for idempotent re-discovery; not unique on its own across providers.
    external_id: Mapped[str | None] = mapped_column(String(500))
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    law_name: Mapped[str | None] = mapped_column(String(300))
    source_url: Mapped[str] = mapped_column(Text, nullable=False)
    document_type: Mapped[DocumentType] = mapped_column(
        SAEnum(DocumentType, name="legal_document_type", native_enum=True, create_type=False),
        nullable=False,
    )
    jurisdiction: Mapped[str] = mapped_column(
        String(10), nullable=False, default="IN", server_default="IN"
    )
    state_code: Mapped[str | None] = mapped_column(String(2))
    status: Mapped[CatalogEntryStatus] = mapped_column(
        SAEnum(CatalogEntryStatus, name="catalog_entry_status", native_enum=True),
        nullable=False,
        default=CatalogEntryStatus.NEW,
        server_default=CatalogEntryStatus.NEW.value,
    )
    ingested_document_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("legal_documents.id", ondelete="SET NULL")
    )
    notes: Mapped[str | None] = mapped_column(Text)
    last_seen_at: Mapped[datetime] = mapped_column(server_default=text("now()"), nullable=False)

    __table_args__ = (
        UniqueConstraint("source_url", name="uq_legal_source_catalog_source_url"),
        Index("ix_legal_source_catalog_status", "status"),
        Index("ix_legal_source_catalog_jurisdiction_state", "jurisdiction", "state_code"),
    )

    def __repr__(self) -> str:  # pragma: no cover
        return (
            f"LegalSourceCatalogEntry(id={self.id!s}, title={self.title!r}, status={self.status})"
        )
