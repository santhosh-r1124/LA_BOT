"""Grounded answer generation (Phase 4) — provider-agnostic since the free-LLM
upgrade (see `app.services.llm_provider`).

Query classification (category/jurisdiction/risk/in-scope) lives in
`app.services.legal_classifier` — a separate module since Phase 5, not this
one. Generation is grounded: the caller (app/api/v1/routes/chat.py) runs
`app.services.rag.retrieval.hybrid_search` first and passes the retrieved
chunks in as `context`. The model is instructed to answer only from that
context and to cite it — see `_GROUNDED_ANSWER_SYSTEM_PROMPT`. There is no
ungrounded generation path: per the product's "grounded, not guessed" rule
(docs/roadmap.md), if retrieval finds nothing, the caller returns
`INSUFFICIENT_EVIDENCE_MESSAGE` without calling this module at all.
"""

from __future__ import annotations

from collections.abc import AsyncIterator

from app.core.config import Settings
from app.core.logging import get_logger
from app.services.llm_provider import ChatTurn, get_provider
from app.services.rag.retrieval import RetrievedChunk

logger = get_logger("app.llm")

_GROUNDED_ANSWER_SYSTEM_PROMPT = (
    "You are the Legal Advisor assistant: a general Indian legal-information "
    "helper for consumers, IT professionals, startups and organisations.\n\n"
    "Each user turn includes a SOURCES block: numbered excerpts retrieved from "
    "verified Indian legal documents, followed by the actual QUESTION.\n\n"
    "Rules:\n"
    "- Answer using ONLY the SOURCES provided. Do not use outside knowledge of "
    "Indian law, and do not fill gaps with assumptions.\n"
    "- Cite the source(s) backing every factual claim with its bracketed "
    "number, e.g. [1], right after the claim. Do not cite a source for a "
    "sentence it doesn't actually support.\n"
    "- If the sources don't fully answer the question, say plainly what they "
    "don't cover instead of guessing, and recommend consulting a qualified "
    "advocate for that part.\n"
    "- Provide general legal information and document guidance only — never "
    "individualised legal advice — and never claim to be a lawyer or to create "
    "an advocate-client relationship.\n"
    "- If the answer genuinely depends on state law, local rules, stamp duty, "
    "registration procedure, or court jurisdiction and the sources don't "
    "specify which, say so explicitly and ask which Indian state/city is "
    "involved rather than quoting one figure as universal.\n"
    "- Keep answers concise and in plain language, structured with short "
    "paragraphs or bullet points where useful.\n"
    "- Do not restate the platform's legal disclaimer yourself — it is shown "
    "separately by the product."
)


def _format_context(context: list[RetrievedChunk]) -> str:
    parts: list[str] = []
    for index, chunk in enumerate(context, start=1):
        label = chunk.document_title
        if chunk.section:
            label += f", Section {chunk.section}"
        if chunk.article:
            label += f", Article {chunk.article}"
        parts.append(f"[{index}] {label}\n{chunk.content}")
    return "\n\n".join(parts)


EMPTY_ANSWER_FALLBACK = "I couldn't generate a response just now. Please try again in a moment."


def _build_messages(
    message: str, *, history: list[tuple[str, str]], context: list[RetrievedChunk]
) -> list[ChatTurn]:
    turns: list[ChatTurn] = list(history)
    turns.append(("user", f"SOURCES:\n{_format_context(context)}\n\nQUESTION: {message}"))
    return turns


async def generate_grounded_answer(
    message: str,
    *,
    history: list[tuple[str, str]],
    context: list[RetrievedChunk],
    settings: Settings,
) -> str:
    """`history` is a list of (role, content) pairs, oldest first. `context`
    is the hybrid-search result for the *current* message only — prior turns
    in `history` keep whatever plain text was actually said, not their
    original sources block, since that's what the conversation actually was.
    """
    provider = get_provider(settings)
    text = await provider.complete(
        system=_GROUNDED_ANSWER_SYSTEM_PROMPT,
        messages=_build_messages(message, history=history, context=context),
        max_tokens=settings.llm_max_tokens,
    )
    return text or EMPTY_ANSWER_FALLBACK


async def stream_grounded_answer(
    message: str,
    *,
    history: list[tuple[str, str]],
    context: list[RetrievedChunk],
    settings: Settings,
) -> AsyncIterator[str]:
    """Same prompt and grounding rules as :func:`generate_grounded_answer`,
    yielded as the model produces it (chat UI streaming)."""
    provider = get_provider(settings)
    async for delta in provider.stream(
        system=_GROUNDED_ANSWER_SYSTEM_PROMPT,
        messages=_build_messages(message, history=history, context=context),
        max_tokens=settings.llm_max_tokens,
    ):
        yield delta
