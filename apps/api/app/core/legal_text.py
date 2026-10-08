"""Fixed legal-product copy. Must mirror `packages/shared/src/disclaimer.ts` exactly."""

from __future__ import annotations

MANDATORY_DISCLAIMER = (
    "This AI provides general legal information and document guidance based on "
    "available legal sources. It does not constitute legal advice, does not "
    "establish an advocate-client relationship, and should not replace advice "
    "from a qualified legal professional. Laws and procedures may vary by "
    "jurisdiction and circumstances."
)

# Shown when retrieval cannot find sufficient grounded evidence (Phase 4 — RAG).
INSUFFICIENT_EVIDENCE_MESSAGE = (
    "I couldn't find sufficient verified information in the available legal "
    "sources to answer this reliably."
)

# Appended to responses for HIGH/CRITICAL risk queries (Phase 5 — risk engine).
# Opens every general-knowledge reply (no indexed source matched), so neither
# the user nor an API client can mistake it for a source-backed answer.
NO_RELEVANT_SOURCES_NOTICE = (
    "I couldn't find sufficiently relevant material in the legal library for this "
    "question, so this is general information only, not drawn from any source document."
)

ADVOCATE_RECOMMENDATION_MESSAGE = "This matter may require advice from a qualified advocate."

# Returned in place of a generated answer when the classifier flags is_out_of_scope.
OUT_OF_SCOPE_MESSAGE = (
    "I can only help with general Indian legal information, document guidance, "
    "and connecting you with an advocate. Could you rephrase your question as a "
    "legal question, or tell me what legal topic you need help with?"
)

# Offline mode (no AI provider configured): replies are built from the
# retrieved passages alone. See app.services.llm.build_sources_only_answer.
SOURCES_ONLY_INTRO = (
    "AI answers are switched off on this server, so no explanation has been written "
    "for your question. These are the passages in the legal library that match it "
    "best. The numbers match the sources listed with this reply."
)
SOURCES_ONLY_OUTRO = (
    "These passages are source text, not advice on your situation. Check the "
    "official text before relying on them."
)
SOURCES_ONLY_NO_MATCH = (
    "Nothing in the legal library matched your question, and AI answers are switched "
    "off on this server, so there is no answer to give. Try rewording it around the "
    "specific topic, law or document involved, for example a security deposit, unpaid "
    "salary or a trademark registration."
)

# First reply to a greeting or "what can you do" in offline mode.
OFFLINE_WELCOME_MESSAGE = (
    "Hello. I'm the Legal Advisor for Indian law. AI answers are switched off on this "
    "server, so I reply by finding the passages in the legal library that match your "
    "question and showing them with their sources. Ask about a specific situation, for "
    "example unpaid salary, a security deposit, a bounced cheque or a defective "
    "product. The advocate directory is open, and the document assistant prepares "
    "template drafts you can edit."
)
