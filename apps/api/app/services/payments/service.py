"""Payment fulfilment (Phase 10): keeps ``Payment`` rows and
``Consultation.payment_status`` in sync with what the gateway reports.

Two independent paths can confirm the same payment — the browser checkout
callback (``confirm_checkout_payment``) and the gateway's server-to-server
webhook (``handle_webhook``) — and either may arrive first, twice, or not
at all. Every transition here is therefore idempotent and never moves a
payment backwards (a late ``payment.failed`` can't un-capture a captured
payment). The webhook is the authoritative path; the callback exists so the
consumer sees "paid" immediately rather than after webhook latency.
"""

from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.errors import ConflictError, UnauthorizedError, ValidationAppError
from app.core.logging import get_logger
from app.models.consultation import Consultation, ConsultationPaymentStatus, ConsultationStatus
from app.models.payment import Payment, PaymentStatus
from app.services.payments.base import GatewayOrder, GatewayRefund, PaymentGateway
from app.services.payments.razorpay_gateway import RazorpayGateway

logger = get_logger("app.payments")

CURRENCY = "INR"
# Payment opens once the advocate has accepted (the fee is then final) and
# stays open after the session if the consumer hasn't paid yet.
_PAYABLE_STATUSES = frozenset({ConsultationStatus.ACCEPTED, ConsultationStatus.COMPLETED})
_SETTLED_PAYMENT_STATUSES = frozenset(
    {
        ConsultationPaymentStatus.PAID,
        ConsultationPaymentStatus.WAIVED,
        ConsultationPaymentStatus.REFUNDED,
    }
)

_gateway: PaymentGateway | None = None


def get_payment_gateway() -> PaymentGateway:
    global _gateway
    if _gateway is None:
        _gateway = RazorpayGateway()
    return _gateway


def set_payment_gateway(gateway: PaymentGateway | None) -> None:
    """Override the process-wide gateway — used by tests (same pattern as
    ``app.services.email.set_email_sender``)."""
    global _gateway
    _gateway = gateway


def to_minor_units(amount: Decimal) -> int:
    return int((amount * 100).to_integral_value())


def from_minor_units(amount: int) -> Decimal:
    return (Decimal(amount) / 100).quantize(Decimal("0.01"))


async def create_payment_order(
    *,
    db: AsyncSession,
    settings: Settings,
    consultation: Consultation,
) -> tuple[Payment, GatewayOrder]:
    if consultation.status not in _PAYABLE_STATUSES:
        raise ValidationAppError(
            "Payment opens once the advocate has accepted the consultation.",
            code="not_payable",
        )
    if consultation.payment_status in _SETTLED_PAYMENT_STATUSES:
        raise ConflictError("This consultation has already been settled.", code="already_paid")
    if consultation.fee_amount is None or consultation.fee_amount <= 0:
        raise ValidationAppError(
            "This advocate hasn't set a consultation fee, so there's nothing to pay.",
            code="no_fee",
        )

    gateway = get_payment_gateway()
    order = await gateway.create_order(
        amount=to_minor_units(consultation.fee_amount),
        currency=CURRENCY,
        # Razorpay caps receipt at 40 chars; a UUID string is 36.
        receipt=str(consultation.id),
        notes={"consultation_id": str(consultation.id)},
        settings=settings,
    )
    payment = Payment(
        consultation_id=consultation.id,
        provider=gateway.name,
        gateway_order_id=order.order_id,
        amount=consultation.fee_amount,
        currency=order.currency,
    )
    db.add(payment)
    consultation.payment_status = ConsultationPaymentStatus.PENDING
    await db.commit()
    await db.refresh(payment)
    logger.info("payment_order_created", consultation_id=str(consultation.id))
    return payment, order


def _mark_captured(
    payment: Payment, consultation: Consultation, gateway_payment_id: str | None
) -> None:
    if payment.status in (PaymentStatus.CAPTURED, PaymentStatus.REFUNDED):
        return
    payment.status = PaymentStatus.CAPTURED
    payment.failure_reason = None
    if gateway_payment_id:
        payment.gateway_payment_id = gateway_payment_id
    payment.captured_at = datetime.now(UTC)
    consultation.payment_status = ConsultationPaymentStatus.PAID


