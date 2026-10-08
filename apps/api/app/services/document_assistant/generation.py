"""Model-backed draft generation (Phase 6, FRD §7) — provider-agnostic via
`app.services.llm_provider`.

Deliberately NOT run through `app.services.rag.retrieval.hybrid_search`
grounding the way chat answers are (`app.services.llm`): this drafts a
document *template* from facts the user just supplied, it doesn't answer a
legal question from verified sources, so there's nothing in `legal_chunks`
(Acts/judgments) to cite here anyway. Safety instead comes from the prompt
itself — state-variance and professional-verification language, modeled
directly on FRD §7 — plus the same `MANDATORY_DISCLAIMER` chat returns. See
docs/adr/0009-document-assistant-scope.md.
"""

from __future__ import annotations

from app.core.config import Settings
from app.core.errors import ServiceUnavailableError
from app.core.india import ALL_STATE_NAMES, normalize_state
from app.core.logging import get_logger
from app.models.document_request import AssistantDocumentType
from app.services.document_assistant.questions import Question, questions_for
from app.services.llm_provider import get_provider

logger = get_logger("app.document_assistant")

_SYSTEM_PROMPT = (
    "You are the Legal Document Assistant for an Indian legal-information "
    "platform. A user has answered a structured questionnaire for one "
    "document type; draft it from their answers.\n\n"
    "Rules:\n"
    "- Produce a clearly-labeled DRAFT using the supplied answers. Use "
    "standard Indian document structure/conventions for this document type. "
    "Do not invent specific facts (names, amounts, dates) beyond what was "
    "given — where something wasn't answered, use a placeholder like "
    "[TO BE FILLED] rather than guessing.\n"
    "- After the draft, add a 'Notes' section covering: what information is "
    "normally required for this document type, what clauses/sections are "
    "commonly present, what supporting documents may be relevant, and what "
    "professional verification (notarization, stamping, registration, legal "
    "review) may be required.\n"
    "- Explicitly state that execution/notarization/stamping/registration "
    "requirements vary by Indian state, document type and circumstances — "
    "never state a single national rule as if it's universal.\n"
    "- This is a DRAFT ONLY, not a legally executed document and not legal "
    "advice. Never claim to be an advocate or to create an advocate-client "
    "relationship. Recommend review by a qualified advocate before use.\n"
    "- Do not restate the platform's mandatory disclaimer yourself — it is "
    "shown separately by the product."
)


def _format_answers(document_type: AssistantDocumentType, answers: dict[str, str]) -> str:
    questions: list[Question] = questions_for(document_type)
    lines = [f"Document type: {document_type.value}"]
    for q in questions:
        value = (answers.get(q.key) or "").strip()
        if q.key == "state_code" and (code := normalize_state(value)):
            value = f"{ALL_STATE_NAMES[code]} ({code})"
        if value:
            lines.append(f"{q.label}: {value}")
    return "\n".join(lines)


# Drafts (document + Notes section) are much longer than chat answers.
_DRAFT_TOKEN_MULTIPLIER = 3


async def generate_draft(
    document_type: AssistantDocumentType, *, answers: dict[str, str], settings: Settings
) -> str:
    provider = get_provider(settings)
    text = await provider.complete(
        system=_SYSTEM_PROMPT,
        messages=[("user", _format_answers(document_type, answers))],
        max_tokens=settings.llm_max_tokens * _DRAFT_TOKEN_MULTIPLIER,
    )
    if not text:
        logger.warning("document_draft_empty", provider=provider.name)
        raise ServiceUnavailableError(
            "The assistant didn't return a draft. Please try again.", code="llm_error"
        )
    return text
