"""Admin-only schemas: user management, advocate verification queue."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, Field

from app.schemas.advocate import AdvocateProfileOut
from app.schemas.user import UserOut


class PaginatedUsers(BaseModel):
    items: list[UserOut]
    total: int
    limit: int
    offset: int


class PaginatedAdvocateProfiles(BaseModel):
    items: list[AdvocateProfileOut]
    total: int
    limit: int
    offset: int


class UserActiveUpdateRequest(BaseModel):
    is_active: bool


class AdminAdvocateOut(AdvocateProfileOut):
    """An advocate profile plus the account details a reviewer needs — the
    public/self-service ``AdvocateProfileOut`` deliberately omits these."""

    email: str
    display_name: str | None


class PaginatedAdminAdvocates(BaseModel):
    items: list[AdminAdvocateOut]
    total: int
    limit: int
    offset: int


class RiskReviewItem(BaseModel):
    id: uuid.UUID
    conversation_id: uuid.UUID
    content: str
    legal_category: str | None
    jurisdiction_scope: str | None
    risk_level: str | None
    is_anonymous: bool
    assistant_reply: str | None
    created_at: datetime
    reviewed_at: datetime | None
    review_note: str | None


class PaginatedRiskReview(BaseModel):
    items: list[RiskReviewItem]
    total: int
    limit: int
    offset: int


class RiskReviewRequest(BaseModel):
    note: str | None = Field(default=None, max_length=2000)


class AdminOverview(BaseModel):
    users_by_role: dict[str, int]
    advocates_awaiting_verification: int
    consultations_by_status: dict[str, int]
    payments_by_status: dict[str, int]
    legal_documents_by_status: dict[str, int]
    catalog_by_status: dict[str, int]
    risk_review_pending: int
