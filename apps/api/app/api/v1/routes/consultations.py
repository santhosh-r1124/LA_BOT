"""Consultation booking (Phase 8, FRD §9).

REQUESTED -> ACCEPTED/DECLINED -> COMPLETED -> CLOSED, or CANCELLED from an
active state. Transition rules live in ``app.services.consultation_lifecycle``
— handlers just load the row, check the rule, mutate, and persist. Both
parties get an email through the same ``EmailSender`` Phase 1 already uses
(``ConsoleEmailSender`` today; Phase 11 swaps the implementation, not the
call sites).

After every mutation the row is re-fetched with its relationships via
``_get_with_parties`` rather than ``db.refresh()``-ing the mutated instance —
simpler than reasoning about which relationships survive commit-time
expiry under the async driver, at the cost of one extra round trip.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Query, status
from sqlalchemy import func, select
from sqlalchemy.orm import selectinload

from app.api.deps import CurrentUser, DbSession
from app.core.errors import ForbiddenError, NotFoundError, ValidationAppError
from app.models.consultation import Consultation, ConsultationStatus
from app.models.user import AdvocateProfile, User, UserRole, VerificationStatus
from app.schemas.consultation import (
    ConsultationAcceptRequest,
    ConsultationCancelRequest,
    ConsultationCompleteRequest,
    ConsultationCreateRequest,
    ConsultationDeclineRequest,
    ConsultationOut,
    PaginatedConsultations,
)
from app.services import consultation_lifecycle as lifecycle
from app.services.email import send_consultation_notification

router = APIRouter()

Limit = Annotated[int, Query(ge=1, le=100)]
Offset = Annotated[int, Query(ge=0)]

_WITH_PARTIES = (
    selectinload(Consultation.consumer),
    selectinload(Consultation.advocate_profile).selectinload(AdvocateProfile.user),
)


async def _get_with_parties(db: DbSession, consultation_id: uuid.UUID) -> Consultation:
    consultation = await db.scalar(
        select(Consultation).options(*_WITH_PARTIES).where(Consultation.id == consultation_id)
    )
    if consultation is None:
        raise NotFoundError("Consultation not found.")
    return consultation


def _is_advocate_party(consultation: Consultation, user: User) -> bool:
    return consultation.advocate_profile.user_id == user.id


def _is_consumer_party(consultation: Consultation, user: User) -> bool:
    return consultation.consumer_id == user.id


def _require_party(consultation: Consultation, user: User) -> None:
    if user.role in (UserRole.ADMIN, UserRole.LEGAL_ADMIN):
        return
    if _is_consumer_party(consultation, user) or _is_advocate_party(consultation, user):
        return
    raise ForbiddenError("This consultation belongs to another account.")


def _to_out(consultation: Consultation, *, viewer: User) -> ConsultationOut:
    is_advocate_side = viewer.role in (UserRole.ADMIN, UserRole.LEGAL_ADMIN) or _is_advocate_party(
        consultation, viewer
    )
    return ConsultationOut(
        id=consultation.id,
        consumer_id=consultation.consumer_id,
        consumer_display_name=consultation.consumer.display_name,
        advocate_profile_id=consultation.advocate_profile_id,
        advocate_display_name=consultation.advocate_profile.user.display_name,
        practice_area=consultation.practice_area,
        topic=consultation.topic,
        description=consultation.description,
        mode=consultation.mode,
        status=consultation.status,
        preferred_time=consultation.preferred_time,
        scheduled_at=consultation.scheduled_at,
        meeting_link=consultation.meeting_link,
        fee_amount=consultation.fee_amount,
        payment_status=consultation.payment_status,
        decline_reason=consultation.decline_reason,
        cancellation_reason=consultation.cancellation_reason,
        advocate_notes=consultation.advocate_notes if is_advocate_side else None,
        closed_at=consultation.closed_at,
        created_at=consultation.created_at,
        updated_at=consultation.updated_at,
    )


@router.post(
    "",
    response_model=ConsultationOut,
    status_code=status.HTTP_201_CREATED,
    summary="Book a consultation",
)
async def create_consultation(
    payload: ConsultationCreateRequest, user: CurrentUser, db: DbSession
) -> ConsultationOut:
    if user.role not in (UserRole.CONSUMER, UserRole.ENTERPRISE_USER):
        raise ForbiddenError("Only consumer accounts can book a consultation.")

    advocate_profile = await db.scalar(
        select(AdvocateProfile)
        .options(selectinload(AdvocateProfile.user))
        .where(
            AdvocateProfile.id == payload.advocate_profile_id,
            AdvocateProfile.verification_status == VerificationStatus.VERIFIED,
        )
    )
    if advocate_profile is None:
        raise NotFoundError("Advocate not found.")
    if advocate_profile.user_id == user.id:
        raise ValidationAppError("You cannot book a consultation with yourself.")

    consultation = Consultation(
        consumer_id=user.id,
        advocate_profile_id=advocate_profile.id,
        practice_area=payload.practice_area,
        topic=payload.topic,
        description=payload.description,
        mode=payload.mode,
        preferred_time=payload.preferred_time,
        fee_amount=advocate_profile.consultation_fee,
    )
    db.add(consultation)
    await db.commit()
    consultation = await _get_with_parties(db, consultation.id)

    if advocate_profile.user.email:
        await send_consultation_notification(
            to=advocate_profile.user.email,
            subject="New consultation request — Legal Advisor",
            body=(
                f"{user.display_name or user.email} requested a {payload.mode.value.lower()} "
                f"consultation on {payload.practice_area}: {payload.topic}. "
                "Sign in to the advocate portal to accept or decline."
            ),
        )
    return _to_out(consultation, viewer=user)


@router.get("", response_model=PaginatedConsultations, summary="List your consultations")
async def list_consultations(
    user: CurrentUser,
    db: DbSession,
    status_filter: Annotated[ConsultationStatus | None, Query(alias="status")] = None,
    limit: Limit = 25,
    offset: Offset = 0,
) -> PaginatedConsultations:
    if user.role == UserRole.ADVOCATE:
        advocate_profile = await db.scalar(
            select(AdvocateProfile).where(AdvocateProfile.user_id == user.id)
        )
        if advocate_profile is None:
            return PaginatedConsultations(items=[], total=0, limit=limit, offset=offset)
        conditions = [Consultation.advocate_profile_id == advocate_profile.id]
    else:
        conditions = [Consultation.consumer_id == user.id]
    if status_filter is not None:
        conditions.append(Consultation.status == status_filter)

    count_stmt = select(func.count()).select_from(Consultation).where(*conditions)
    total = (await db.execute(count_stmt)).scalar_one()

    stmt = (
        select(Consultation)
        .options(*_WITH_PARTIES)
        .where(*conditions)
        .order_by(Consultation.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    rows = (await db.execute(stmt)).scalars().all()
    return PaginatedConsultations(
        items=[_to_out(c, viewer=user) for c in rows], total=total, limit=limit, offset=offset
    )


@router.get("/{consultation_id}", response_model=ConsultationOut, summary="Get a consultation")
async def get_consultation(
    consultation_id: uuid.UUID, user: CurrentUser, db: DbSession
) -> ConsultationOut:
    consultation = await _get_with_parties(db, consultation_id)
    _require_party(consultation, user)
    return _to_out(consultation, viewer=user)


@router.post(
    "/{consultation_id}/accept",
    response_model=ConsultationOut,
    summary="Accept a request (advocate)",
)
async def accept_consultation(
    consultation_id: uuid.UUID,
    payload: ConsultationAcceptRequest,
    user: CurrentUser,
    db: DbSession,
) -> ConsultationOut:
    consultation = await _get_with_parties(db, consultation_id)
    if not _is_advocate_party(consultation, user):
        raise ForbiddenError("Only the requested advocate can accept this consultation.")
    if not lifecycle.can_accept_or_decline(consultation.status):
        raise ValidationAppError(
            f"Cannot accept a consultation in status {consultation.status.value}.",
            code="invalid_transition",
        )
    consultation.status = ConsultationStatus.ACCEPTED
    consultation.scheduled_at = payload.scheduled_at
    consultation.meeting_link = payload.meeting_link
    await db.commit()
    consultation = await _get_with_parties(db, consultation_id)

    consumer_email = consultation.consumer.email
    if consumer_email:
        await send_consultation_notification(
            to=consumer_email,
            subject="Your consultation was accepted — Legal Advisor",
            body=(
                f"Your consultation on {consultation.topic!r} was accepted, scheduled for "
                f"{payload.scheduled_at.isoformat()}."
                + (f" Join: {payload.meeting_link}" if payload.meeting_link else "")
            ),
        )
    return _to_out(consultation, viewer=user)


@router.post(
    "/{consultation_id}/decline",
    response_model=ConsultationOut,
    summary="Decline a request (advocate)",
)
async def decline_consultation(
    consultation_id: uuid.UUID,
    payload: ConsultationDeclineRequest,
    user: CurrentUser,
    db: DbSession,
) -> ConsultationOut:
    consultation = await _get_with_parties(db, consultation_id)
    if not _is_advocate_party(consultation, user):
        raise ForbiddenError("Only the requested advocate can decline this consultation.")
    if not lifecycle.can_accept_or_decline(consultation.status):
        raise ValidationAppError(
            f"Cannot decline a consultation in status {consultation.status.value}.",
            code="invalid_transition",
        )
    consultation.status = ConsultationStatus.DECLINED
    consultation.decline_reason = payload.reason
    await db.commit()
    consultation = await _get_with_parties(db, consultation_id)

    consumer_email = consultation.consumer.email
    if consumer_email:
        await send_consultation_notification(
            to=consumer_email,
            subject="Your consultation request was declined — Legal Advisor",
            body=f"Your consultation on {consultation.topic!r} was declined: {payload.reason}",
        )
    return _to_out(consultation, viewer=user)


@router.post(
    "/{consultation_id}/cancel", response_model=ConsultationOut, summary="Cancel a consultation"
)
async def cancel_consultation(
    consultation_id: uuid.UUID, payload: ConsultationCancelRequest, user: CurrentUser, db: DbSession
) -> ConsultationOut:
    consultation = await _get_with_parties(db, consultation_id)
    _require_party(consultation, user)
    if not lifecycle.can_cancel(consultation.status):
        raise ValidationAppError(
            f"Cannot cancel a consultation in status {consultation.status.value}.",
            code="invalid_transition",
        )
    is_consumer = _is_consumer_party(consultation, user)
    other_email = (
        consultation.advocate_profile.user.email if is_consumer else consultation.consumer.email
    )
    consultation.status = ConsultationStatus.CANCELLED
    consultation.cancelled_by_id = user.id
    consultation.cancellation_reason = payload.reason
    await db.commit()
    consultation = await _get_with_parties(db, consultation_id)

    if other_email:
        await send_consultation_notification(
            to=other_email,
            subject="A consultation was cancelled — Legal Advisor",
            body=f"The consultation on {consultation.topic!r} was cancelled: {payload.reason}",
        )
    return _to_out(consultation, viewer=user)


@router.post(
    "/{consultation_id}/complete",
    response_model=ConsultationOut,
    summary="Mark completed (advocate)",
)
async def complete_consultation(
    consultation_id: uuid.UUID,
    payload: ConsultationCompleteRequest,
    user: CurrentUser,
    db: DbSession,
) -> ConsultationOut:
    consultation = await _get_with_parties(db, consultation_id)
    if not _is_advocate_party(consultation, user):
        raise ForbiddenError("Only the assigned advocate can mark this consultation complete.")
    if not lifecycle.can_complete(consultation.status):
        raise ValidationAppError(
            f"Cannot complete a consultation in status {consultation.status.value}.",
            code="invalid_transition",
        )
    consultation.status = ConsultationStatus.COMPLETED
    if payload.advocate_notes is not None:
        consultation.advocate_notes = payload.advocate_notes
    await db.commit()
    consultation = await _get_with_parties(db, consultation_id)
    return _to_out(consultation, viewer=user)


@router.post(
    "/{consultation_id}/close",
    response_model=ConsultationOut,
    summary="Close the matter (advocate)",
)
async def close_consultation(
    consultation_id: uuid.UUID, user: CurrentUser, db: DbSession
) -> ConsultationOut:
    consultation = await _get_with_parties(db, consultation_id)
    if not _is_advocate_party(consultation, user):
        raise ForbiddenError("Only the assigned advocate can close this consultation.")
    if not lifecycle.can_close(consultation.status):
        raise ValidationAppError(
            f"Cannot close a consultation in status {consultation.status.value}.",
            code="invalid_transition",
        )
    consultation.status = ConsultationStatus.CLOSED
    consultation.closed_at = datetime.now(UTC)
    await db.commit()
    consultation = await _get_with_parties(db, consultation_id)
    return _to_out(consultation, viewer=user)
