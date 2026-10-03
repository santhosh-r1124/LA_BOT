"""Consultation booking schemas (Phase 8)."""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, Field

from app.models.consultation import ConsultationMode, ConsultationPaymentStatus, ConsultationStatus


class ConsultationCreateRequest(BaseModel):
    advocate_profile_id: uuid.UUID
    practice_area: str = Field(min_length=1, max_length=100)
    topic: str = Field(min_length=1, max_length=300)
    description: str = Field(min_length=1, max_length=5000)
    mode: ConsultationMode
    preferred_time: datetime | None = None


class ConsultationAcceptRequest(BaseModel):
    scheduled_at: datetime
    meeting_link: str | None = Field(default=None, max_length=500)


class ConsultationDeclineRequest(BaseModel):
    reason: str = Field(min_length=1, max_length=1000)


class ConsultationCancelRequest(BaseModel):
    reason: str = Field(min_length=1, max_length=1000)


class ConsultationCompleteRequest(BaseModel):
    advocate_notes: str | None = Field(default=None, max_length=5000)


class ConsultationOut(BaseModel):
    id: uuid.UUID
    consumer_id: uuid.UUID
    consumer_display_name: str | None
    advocate_profile_id: uuid.UUID
    advocate_display_name: str | None
    practice_area: str
    topic: str
    description: str
    mode: ConsultationMode
    status: ConsultationStatus
    preferred_time: datetime | None
    scheduled_at: datetime | None
    meeting_link: str | None
    fee_amount: Decimal | None
    payment_status: ConsultationPaymentStatus
    decline_reason: str | None
    cancellation_reason: str | None
    # Only populated when the viewer is the advocate (or an admin) — never
    # sent to the consumer. See app/api/v1/routes/consultations.py::_to_out.
    advocate_notes: str | None
    closed_at: datetime | None
    created_at: datetime
    updated_at: datetime


class PaginatedConsultations(BaseModel):
    items: list[ConsultationOut]
    total: int
    limit: int
    offset: int
