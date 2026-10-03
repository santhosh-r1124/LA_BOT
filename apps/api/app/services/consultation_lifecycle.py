"""Pure consultation state-machine rules (Phase 8).

Kept separate from the ``Consultation`` model and the route handlers for the
same reason Phase 5 split risk-scoring into ``risk_engine.py``
(docs/adr/0008): "is this transition allowed" is a decision independent of
how it's triggered (HTTP route today, a future admin override or scheduled
job later), and independently testable without a DB.
"""

from __future__ import annotations

from app.models.consultation import ConsultationStatus

_ACTIVE_STATUSES = frozenset({ConsultationStatus.REQUESTED, ConsultationStatus.ACCEPTED})


def can_accept_or_decline(status: ConsultationStatus) -> bool:
    return status == ConsultationStatus.REQUESTED


def can_cancel(status: ConsultationStatus) -> bool:
    return status in _ACTIVE_STATUSES


def can_complete(status: ConsultationStatus) -> bool:
    return status == ConsultationStatus.ACCEPTED


def can_close(status: ConsultationStatus) -> bool:
    return status == ConsultationStatus.COMPLETED
