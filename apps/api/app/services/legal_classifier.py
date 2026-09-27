"""Legal query classification (Phase 2) + risk scoring (Phase 5).

One structured model call assigns every message a legal `category`, a
`jurisdiction_scope` hint, a `risk_level`, and whether it's `is_out_of_scope`
at all. Risk is folded into the *same* call rather than a second one: Claude
is already reading the message to judge category/jurisdiction, and asking it
to also judge urgency on that same read costs no extra round trip — a second,
independent call could even disagree with the first about the same message.
See docs/adr/0008-risk-scoring.md.

`app.services.risk_engine` turns a `risk_level` into a product decision
(does this reply need an advocate recommendation?); this module only
classifies, it doesn't decide what to do with the classification.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from app.core.config import Settings
from app.core.logging import get_logger
from app.services.llm_provider import get_provider

logger = get_logger("app.legal_classifier")

# Mirrors packages/shared/src/legal.ts (LEGAL_CATEGORIES) — keep in sync.
LEGAL_CATEGORIES = (
    "CONSUMER_LAW",
    "CONTRACT_LAW",
    "IT_LAW",
    "CYBER_LAW",
    "DATA_PROTECTION",
    "IP_LAW",
    "PROPERTY_LAW",
    "EMPLOYMENT_LAW",
    "CORPORATE_LAW",
    "FAMILY_LAW",
    "CRIMINAL_LAW",
    "TAX_LAW",
    "DOCUMENT_GUIDANCE",
    "ADVOCATE_REQUIRED",
    "OUT_OF_SCOPE",
)

# Mirrors packages/shared/src/legal.ts (JURISDICTION_SCOPES) — keep in sync.
JURISDICTION_SCOPES = (
    "CENTRAL",
    "STATE",
    "LOCAL",
    "DISTRICT",
    "COURT",
    "REGISTRATION_AUTHORITY",
    "STAMP_DUTY",
    "UNKNOWN",
)

# Mirrors packages/shared/src/legal.ts (RISK_LEVELS) — keep in sync.
RISK_LEVELS = ("LOW", "MEDIUM", "HIGH", "CRITICAL")
# No "unknown" member exists for risk (unlike jurisdiction_scope) — when a
# response can't be parsed, fail toward *recommending* an advocate rather
# than silently skipping it. Under-escalating a genuinely urgent matter is a
# worse failure than an unnecessary nudge to consult one.
_RISK_FALLBACK = "HIGH"

_SCHEMA_NAME = "classify_legal_query"
_CLASSIFY_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "category": {"type": "string", "enum": list(LEGAL_CATEGORIES)},
        "jurisdiction_scope": {"type": "string", "enum": list(JURISDICTION_SCOPES)},
        "risk_level": {"type": "string", "enum": list(RISK_LEVELS)},
        "is_out_of_scope": {
            "type": "boolean",
            "description": "True only if the message has no connection to Indian law at all.",
        },
    },
    "required": ["category", "jurisdiction_scope", "risk_level", "is_out_of_scope"],
}

_CLASSIFIER_SYSTEM_PROMPT = (
    "You triage messages for an Indian legal-information platform. Classify the "
    "user's message into the requested structured result.\n"
    "- `category`: the closest legal domain. Use ADVOCATE_REQUIRED for disputes, "
    "notices, or matters clearly needing professional representation; use "
    "DOCUMENT_GUIDANCE for questions about drafting/understanding a document.\n"
    "- `jurisdiction_scope`: STATE, LOCAL, STAMP_DUTY, REGISTRATION_AUTHORITY, "
    "DISTRICT, or COURT if the answer likely depends on which Indian state/city "
    "is involved; CENTRAL if it's purely national law; UNKNOWN if unclear.\n"
    "- `risk_level`: how urgent/consequential this is for the person, not how "
    "hard the question is to answer.\n"
    '  - LOW: general legal education, e.g. "What is an affidavit?"\n'
    "  - MEDIUM: guidance on a document/process they're about to do, e.g. "
    '"What should a rental agreement include?"\n'
    "  - HIGH: describes a specific dispute or consequence already unfolding, "
    'e.g. "My landlord won\'t return my deposit" or "I got a legal notice '
    'from a vendor."\n'
    "  - CRITICAL: active litigation, arrest, a criminal matter, a regulatory/"
    "government enforcement action, or major financial/personal exposure, "
    'e.g. "I\'ve been arrested", "I received a court summons", "the IT '
    'department raided our office."\n'
    "- `is_out_of_scope`: true only for messages with no connection to Indian "
    "law, legal processes, or legal documents at all — general chit-chat, "
    "coding help, medical/financial advice, creative writing, other countries' "
    "law with no Indian angle, etc. A greeting that asks what the assistant can "
    "help with is NOT out of scope (category DOCUMENT_GUIDANCE, scope UNKNOWN, "
    "risk LOW)."
)


@dataclass(frozen=True, slots=True)
class Classification:
    category: str
    jurisdiction_scope: str
    risk_level: str
    is_out_of_scope: bool


async def classify_query(message: str, *, settings: Settings) -> Classification:
    """One structured call — the provider returns JSON matching
    ``_CLASSIFY_SCHEMA`` (tool call on Anthropic, JSON-schema output on
    Gemini, JSON mode on OpenAI-compatible APIs). Every field is re-validated
    here; anything missing or unexpected falls back to a safe default."""
    provider = get_provider(settings)
    data = await provider.complete_json(
        system=_CLASSIFIER_SYSTEM_PROMPT,
        message=message,
        schema=_CLASSIFY_SCHEMA,
        schema_name=_SCHEMA_NAME,
        max_tokens=settings.llm_classifier_max_tokens,
    )
    if not data:
        # Unparsable/empty structured output — fail safe (see _RISK_FALLBACK).
        logger.warning("llm_classify_unparsable", provider=provider.name)
        return Classification(
            category="OUT_OF_SCOPE",
            jurisdiction_scope="UNKNOWN",
            risk_level=_RISK_FALLBACK,
            is_out_of_scope=True,
        )

    category = data.get("category")
    scope = data.get("jurisdiction_scope")
    risk = data.get("risk_level")
    return Classification(
        category=category if category in LEGAL_CATEGORIES else "OUT_OF_SCOPE",
        jurisdiction_scope=scope if scope in JURISDICTION_SCOPES else "UNKNOWN",
        risk_level=risk if risk in RISK_LEVELS else _RISK_FALLBACK,
        is_out_of_scope=bool(data.get("is_out_of_scope", False)),
    )
