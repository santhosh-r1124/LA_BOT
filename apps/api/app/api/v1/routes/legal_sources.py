"""Admin: ingest, list, search, re-index and remove legal knowledge-base sources.

Runs ingestion synchronously and returns the result (COMPLETED or FAILED with
``ingestion_error`` set) — fine at Phase 3 scale. A background job queue for
large/bulk sources is a Phase 11/13 concern, not needed yet.

The full admin RAG-source management UI (upload, approve, version, track
failures) is Phase 12; these endpoints are the data layer it will drive, and
are usable now via ``/docs``.
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select

from app.api.deps import DbSession, SettingsDep, require_roles
from app.core.errors import NotFoundError, ValidationAppError
from app.models.legal_document import DocumentType, IngestionStatus, LegalDocument
from app.models.legal_source_catalog import CatalogEntryStatus, LegalSourceCatalogEntry
from app.models.user import User, UserRole
from app.schemas.legal_source import (
    IngestSourceRequest,
    LegalDocumentOut,
    PaginatedLegalDocuments,
    SearchResponse,
    SearchResultOut,
)
from app.schemas.legal_source_catalog import (
    BulkIngestResult,
    CatalogEntryOut,
    DiscoverySummary,
    PaginatedCatalogEntries,
    ProviderRunResultOut,
)
from app.services.audit import record_audit
from app.services.ingestion.discovery import ingest_catalog_entry, run_discovery
from app.services.ingestion.pipeline import ingest_source, reingest_source
from app.services.ingestion.search import semantic_search

router = APIRouter()

AdminUser = Annotated[User, Depends(require_roles(UserRole.ADMIN, UserRole.LEGAL_ADMIN))]
Limit = Annotated[int, Query(ge=1, le=100)]
Offset = Annotated[int, Query(ge=0)]


async def _get_document(db: DbSession, document_id: uuid.UUID) -> LegalDocument:
    document = await db.get(LegalDocument, document_id)
    if document is None:
        raise NotFoundError("Legal source document not found.")
    return document


@router.post("", response_model=LegalDocumentOut, summary="Ingest a new legal source")
async def create_source(
    payload: IngestSourceRequest, admin: AdminUser, db: DbSession, settings: SettingsDep
) -> LegalDocumentOut:
    document = await ingest_source(
        db=db,
        settings=settings,
        title=payload.title,
        source_url=payload.source_url,
        document_type=payload.document_type,
        law_name=payload.law_name,
        jurisdiction=payload.jurisdiction,
        state_code=payload.state_code,
        effective_date=payload.effective_date,
        version=payload.version,
    )
    await record_audit(
        db,
        actor=admin,
        action="legal_source.ingested",
        target_type="legal_document",
        target_id=document.id,
        details={"source_url": payload.source_url, "status": document.ingestion_status.value},
    )
    return LegalDocumentOut.model_validate(document)


@router.get("", response_model=PaginatedLegalDocuments, summary="List legal source documents")
async def list_sources(
    _admin: AdminUser,
    db: DbSession,
    document_type: DocumentType | None = None,
    status: IngestionStatus | None = None,
    limit: Limit = 25,
    offset: Offset = 0,
) -> PaginatedLegalDocuments:
    stmt = select(LegalDocument)
    count_stmt = select(func.count()).select_from(LegalDocument)
    if document_type is not None:
        stmt = stmt.where(LegalDocument.document_type == document_type)
        count_stmt = count_stmt.where(LegalDocument.document_type == document_type)
    if status is not None:
        stmt = stmt.where(LegalDocument.ingestion_status == status)
        count_stmt = count_stmt.where(LegalDocument.ingestion_status == status)

    total = (await db.execute(count_stmt)).scalar_one()
    rows = (
        (
            await db.execute(
                stmt.order_by(LegalDocument.created_at.desc()).limit(limit).offset(offset)
            )
        )
        .scalars()
        .all()
    )
    return PaginatedLegalDocuments(
        items=[LegalDocumentOut.model_validate(d) for d in rows],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.get(
    "/search", response_model=SearchResponse, summary="Semantic search over ingested chunks"
)
async def search_sources(
    _admin: AdminUser,
    db: DbSession,
    settings: SettingsDep,
    q: Annotated[str, Query(min_length=1, max_length=500)],
    top_k: Annotated[int, Query(ge=1, le=50)] = 8,
) -> SearchResponse:
    results = await semantic_search(q, db=db, settings=settings, top_k=top_k)
    return SearchResponse(
        query=q,
        results=[
            SearchResultOut(
                chunk_id=r.chunk.id,
                document_id=r.document.id,
                document_title=r.document.title,
                section=r.chunk.section,
                article=r.chunk.article,
                page_number=r.chunk.page_number,
                content=r.chunk.content,
                distance=r.distance,
            )
            for r in results
        ],
    )


@router.post(
    "/discover", response_model=DiscoverySummary, summary="Run discovery providers into the catalog"
)
async def discover_sources(
    admin: AdminUser,
    db: DbSession,
    settings: SettingsDep,
    providers: Annotated[list[str] | None, Query()] = None,
) -> DiscoverySummary:
    results = await run_discovery(db=db, settings=settings, provider_names=providers)
    await record_audit(
        db,
        actor=admin,
        action="legal_source.discovery_run",
        target_type="legal_source_catalog",
        details={r.provider: {"discovered": r.discovered, "error": r.error} for r in results},
    )
    return DiscoverySummary(
        results=[
            ProviderRunResultOut(
                provider=r.provider, discovered=r.discovered, upserted=r.upserted, error=r.error
            )
            for r in results
        ]
    )


@router.get(
    "/catalog", response_model=PaginatedCatalogEntries, summary="List discovered catalog entries"
)
async def list_catalog(
    _admin: AdminUser,
    db: DbSession,
    status: CatalogEntryStatus | None = None,
    provider: str | None = None,
    jurisdiction: str | None = None,
    state_code: str | None = None,
    limit: Limit = 25,
    offset: Offset = 0,
) -> PaginatedCatalogEntries:
    stmt = select(LegalSourceCatalogEntry)
    count_stmt = select(func.count()).select_from(LegalSourceCatalogEntry)
    for column, value in (
        (LegalSourceCatalogEntry.status, status),
        (LegalSourceCatalogEntry.provider, provider),
        (LegalSourceCatalogEntry.jurisdiction, jurisdiction),
        (LegalSourceCatalogEntry.state_code, state_code),
    ):
        if value is not None:
            stmt = stmt.where(column == value)
            count_stmt = count_stmt.where(column == value)

    total = (await db.execute(count_stmt)).scalar_one()
    rows = (
        (
            await db.execute(
                stmt.order_by(LegalSourceCatalogEntry.last_seen_at.desc())
                .limit(limit)
                .offset(offset)
            )
        )
        .scalars()
        .all()
    )
    return PaginatedCatalogEntries(
        items=[CatalogEntryOut.model_validate(e) for e in rows],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.post(
    "/catalog/ingest-all",
    response_model=BulkIngestResult,
    summary="Ingest every NEW catalog entry matching the given filters",
)
async def ingest_catalog_bulk(
    admin: AdminUser,
    db: DbSession,
    settings: SettingsDep,
    jurisdiction: str | None = None,
    state_code: str | None = None,
    provider: str | None = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 25,
) -> BulkIngestResult:
    stmt = select(LegalSourceCatalogEntry).where(
        LegalSourceCatalogEntry.status == CatalogEntryStatus.NEW
    )
    if jurisdiction is not None:
        stmt = stmt.where(LegalSourceCatalogEntry.jurisdiction == jurisdiction)
    if state_code is not None:
        stmt = stmt.where(LegalSourceCatalogEntry.state_code == state_code)
    if provider is not None:
        stmt = stmt.where(LegalSourceCatalogEntry.provider == provider)
    entries = (await db.execute(stmt.limit(limit))).scalars().all()

    completed = 0
    for entry in entries:
        ingested = await ingest_catalog_entry(db=db, settings=settings, entry=entry)
        if ingested.status == CatalogEntryStatus.INGESTED:
            completed += 1
    await record_audit(
        db,
        actor=admin,
        action="legal_source.catalog_batch_ingested",
        target_type="legal_source_catalog",
        details={
            "attempted": len(entries),
            "completed": completed,
            "provider": provider,
            "state_code": state_code,
        },
    )
    return BulkIngestResult(
        attempted=len(entries), completed=completed, failed=len(entries) - completed
    )


@router.post(
    "/catalog/{entry_id}/ingest", response_model=CatalogEntryOut, summary="Ingest one catalog entry"
)
async def ingest_catalog_one(
    entry_id: uuid.UUID, admin: AdminUser, db: DbSession, settings: SettingsDep
) -> CatalogEntryOut:
    entry = await db.get(LegalSourceCatalogEntry, entry_id)
    if entry is None:
        raise NotFoundError("Catalog entry not found.")
    if entry.status == CatalogEntryStatus.INGESTED:
        raise ValidationAppError(
            "This catalog entry has already been ingested.", code="already_ingested"
        )
    entry = await ingest_catalog_entry(db=db, settings=settings, entry=entry)
    await record_audit(
        db,
        actor=admin,
        action="legal_source.catalog_entry_ingested",
        target_type="legal_source_catalog",
        target_id=entry.id,
        details={"source_url": entry.source_url, "status": entry.status.value},
    )
    return CatalogEntryOut.model_validate(entry)


@router.get("/{document_id}", response_model=LegalDocumentOut, summary="Get a source document")
async def get_source(document_id: uuid.UUID, _admin: AdminUser, db: DbSession) -> LegalDocumentOut:
    document = await _get_document(db, document_id)
    return LegalDocumentOut.model_validate(document)


@router.post(
    "/{document_id}/reindex",
    response_model=LegalDocumentOut,
    summary="Re-fetch and re-chunk a source",
)
async def reindex_source(
    document_id: uuid.UUID, admin: AdminUser, db: DbSession, settings: SettingsDep
) -> LegalDocumentOut:
    document = await _get_document(db, document_id)
    document = await reingest_source(db=db, settings=settings, document=document)
    await record_audit(
        db,
        actor=admin,
        action="legal_source.reindexed",
        target_type="legal_document",
        target_id=document.id,
        details={"status": document.ingestion_status.value},
    )
    return LegalDocumentOut.model_validate(document)


@router.delete("/{document_id}", status_code=204, summary="Remove an obsolete source")
async def delete_source(document_id: uuid.UUID, admin: AdminUser, db: DbSession) -> None:
    document = await _get_document(db, document_id)
    details: dict[str, object] = {"title": document.title, "source_url": document.source_url}
    await db.delete(document)
    await db.commit()
    await record_audit(
        db,
        actor=admin,
        action="legal_source.deleted",
        target_type="legal_document",
        target_id=document_id,
        details=details,
    )
