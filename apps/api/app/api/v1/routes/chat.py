"""Public + authenticated legal chat (Phase 2) with grounded retrieval (Phase 4).

Anyone can chat (Tier 1 / public, per the FRD) — ``conversation_id`` is enough
to continue a thread anonymously. Logging in additionally ties the
conversation to the account (so it survives across devices) and unlocks
``GET /chat/conversations`` (a list of *your* threads).
"""

from __future__ import annotations

import json
import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.api.deps import CurrentUser, DbSession, OptionalUser, SettingsDep
from app.core.errors import ForbiddenError, NotFoundError, ServiceUnavailableError
from app.core.legal_text import (
    ADVOCATE_RECOMMENDATION_MESSAGE,
    INSUFFICIENT_EVIDENCE_MESSAGE,
    MANDATORY_DISCLAIMER,
    NO_RELEVANT_SOURCES_NOTICE,
    OUT_OF_SCOPE_MESSAGE,
)
from app.core.logging import get_logger
from app.models.chat import ChatMessage, Conversation, MessageRole
from app.models.user import User
from app.schemas.chat import (
    ChatMessageOut,
    ConversationDetail,
    ConversationSummary,
    RecommendedAdvocate,
    SendMessageRequest,
    SendMessageResponse,
)
from app.services import legal_classifier, risk_engine
from app.services import llm as llm_service
from app.services.advocate_recommendation import recommend_advocates
from app.services.rag import retrieval as retrieval_service
from app.services.rag.retrieval import RetrievedChunk
from app.services.rate_limit import AIRateLimit

router = APIRouter()
logger = get_logger("app.chat")

_TITLE_MAX_LEN = 60


def _derive_title(message: str) -> str:
    flat = " ".join(message.split())
    return flat if len(flat) <= _TITLE_MAX_LEN else flat[: _TITLE_MAX_LEN - 1].rstrip() + "…"


def _assert_readable(conversation: Conversation, user: User | None) -> None:
    """A conversation with an owner is only visible to that owner."""
    if conversation.user_id is not None and (user is None or conversation.user_id != user.id):
        raise ForbiddenError("This conversation belongs to another account.")


async def _load_conversation(db: DbSession, conversation_id: uuid.UUID) -> Conversation:
    conversation = await db.get(
        Conversation, conversation_id, options=[selectinload(Conversation.messages)]
    )
    if conversation is None:
        raise NotFoundError("Conversation not found.")
    return conversation


async def _retrieve(message: str, *, db: DbSession, settings: SettingsDep) -> list[RetrievedChunk]:
    """Retrieval is a soft dependency: if embeddings aren't configured (or the
    provider errors), that's not a reason to 500 the whole chat request — it's
    indistinguishable, from the user's side, from "no matching sources were
    found", so it degrades to the same INSUFFICIENT_EVIDENCE_MESSAGE path
    rather than guessing an ungrounded answer or surfacing a raw 503.
    """
    try:
        return await retrieval_service.hybrid_search(message, db=db, settings=settings)
    except ServiceUnavailableError as exc:
        logger.info("retrieval_unavailable", code=exc.code)
        return []


def _source_dict(chunk: RetrievedChunk) -> dict[str, object]:
    source: dict[str, object] = {
        "document_id": str(chunk.document_id),
        "document_title": chunk.document_title,
        "section": chunk.section,
        "article": chunk.article,
        "source_url": chunk.source_url,
    }
    for key in ("court", "date", "citation", "case_name", "dataset"):
        if chunk.metadata.get(key):
            source[key] = str(chunk.metadata[key])
    source["excerpt"] = _excerpt(chunk.content)
    return source


_EXCERPT_CHARS = 600


def _excerpt(content: str) -> str:
    flat = " ".join(content.split())
    if len(flat) <= _EXCERPT_CHARS:
        return flat
    return flat[:_EXCERPT_CHARS].rsplit(" ", 1)[0] + "…"


async def _recommend(
    classification: legal_classifier.Classification,
    *,
    user: User | None,
    db: DbSession,
) -> list[RecommendedAdvocate]:
    """HIGH/CRITICAL in-scope questions -> matching verified advocates. A
    directory problem must never break the chat answer itself."""
    if classification.is_out_of_scope or not risk_engine.requires_advocate_recommendation(
        classification.risk_level
    ):
        return []
    try:
        # A savepoint keeps a failed query from poisoning the chat transaction.
        async with db.begin_nested():
            found = await recommend_advocates(
                db,
                category=classification.category,
                state_code=user.state_code if user else None,
            )
    except Exception as exc:
        logger.warning("advocate_recommendation_failed", error_type=type(exc).__name__)
        return []
    return [
        RecommendedAdvocate(
            id=r.profile.id,
            display_name=r.display_name,
            practice_areas=r.profile.practice_areas,
            state_code=r.profile.state_code,
            city=r.profile.city,
            experience_years=r.profile.experience_years,
            matched_area=r.matched_area,
            exact_match=r.exact_match,
            same_state=r.same_state,
            is_sample=r.profile.is_sample,
        )
        for r in found
    ]


