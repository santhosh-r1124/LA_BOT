"""In-app notification feed (Phase 11). Every endpoint is scoped to the
caller's own notifications — there is no way to address another user's."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Query, status
from sqlalchemy import func, select, update

from app.api.deps import CurrentUser, DbSession
from app.core.errors import NotFoundError
from app.models.notification import Notification
from app.schemas.notification import NotificationOut, PaginatedNotifications, UnreadCount

router = APIRouter()

Limit = Annotated[int, Query(ge=1, le=100)]
Offset = Annotated[int, Query(ge=0)]


async def _unread_count(db: DbSession, user_id: uuid.UUID) -> int:
    return (
        await db.execute(
            select(func.count())
            .select_from(Notification)
            .where(Notification.user_id == user_id, Notification.read_at.is_(None))
        )
    ).scalar_one()


@router.get("", response_model=PaginatedNotifications, summary="Your notifications")
async def list_notifications(
    user: CurrentUser,
    db: DbSession,
    unread_only: bool = False,
    limit: Limit = 20,
    offset: Offset = 0,
) -> PaginatedNotifications:
    conditions = [Notification.user_id == user.id]
    if unread_only:
        conditions.append(Notification.read_at.is_(None))
    total = (
        await db.execute(select(func.count()).select_from(Notification).where(*conditions))
    ).scalar_one()
    rows = (
        (
            await db.execute(
                select(Notification)
                .where(*conditions)
                .order_by(Notification.created_at.desc())
                .limit(limit)
                .offset(offset)
            )
        )
        .scalars()
        .all()
    )
    return PaginatedNotifications(
        items=[NotificationOut.model_validate(n) for n in rows],
        total=total,
        unread=await _unread_count(db, user.id),
        limit=limit,
        offset=offset,
    )


@router.get("/unread-count", response_model=UnreadCount, summary="Unread notification count")
async def unread_count(user: CurrentUser, db: DbSession) -> UnreadCount:
    return UnreadCount(unread=await _unread_count(db, user.id))


@router.post("/read-all", status_code=status.HTTP_204_NO_CONTENT, summary="Mark all as read")
async def mark_all_read(user: CurrentUser, db: DbSession) -> None:
    await db.execute(
        update(Notification)
        .where(Notification.user_id == user.id, Notification.read_at.is_(None))
        .values(read_at=datetime.now(UTC))
    )
    await db.commit()


@router.post("/{notification_id}/read", response_model=NotificationOut, summary="Mark as read")
async def mark_read(
    notification_id: uuid.UUID, user: CurrentUser, db: DbSession
) -> NotificationOut:
    notification = await db.scalar(
        select(Notification).where(
            Notification.id == notification_id, Notification.user_id == user.id
        )
    )
    if notification is None:
        # Same 404 for "doesn't exist" and "someone else's" — don't confirm ids.
        raise NotFoundError("Notification not found.")
    if notification.read_at is None:
        notification.read_at = datetime.now(UTC)
        await db.commit()
    return NotificationOut.model_validate(notification)
