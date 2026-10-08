"""Admin: user management + advocate verification queue (Phase 1 slice).

The full Admin & Legal Ops dashboard (UI, reporting, RAG source management,
query review, etc.) is Phase 12. These endpoints exist now so RBAC and the
advocate verification workflow are real from Phase 1 — exercise them via
``/docs`` until Phase 12 ships a UI.
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, UploadFile
from sqlalchemy import func, select

from app.api.deps import DbSession, require_roles
from app.core.errors import NotFoundError, ValidationAppError
from app.models.user import AdvocateProfile, User, UserRole, VerificationStatus
from app.schemas.admin import (
    AdvocateImportReport,
    ImportRowError,
    PaginatedAdvocateProfiles,
    PaginatedUsers,
    UserActiveUpdateRequest,
)
from app.schemas.advocate import AdvocateProfileOut, AdvocateRejectRequest, AdvocateVerifyRequest
from app.schemas.user import UserOut
from app.services import advocate_import

router = APIRouter()

AdminUser = Annotated[User, Depends(require_roles(UserRole.ADMIN, UserRole.LEGAL_ADMIN))]
Limit = Annotated[int, Query(ge=1, le=100)]
Offset = Annotated[int, Query(ge=0)]


@router.get("/users", response_model=PaginatedUsers, summary="List users")
async def list_users(
    _admin: AdminUser,
    db: DbSession,
    role: UserRole | None = None,
    limit: Limit = 25,
    offset: Offset = 0,
) -> PaginatedUsers:
    stmt = select(User)
    count_stmt = select(func.count()).select_from(User)
    if role is not None:
        stmt = stmt.where(User.role == role)
        count_stmt = count_stmt.where(User.role == role)

    total = (await db.execute(count_stmt)).scalar_one()
    rows = (
        (await db.execute(stmt.order_by(User.created_at.desc()).limit(limit).offset(offset)))
        .scalars()
        .all()
    )
    return PaginatedUsers(
        items=[UserOut.model_validate(u) for u in rows], total=total, limit=limit, offset=offset
    )


@router.patch("/users/{user_id}", response_model=UserOut, summary="Activate or suspend a user")
async def set_user_active(
    user_id: uuid.UUID, payload: UserActiveUpdateRequest, _admin: AdminUser, db: DbSession
) -> UserOut:
    user = await db.get(User, user_id)
    if user is None:
        raise NotFoundError("User not found.")
    user.is_active = payload.is_active
    await db.commit()
    await db.refresh(user)
    return UserOut.model_validate(user)


@router.get(
    "/advocates/pending",
    response_model=PaginatedAdvocateProfiles,
    summary="List advocates awaiting verification",
)
async def list_pending_advocates(
    _admin: AdminUser, db: DbSession, limit: Limit = 25, offset: Offset = 0
) -> PaginatedAdvocateProfiles:
    statuses = (VerificationStatus.PENDING, VerificationStatus.IN_REVIEW)
    stmt = select(AdvocateProfile).where(AdvocateProfile.verification_status.in_(statuses))
    count_stmt = (
        select(func.count())
        .select_from(AdvocateProfile)
        .where(AdvocateProfile.verification_status.in_(statuses))
    )

    total = (await db.execute(count_stmt)).scalar_one()
    rows = (
        (
            await db.execute(
                stmt.order_by(AdvocateProfile.created_at.asc()).limit(limit).offset(offset)
            )
        )
        .scalars()
        .all()
    )
    return PaginatedAdvocateProfiles(
        items=[AdvocateProfileOut.model_validate(p) for p in rows],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.post(
    "/advocates/{profile_id}/verify",
    response_model=AdvocateProfileOut,
    summary="Approve an advocate",
)
async def verify_advocate(
    profile_id: uuid.UUID, payload: AdvocateVerifyRequest, _admin: AdminUser, db: DbSession
) -> AdvocateProfileOut:
    profile = await db.get(AdvocateProfile, profile_id)
    if profile is None:
        raise NotFoundError("Advocate profile not found.")
    profile.verification_status = VerificationStatus.VERIFIED
    profile.verification_note = payload.note
    await db.commit()
    await db.refresh(profile)
    return AdvocateProfileOut.model_validate(profile)


@router.post(
    "/advocates/{profile_id}/reject",
    response_model=AdvocateProfileOut,
    summary="Reject an advocate",
)
async def reject_advocate(
    profile_id: uuid.UUID, payload: AdvocateRejectRequest, _admin: AdminUser, db: DbSession
) -> AdvocateProfileOut:
    profile = await db.get(AdvocateProfile, profile_id)
    if profile is None:
        raise NotFoundError("Advocate profile not found.")
    profile.verification_status = VerificationStatus.REJECTED
    profile.verification_note = payload.note
    await db.commit()
    await db.refresh(profile)
    return AdvocateProfileOut.model_validate(profile)


_MAX_IMPORT_BYTES = 5 * 1024 * 1024


@router.post(
    "/advocates/import",
    response_model=AdvocateImportReport,
    summary="Import advocates from a CSV file (add or update, never delete)",
)
async def import_advocates(
    file: UploadFile, _admin: AdminUser, db: DbSession, dry_run: bool = False
) -> AdvocateImportReport:
    raw = await file.read(_MAX_IMPORT_BYTES + 1)
    if len(raw) > _MAX_IMPORT_BYTES:
        raise ValidationAppError("The file is larger than 5 MB.", code="file_too_large")
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        try:
            text = raw.decode("cp1252")  # Excel's "CSV" on Windows
        except UnicodeDecodeError as exc:
            raise ValidationAppError("Save the file as CSV (UTF-8).", code="bad_csv") from exc
    # A savepoint lets a dry run undo exactly the import's writes.
    savepoint = await db.begin_nested()
    try:
        report = await advocate_import.import_csv_text(db, text)
    except advocate_import.CsvFormatError as exc:
        await savepoint.rollback()
        raise ValidationAppError(str(exc), code="bad_csv") from exc
    if dry_run:
        await savepoint.rollback()
    else:
        await savepoint.commit()
        await db.commit()
    return AdvocateImportReport(
        total_rows=report.total_rows,
        created=report.created,
        updated=report.updated,
        unchanged=report.unchanged,
        failed=report.failed,
        dry_run=dry_run,
        errors=[ImportRowError(line=e.line, message=e.message) for e in report.errors[:200]],
    )
