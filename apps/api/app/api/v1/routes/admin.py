"""Admin & legal-ops API: users, advocate verification, platform overview,
and the high-risk query review queue (Phases 1 and 12). The UI lives at
``/admin`` in apps/web; knowledge-base and payment admin endpoints are in
``legal_sources.py`` and ``payments.py``.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy import Select, case, func, select
from sqlalchemy.orm import selectinload

from app.api.deps import DbSession, require_roles
from app.core.errors import NotFoundError, ValidationAppError
from app.models.chat import ChatMessage, Conversation, MessageRole
from app.models.consultation import Consultation
from app.models.legal_document import LegalDocument
from app.models.legal_source_catalog import LegalSourceCatalogEntry
from app.models.notification import NotificationKind
from app.models.payment import Payment
from app.models.user import AdvocateProfile, User, UserRole, VerificationStatus
from app.schemas.admin import (
    AdminAdvocateOut,
    AdminOverview,
    PaginatedAdminAdvocates,
    PaginatedRiskReview,
    PaginatedUsers,
    RiskReviewItem,
    RiskReviewRequest,
    UserActiveUpdateRequest,
)
from app.schemas.advocate import AdvocateProfileOut, AdvocateRejectRequest, AdvocateVerifyRequest
from app.schemas.user import UserOut
from app.services.notifications import notify

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
    if user.id == _admin.id and not payload.is_active:
        raise ValidationAppError("You can't suspend your own account.", code="cannot_suspend_self")
    user.is_active = payload.is_active
    await db.commit()
    await db.refresh(user)
    return UserOut.model_validate(user)


@router.get(
    "/advocates/pending",
    response_model=PaginatedAdminAdvocates,
    summary="List advocates awaiting verification",
)
async def list_pending_advocates(
    _admin: AdminUser, db: DbSession, limit: Limit = 25, offset: Offset = 0
) -> PaginatedAdminAdvocates:
    statuses = (VerificationStatus.PENDING, VerificationStatus.IN_REVIEW)
    stmt = (
        select(AdvocateProfile)
        .options(selectinload(AdvocateProfile.user))
        .where(AdvocateProfile.verification_status.in_(statuses))
    )
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
    return PaginatedAdminAdvocates(
        items=[
            AdminAdvocateOut(
                **AdvocateProfileOut.model_validate(p).model_dump(),
                email=p.user.email,
                display_name=p.user.display_name,
            )
            for p in rows
        ],
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
    advocate = await db.get(User, profile.user_id)
    if advocate is not None:
        await notify(
            db,
            user_id=advocate.id,
            email=advocate.email,
            kind=NotificationKind.ADVOCATE_VERIFIED,
            title="Your advocate profile is verified",
            body=(
                "Your profile is now listed in the public directory and can receive "
                "consultation requests."
            ),
            link="/",
        )
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
    advocate = await db.get(User, profile.user_id)
    if advocate is not None:
        await notify(
            db,
            user_id=advocate.id,
            email=advocate.email,
            kind=NotificationKind.ADVOCATE_REJECTED,
            title="Your advocate profile was not approved",
            body=f"Reviewer note: {payload.note}" if payload.note else "See your profile page.",
            link="/profile",
        )
    return AdvocateProfileOut.model_validate(profile)


# ---------------------------------------------------------------------------
# Overview (Phase 12)
# ---------------------------------------------------------------------------

_HIGH_RISK = ("HIGH", "CRITICAL")


async def _counts_by[K](db: DbSession, stmt: Select[tuple[K, int]]) -> dict[str, int]:
    return {str(getattr(key, "value", key)): count for key, count in (await db.execute(stmt)).all()}


@router.get("/overview", response_model=AdminOverview, summary="Platform overview counts")
async def overview(_admin: AdminUser, db: DbSession) -> AdminOverview:
    pending_advocates = (
        await db.execute(
            select(func.count())
            .select_from(AdvocateProfile)
            .where(
                AdvocateProfile.verification_status.in_(
                    (VerificationStatus.PENDING, VerificationStatus.IN_REVIEW)
                )
            )
        )
    ).scalar_one()
    risk_pending = (
        await db.execute(
            select(func.count())
            .select_from(ChatMessage)
            .where(ChatMessage.risk_level.in_(_HIGH_RISK), ChatMessage.reviewed_at.is_(None))
        )
    ).scalar_one()
    return AdminOverview(
        users_by_role=await _counts_by(db, select(User.role, func.count()).group_by(User.role)),
        advocates_awaiting_verification=pending_advocates,
        consultations_by_status=await _counts_by(
            db, select(Consultation.status, func.count()).group_by(Consultation.status)
        ),
        payments_by_status=await _counts_by(
            db, select(Payment.status, func.count()).group_by(Payment.status)
        ),
        legal_documents_by_status=await _counts_by(
            db,
            select(LegalDocument.ingestion_status, func.count()).group_by(
                LegalDocument.ingestion_status
            ),
        ),
        catalog_by_status=await _counts_by(
            db,
            select(LegalSourceCatalogEntry.status, func.count()).group_by(
                LegalSourceCatalogEntry.status
            ),
        ),
        risk_review_pending=risk_pending,
    )


# ---------------------------------------------------------------------------
# High-risk query review (Phase 12, FRD §13)
# ---------------------------------------------------------------------------


@router.get(
    "/risk-review", response_model=PaginatedRiskReview, summary="High-risk queries to review"
)
async def list_risk_review(
    _admin: AdminUser,
    db: DbSession,
    reviewed: bool = False,
    risk_level: Annotated[str | None, Query(pattern="^(HIGH|CRITICAL)$")] = None,
    limit: Limit = 25,
    offset: Offset = 0,
) -> PaginatedRiskReview:
    conditions = [
        ChatMessage.role == MessageRole.USER,
        ChatMessage.risk_level.in_((risk_level,) if risk_level else _HIGH_RISK),
        ChatMessage.reviewed_at.is_not(None) if reviewed else ChatMessage.reviewed_at.is_(None),
    ]
    total = (
        await db.execute(select(func.count()).select_from(ChatMessage).where(*conditions))
    ).scalar_one()
    rows = (
        await db.execute(
            select(ChatMessage, Conversation.user_id)
            .join(Conversation, Conversation.id == ChatMessage.conversation_id)
            .where(*conditions)
            # CRITICAL first, then oldest first — the queue is worked in order.
            .order_by(
                case((ChatMessage.risk_level == "CRITICAL", 0), else_=1),
                ChatMessage.created_at.asc(),
            )
            .limit(limit)
            .offset(offset)
        )
    ).all()

    items: list[RiskReviewItem] = []
    for message, owner_id in rows:
        reply = await db.scalar(
            select(ChatMessage.content)
            .where(
                ChatMessage.conversation_id == message.conversation_id,
                ChatMessage.role == MessageRole.ASSISTANT,
                ChatMessage.created_at >= message.created_at,
            )
            .order_by(ChatMessage.created_at.asc())
            .limit(1)
        )
        items.append(
            RiskReviewItem(
                id=message.id,
                conversation_id=message.conversation_id,
                content=message.content,
                legal_category=message.legal_category,
                jurisdiction_scope=message.jurisdiction_scope,
                risk_level=message.risk_level,
                is_anonymous=owner_id is None,
                assistant_reply=reply,
                created_at=message.created_at,
                reviewed_at=message.reviewed_at,
                review_note=message.review_note,
            )
        )
    return PaginatedRiskReview(items=items, total=total, limit=limit, offset=offset)


@router.post(
    "/risk-review/{message_id}/review",
    response_model=RiskReviewItem,
    summary="Mark a high-risk query as reviewed",
)
async def mark_risk_reviewed(
    message_id: uuid.UUID, payload: RiskReviewRequest, admin: AdminUser, db: DbSession
) -> RiskReviewItem:
    message = await db.get(ChatMessage, message_id)
    if message is None or message.risk_level not in _HIGH_RISK:
        raise NotFoundError("High-risk message not found.")
    message.reviewed_at = datetime.now(UTC)
    message.reviewed_by_id = admin.id
    message.review_note = payload.note
    await db.commit()
    conversation = await db.get(Conversation, message.conversation_id)
    return RiskReviewItem(
        id=message.id,
        conversation_id=message.conversation_id,
        content=message.content,
        legal_category=message.legal_category,
        jurisdiction_scope=message.jurisdiction_scope,
        risk_level=message.risk_level,
        is_anonymous=conversation is None or conversation.user_id is None,
        assistant_reply=None,
        created_at=message.created_at,
        reviewed_at=message.reviewed_at,
        review_note=message.review_note,
    )
