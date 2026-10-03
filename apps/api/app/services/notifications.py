"""User notifications (Phase 11): one call records an in-app notification
and sends the email copy.

Call ``notify`` *after* the event it describes has been committed. The
notification row is committed on its own so a failure here can never roll
back the business change, and the email is best-effort
(``app/services/email.py`` logs failures instead of raising).

SMS is deliberately not a channel: commercial SMS in India requires DLT
template registration with a telecom operator before a single message can
be sent — an account/legal step, not code. See docs/adr/0013.
"""

from __future__ import annotations

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.models.notification import Notification, NotificationKind
from app.services.email import send_email

logger = get_logger("app.notifications")


async def notify(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    email: str | None,
    kind: NotificationKind,
    title: str,
    body: str,
    link: str | None = None,
    send_email_copy: bool = True,
) -> None:
    try:
        db.add(Notification(user_id=user_id, kind=kind, title=title, body=body, link=link))
        await db.commit()
    except Exception as exc:  # never let a notification fail the caller's request
        await db.rollback()
        logger.warning("notification_persist_failed", kind=kind.value, error=str(exc)[:300])

    if send_email_copy and email:
        await send_email(to=email, subject=f"{title} — Legal Advisor", body=body)
