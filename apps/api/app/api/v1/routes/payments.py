"""Payment gateway webhooks + admin payment operations (Phase 10).

The webhook is the one unauthenticated write endpoint in the API: the caller
is the gateway's servers, not a user, so it authenticates by HMAC signature
over the raw body instead of a bearer token (app/services/payments/
razorpay_gateway.py). Point the Razorpay dashboard's webhook at
``/api/v1/payments/webhooks/razorpay`` with events ``payment.captured``,
``payment.failed`` and ``refund.processed``.
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Header, Query, Request
from sqlalchemy import func, select

from app.api.deps import DbSession, SettingsDep, require_roles
from app.core.errors import NotFoundError
from app.models.payment import Payment, PaymentStatus
from app.models.user import User, UserRole
from app.schemas.payment import (
    PaginatedPayments,
    PaymentOut,
    RefundRequest,
    RefundRequestedOut,
)
from app.services.payments.service import handle_webhook, request_refund

router = APIRouter()
admin_router = APIRouter()

AdminUser = Annotated[User, Depends(require_roles(UserRole.ADMIN, UserRole.LEGAL_ADMIN))]
Limit = Annotated[int, Query(ge=1, le=100)]
Offset = Annotated[int, Query(ge=0)]


@router.post("/webhooks/razorpay", summary="Razorpay webhook receiver")
async def razorpay_webhook(
    request: Request,
    db: DbSession,
    settings: SettingsDep,
    x_razorpay_signature: Annotated[str | None, Header()] = None,
) -> dict[str, str]:
    # Signature is computed over the exact bytes received — read the raw
    # body, never a parsed-and-reserialised model.
    raw_body = await request.body()
    outcome = await handle_webhook(
        db=db, settings=settings, raw_body=raw_body, signature=x_razorpay_signature
    )
    return {"status": "ok", "outcome": outcome}


@admin_router.get("", response_model=PaginatedPayments, summary="List payments")
async def list_payments(
    _admin: AdminUser,
    db: DbSession,
    status: PaymentStatus | None = None,
    limit: Limit = 25,
    offset: Offset = 0,
) -> PaginatedPayments:
    stmt = select(Payment)
    count_stmt = select(func.count()).select_from(Payment)
    if status is not None:
        stmt = stmt.where(Payment.status == status)
        count_stmt = count_stmt.where(Payment.status == status)
    total = (await db.execute(count_stmt)).scalar_one()
    rows = (
        (await db.execute(stmt.order_by(Payment.created_at.desc()).limit(limit).offset(offset)))
        .scalars()
        .all()
    )
    return PaginatedPayments(
        items=[PaymentOut.model_validate(p) for p in rows], total=total, limit=limit, offset=offset
    )


@admin_router.post(
    "/{payment_id}/refund", response_model=RefundRequestedOut, summary="Refund a payment"
)
async def refund_payment(
    payment_id: uuid.UUID,
    payload: RefundRequest,
    _admin: AdminUser,
    db: DbSession,
    settings: SettingsDep,
) -> RefundRequestedOut:
    payment = await db.get(Payment, payment_id)
    if payment is None:
        raise NotFoundError("Payment not found.")
    refund = await request_refund(settings=settings, payment=payment, amount=payload.amount)
    return RefundRequestedOut(
        refund_id=refund.refund_id, amount_minor=refund.amount, status=refund.status
    )