@dataclass(slots=True)
class _PreparedTurn:
    """Everything decided *before* any answer text is generated."""

    conversation: Conversation
    user_message: ChatMessage
    history: list[tuple[str, str]]
    classification: legal_classifier.Classification
    retrieved: list[RetrievedChunk]
    # Set when the reply is fixed text (out of scope / no evidence) and no
    # model generation is needed.
    fixed_answer: str | None
    sources: list[dict[str, object]] | None
    recommended_advocates: list[RecommendedAdvocate]

    @property
    def advocate_suffix(self) -> str:
        if self.classification.is_out_of_scope:
            return ""
        if risk_engine.requires_advocate_recommendation(self.classification.risk_level):
            return f"\n\n{ADVOCATE_RECOMMENDATION_MESSAGE}"
        return ""


async def _prepare_turn(
    payload: SendMessageRequest, *, user: User | None, db: DbSession, settings: SettingsDep
) -> _PreparedTurn:
    if payload.conversation_id is not None:
        conversation = await _load_conversation(db, payload.conversation_id)
        _assert_readable(conversation, user)
        history_source = conversation.messages
    else:
        conversation = Conversation(
            user_id=user.id if user else None, title=_derive_title(payload.message)
        )
        db.add(conversation)
        await db.flush()
        history_source = []

    history = [(m.role.value, m.content) for m in history_source[-settings.chat_history_length :]]

    user_message = ChatMessage(
        conversation_id=conversation.id, role=MessageRole.USER, content=payload.message
    )
    db.add(user_message)

    classification = await legal_classifier.classify_query(payload.message, settings=settings)
    user_message.legal_category = classification.category
    user_message.jurisdiction_scope = classification.jurisdiction_scope
    user_message.is_out_of_scope = classification.is_out_of_scope
    user_message.risk_level = classification.risk_level

    retrieved: list[RetrievedChunk] = []
    fixed_answer: str | None = None
    sources: list[dict[str, object]] | None = None
    if classification.is_out_of_scope:
        fixed_answer = OUT_OF_SCOPE_MESSAGE
    else:
        retrieved = await _retrieve(payload.message, db=db, settings=settings)
        # [] marks "no indexed source backs this reply" (general answer or
        # insufficient evidence); the UI labels it accordingly.
        sources = [_source_dict(chunk) for chunk in retrieved]
        if not retrieved and not settings.allow_general_answers:
            fixed_answer = INSUFFICIENT_EVIDENCE_MESSAGE

    # Chat history is rolled back on provider failure (see the stream route),
    # but the directory read is side-effect free, so run it up front.
    recommended = await _recommend(classification, user=user, db=db)

    return _PreparedTurn(
        conversation=conversation,
        user_message=user_message,
        history=history,
        classification=classification,
        retrieved=retrieved,
        fixed_answer=fixed_answer,
        sources=sources,
        recommended_advocates=recommended,
    )


async def _finalize_turn(
    turn: _PreparedTurn, answer_text: str, *, db: DbSession
) -> SendMessageResponse:
    assistant_message = ChatMessage(
        conversation_id=turn.conversation.id,
        role=MessageRole.ASSISTANT,
        content=answer_text,
        sources=turn.sources,
    )
    db.add(assistant_message)

    await db.commit()
    await db.refresh(turn.user_message)
    await db.refresh(assistant_message)

    return SendMessageResponse(
        conversation_id=turn.conversation.id,
        user_message=ChatMessageOut.model_validate(turn.user_message),
        assistant_message=ChatMessageOut.model_validate(assistant_message),
        disclaimer=MANDATORY_DISCLAIMER,
        recommended_advocates=turn.recommended_advocates,
    )


