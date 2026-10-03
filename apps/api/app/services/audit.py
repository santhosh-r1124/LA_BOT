"""Record privileged actions in ``audit_events`` (Phase 13).

Called after the action itself has committed. The audit row is committed on
its own; if that fails it is logged loudly (``audit_write_failed``) rather
than raised — reporting an error for an action that already happened would
be worse than a gap the logs still capture.
"""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.middleware.request_context import current_client_ip
from app.models.audit import AuditEvent
from app.models.user import User

logger = get_logger("app.audit")


async def record_audit(
    db: AsyncSession,
    *,
    actor: User,
    action: str,
    target_type: str,
    target_id: object | None = None,
    details: dict[str, object] | None = None,
) -> None:
    try:
        db.add(
            AuditEvent(
                actor_id=actor.id,
                actor_email=actor.email,
                action=action,
                target_type=target_type,
                target_id=str(target_id) if target_id is not None else None,
                details=details,
                ip_address=current_client_ip.get(),
            )
        )
        await db.commit()
    except Exception as exc:
        await db.rollback()
        logger.error(
            "audit_write_failed",
            action=action,
            target_type=target_type,
            target_id=str(target_id),
            error=str(exc)[:300],
        )
