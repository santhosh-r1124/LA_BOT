"""Legal source catalog schemas (dynamic-sourcing upgrade)."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.models.legal_document import DocumentType
from app.models.legal_source_catalog import CatalogEntryStatus


class CatalogEntryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    provider: str
    title: str
    law_name: str | None
    source_url: str
    document_type: DocumentType
    jurisdiction: str
    state_code: str | None
    status: CatalogEntryStatus
    ingested_document_id: uuid.UUID | None
    notes: str | None
    last_seen_at: datetime
    created_at: datetime


class PaginatedCatalogEntries(BaseModel):
    items: list[CatalogEntryOut]
    total: int
    limit: int
    offset: int


class ProviderRunResultOut(BaseModel):
    provider: str
    discovered: int
    upserted: int
    error: str | None = None


class DiscoverySummary(BaseModel):
    results: list[ProviderRunResultOut]


class BulkIngestResult(BaseModel):
    attempted: int
    completed: int
    failed: int
