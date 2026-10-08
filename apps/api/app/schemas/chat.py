"""Chat request/response schemas (Phase 2)."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

# "ai": a model wrote the reply. "sources_only": no AI provider is configured,
# so the reply is the retrieved passages laid out as text (offline mode).
AnswerMode = Literal["ai", "sources_only"]


class SendMessageRequest(BaseModel):
    conversation_id: uuid.UUID | None = None
    message: str = Field(min_length=1, max_length=4000)


class SourceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    document_id: uuid.UUID
    document_title: str
    section: str | None
    article: str | None
    source_url: str
    # Present only when the source dataset provides them.
    court: str | None = None
    date: str | None = None
    citation: str | None = None
    case_name: str | None = None
    dataset: str | None = None
    # Opening of the retrieved passage, so the user can inspect what the
    # answer was actually based on without leaving the chat.
    excerpt: str | None = None


class RecommendedAdvocate(BaseModel):
    """A verified directory advocate suggested for a HIGH/CRITICAL question."""

    id: uuid.UUID
    display_name: str | None
    practice_areas: list[str]
    state_code: str
    city: str
    experience_years: int | None
    matched_area: str
    exact_match: bool
    same_state: bool
    is_sample: bool = False


class ChatMessageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    role: Literal["user", "assistant"]
    content: str
    legal_category: str | None
    jurisdiction_scope: str | None
    is_out_of_scope: bool | None
    risk_level: str | None
    # Assistant messages only: the legal_chunks that grounded the answer.
    # Null for out-of-scope replies; [] means retrieval ran but found nothing.
    sources: list[SourceOut] | None = None
    created_at: datetime


class SendMessageResponse(BaseModel):
    conversation_id: uuid.UUID
    user_message: ChatMessageOut
    assistant_message: ChatMessageOut
    disclaimer: str
    # Filled for HIGH/CRITICAL risk questions; empty otherwise.
    recommended_advocates: list[RecommendedAdvocate] = Field(default_factory=list)
    answer_mode: AnswerMode = "ai"


class ConversationSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title: str | None
    created_at: datetime
    updated_at: datetime


class ConversationDetail(BaseModel):
    id: uuid.UUID
    title: str | None
    messages: list[ChatMessageOut]