async def confirm_checkout_payment(
    *,
    db: AsyncSession,
    settings: Settings,
    consultation: Consultation,
    payment: Payment,
    gateway_payment_id: str,
    signature: str,
) -> Payment:
    if payment.status == PaymentStatus.CAPTURED:
        return payment  # already confirmed (e.g. the webhook won the race)

    verified = get_payment_gateway().verify_payment_signature(
        order_id=payment.gateway_order_id,
        payment_id=gateway_payment_id,
        signature=signature,
        settings=settings,
    )
    if not verified:
        logger.warning("payment_signature_mismatch", payment_id=str(payment.id))
        raise ValidationAppError(
            "The payment could not be verified. If you were charged, it will be "
            "confirmed automatically once the gateway notifies us.",
            code="invalid_payment_signature",
        )

    _mark_captured(payment, consultation, gateway_payment_id)
    await db.commit()
    await db.refresh(payment)
    return payment


async def handle_webhook(
    *, db: AsyncSession, settings: Settings, raw_body: bytes, signature: str | None
) -> str:
    """Apply one gateway webhook. Returns a short outcome label for logging.

    Raises ``UnauthorizedError`` on a missing/invalid signature; everything
    else (unknown event, unknown order) is acknowledged so the gateway stops
    retrying — those are not errors on our side.
    """
    gateway = get_payment_gateway()
    if not signature or not gateway.verify_webhook_signature(
        raw_body=raw_body, signature=signature, settings=settings
    ):
        raise UnauthorizedError("Invalid webhook signature.", code="invalid_webhook_signature")

    event = gateway.parse_webhook_event(raw_body)
    payment: Payment | None = None
    if event.gateway_order_id:
        payment = await db.scalar(
            select(Payment).where(Payment.gateway_order_id == event.gateway_order_id)
        )
    if payment is None and event.gateway_payment_id:
        payment = await db.scalar(
            select(Payment).where(Payment.gateway_payment_id == event.gateway_payment_id)
        )
    if payment is None:
        logger.info("payment_webhook_unmatched", gateway_event=event.event)
        return "unmatched"

    consultation = await db.get(Consultation, payment.consultation_id)
    if consultation is None:  # cascade-deleted between order and webhook
        return "unmatched"

    payment.raw_webhook_payload = event.raw
    outcome = "ignored"
    if event.event == "payment.captured":
        _mark_captured(payment, consultation, event.gateway_payment_id)
        outcome = "captured"
    elif event.event == "payment.failed":
        if payment.status == PaymentStatus.CREATED:
            payment.status = PaymentStatus.FAILED
            payment.failure_reason = event.error_description or "Payment failed at the gateway."
            consultation.payment_status = ConsultationPaymentStatus.UNPAID
        outcome = "failed"
    elif event.event == "refund.processed":
        payment.status = PaymentStatus.REFUNDED
        if event.amount is not None:
            payment.refunded_amount = from_minor_units(event.amount)
        consultation.payment_status = ConsultationPaymentStatus.REFUNDED
        outcome = "refunded"

    await db.commit()
    logger.info("payment_webhook_applied", gateway_event=event.event, outcome=outcome)
    return outcome


async def request_refund(
    *, settings: Settings, payment: Payment, amount: Decimal | None
) -> GatewayRefund:
    """Ask the gateway to refund a captured payment. Nothing local changes
    here: the payment flips to REFUNDED only when the ``refund.processed``
    webhook confirms it, since a refund the gateway accepted can still fail."""
    if payment.status != PaymentStatus.CAPTURED or not payment.gateway_payment_id:
        raise ValidationAppError("Only a captured payment can be refunded.", code="not_refundable")
    if amount is not None and amount > payment.amount:
        raise ValidationAppError("Refund exceeds the amount paid.", code="refund_too_large")

    refund = await get_payment_gateway().refund(
        payment_id=payment.gateway_payment_id,
        amount=to_minor_units(amount) if amount is not None else None,
        settings=settings,
    )
    logger.info("payment_refund_requested", payment_id=str(payment.id), status=refund.status)
    return refund