@router.post("/messages", response_model=SendMessageResponse, summary="Send a chat message")
async def send_message(
    payload: SendMessageRequest,
    user: OptionalUser,
    db: DbSession,
    settings: SettingsDep,
    _rate_limit: AIRateLimit,
) -> SendMessageResponse:
    turn = await _prepare_turn(payload, user=user, db=db, settings=settings)
    if turn.fixed_answer is not None:
        answer_text = turn.fixed_answer
    elif turn.retrieved:
        answer_text = await llm_service.generate_grounded_answer(
            payload.message, history=turn.history, context=turn.retrieved, settings=settings
        )
    else:
        answer_text = (
            f"{NO_RELEVANT_SOURCES_NOTICE}\n\n"
            + await llm_service.generate_general_answer(
                payload.message, history=turn.history, settings=settings
            )
        )
    return await _finalize_turn(turn, answer_text + turn.advocate_suffix, db=db)


def _answer_stream(
    turn: _PreparedTurn, message: str, *, settings: SettingsDep
) -> AsyncIterator[str]:
    if turn.retrieved:
        return llm_service.stream_grounded_answer(
            message, history=turn.history, context=turn.retrieved, settings=settings
        )
    return llm_service.stream_general_answer(message, history=turn.history, settings=settings)


def _sse(event: str, data: object) -> str:
    return f"event: {event}\ndata: {json.dumps(data, default=str)}\n\n"


@router.post(
    "/messages/stream",
    summary="Send a chat message and stream the reply (Server-Sent Events)",
    response_class=StreamingResponse,
    responses={
        200: {
            "content": {"text/event-stream": {}},
            "description": "Events: `start` (classification + sources), `delta` "
            "(answer text), then `done` (the persisted SendMessageResponse) or "
            "`error` ({code, message}).",
        }
    },
)
async def send_message_stream(
    payload: SendMessageRequest,
    user: OptionalUser,
    db: DbSession,
    settings: SettingsDep,
    _rate_limit: AIRateLimit,
) -> StreamingResponse:
    # Classification + retrieval run before the stream opens, so their
    # failures (e.g. llm_not_configured) still return the normal JSON error
    # envelope with a proper status code.
    turn = await _prepare_turn(payload, user=user, db=db, settings=settings)

    async def events() -> AsyncIterator[str]:
        yield _sse(
            "start",
            {
                "conversation_id": str(turn.conversation.id),
                "legal_category": turn.classification.category,
                "jurisdiction_scope": turn.classification.jurisdiction_scope,
                "risk_level": turn.classification.risk_level,
                "is_out_of_scope": turn.classification.is_out_of_scope,
                "sources": turn.sources,
                "recommended_advocates": [
                    a.model_dump(mode="json") for a in turn.recommended_advocates
                ],
            },
        )
        if turn.fixed_answer is not None:
            answer_text = turn.fixed_answer
            yield _sse("delta", {"text": answer_text})
        else:
            parts: list[str] = []
            if not turn.retrieved:
                notice = f"{NO_RELEVANT_SOURCES_NOTICE}\n\n"
                parts.append(notice)
                yield _sse("delta", {"text": notice})
            try:
                async for delta in _answer_stream(turn, payload.message, settings=settings):
                    parts.append(delta)
                    yield _sse("delta", {"text": delta})
            except ServiceUnavailableError as exc:
                # Nothing is persisted for a failed turn — same as the
                # non-streaming endpoint's 503.
                await db.rollback()
                yield _sse("error", {"code": exc.code, "message": exc.message})
                return
            answer_text = "".join(parts).strip() or llm_service.EMPTY_ANSWER_FALLBACK

        suffix = turn.advocate_suffix
        if suffix:
            yield _sse("delta", {"text": suffix})
        response = await _finalize_turn(turn, answer_text + suffix, db=db)
        yield _sse("done", response.model_dump(mode="json"))

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get(
    "/conversations", response_model=list[ConversationSummary], summary="List your conversations"
)
async def list_conversations(user: CurrentUser, db: DbSession) -> list[ConversationSummary]:
    rows = (
        (
            await db.execute(
                select(Conversation)
                .where(Conversation.user_id == user.id)
                .order_by(Conversation.updated_at.desc())
                .limit(50)
            )
        )
        .scalars()
        .all()
    )
    return [ConversationSummary.model_validate(c) for c in rows]


@router.get(
    "/conversations/{conversation_id}",
    response_model=ConversationDetail,
    summary="Get a conversation's messages",
)
async def get_conversation(
    conversation_id: uuid.UUID, user: OptionalUser, db: DbSession
) -> ConversationDetail:
    conversation = await _load_conversation(db, conversation_id)
    _assert_readable(conversation, user)
    return ConversationDetail(
        id=conversation.id,
        title=conversation.title,
        messages=[ChatMessageOut.model_validate(m) for m in conversation.messages],
    )
