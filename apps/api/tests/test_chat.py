"""Integration tests for the chat endpoints. Needs Postgres — see conftest.db_client.

The classifier, LLM and retrieval calls are monkeypatched
(app.services.legal_classifier.classify_query, app.services.llm.generate_grounded_answer,
app.services.rag.retrieval.hybrid_search) so these test persistence,
RBAC/ownership and routing logic without needing a real ANTHROPIC_API_KEY,
GEMINI_API_KEY, or network access. One test
(`test_send_message_without_api_key_returns_503`) deliberately does NOT patch
anything, to prove the real "not configured" path works end-to-end.
"""

from __future__ import annotations

import uuid

import pytest
from httpx import AsyncClient

from app.core.legal_text import (
    ADVOCATE_RECOMMENDATION_MESSAGE,
    INSUFFICIENT_EVIDENCE_MESSAGE,
    OUT_OF_SCOPE_MESSAGE,
)
from app.services import legal_classifier
from app.services import llm as llm_module
from app.services.rag import retrieval as retrieval_module
from app.services.rag.retrieval import RetrievedChunk
from tests.conftest import unique_email

IT_LAW_CLASSIFICATION = legal_classifier.Classification(
    category="IT_LAW", jurisdiction_scope="CENTRAL", risk_level="LOW", is_out_of_scope=False
)
HIGH_RISK_CLASSIFICATION = legal_classifier.Classification(
    category="ADVOCATE_REQUIRED",
    jurisdiction_scope="COURT",
    risk_level="HIGH",
    is_out_of_scope=False,
)
OUT_OF_SCOPE_CLASSIFICATION = legal_classifier.Classification(
    category="OUT_OF_SCOPE", jurisdiction_scope="UNKNOWN", risk_level="LOW", is_out_of_scope=True
)
FAKE_CHUNK = RetrievedChunk(
    chunk_id=uuid.uuid4(),
    document_id=uuid.uuid4(),
    document_title="Test Act, 2000",
    source_url="https://example.com/act",
    section="1",
    article=None,
    content="Some legal text.",
)


def _patch_llm(
    monkeypatch: pytest.MonkeyPatch,
    *,
    classification: legal_classifier.Classification = IT_LAW_CLASSIFICATION,
    answer: str = "Here is some general information about that. [1]",
    retrieved: list[RetrievedChunk] | None = None,
    record_history: list[list[tuple[str, str]]] | None = None,
) -> None:
    resolved_retrieved = [FAKE_CHUNK] if retrieved is None else retrieved

    async def fake_classify(message: str, *, settings: object) -> legal_classifier.Classification:
        return classification

    async def fake_search(query: str, *, db: object, settings: object) -> list[RetrievedChunk]:
        return resolved_retrieved

    async def fake_generate(
        message: str,
        *,
        history: list[tuple[str, str]],
        context: list[RetrievedChunk],
        settings: object,
    ) -> str:
        if record_history is not None:
            record_history.append(history)
        return answer

    monkeypatch.setattr(legal_classifier, "classify_query", fake_classify)
    monkeypatch.setattr(retrieval_module, "hybrid_search", fake_search)
    monkeypatch.setattr(llm_module, "generate_grounded_answer", fake_generate)


@pytest.fixture
def strict_sources(monkeypatch: pytest.MonkeyPatch) -> None:
    """Sources-only mode: no general answers when retrieval finds nothing."""
    from app.core.config import get_settings

    monkeypatch.setenv("ALLOW_GENERAL_ANSWERS", "false")
    get_settings.cache_clear()


def _patch_general(monkeypatch: pytest.MonkeyPatch, answer: str = "General info.") -> list[str]:
    calls: list[str] = []

    async def fake_general(
        message: str, *, history: list[tuple[str, str]], settings: object
    ) -> str:
        calls.append(message)
        return answer

    monkeypatch.setattr(llm_module, "generate_general_answer", fake_general)
    return calls


async def _register(db_client: AsyncClient) -> dict[str, object]:
    resp = await db_client.post(
        "/api/v1/auth/register",
        json={"email": unique_email(), "password": "correct horse battery staple"},
    )
    assert resp.status_code == 201
    return resp.json()


async def test_send_message_without_api_key_returns_503(db_client: AsyncClient) -> None:
    # Deliberately unpatched — conftest never sets ANTHROPIC_API_KEY.
    resp = await db_client.post("/api/v1/chat/messages", json={"message": "What is an affidavit?"})
    assert resp.status_code == 503
    assert resp.json()["error"]["code"] == "llm_not_configured"


async def test_anonymous_user_can_chat(
    db_client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _patch_llm(monkeypatch)
    resp = await db_client.post("/api/v1/chat/messages", json={"message": "What is an affidavit?"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["conversation_id"]
    assert body["user_message"]["role"] == "user"
    assert body["user_message"]["legal_category"] == "IT_LAW"
    expected_answer = "Here is some general information about that. [1]"
    assert body["assistant_message"]["role"] == "assistant"
    assert body["assistant_message"]["content"] == expected_answer
    assert body["assistant_message"]["sources"] == [
        {
            "document_id": str(FAKE_CHUNK.document_id),
            "document_title": FAKE_CHUNK.document_title,
            "section": FAKE_CHUNK.section,
            "article": FAKE_CHUNK.article,
            "source_url": FAKE_CHUNK.source_url,
        }
    ]
    assert body["disclaimer"]
    assert body["user_message"]["risk_level"] == "LOW"


async def test_high_risk_appends_advocate_recommendation(
    db_client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _patch_llm(monkeypatch, classification=HIGH_RISK_CLASSIFICATION, answer="Here's what applies.")
    resp = await db_client.post(
        "/api/v1/chat/messages", json={"message": "I got a legal notice from a vendor"}
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["user_message"]["risk_level"] == "HIGH"
    assert body["assistant_message"]["content"] == (
        f"Here's what applies.\n\n{ADVOCATE_RECOMMENDATION_MESSAGE}"
    )


async def test_high_risk_advocate_recommendation_also_applies_to_insufficient_evidence(
    db_client: AsyncClient, monkeypatch: pytest.MonkeyPatch, strict_sources: None
) -> None:
    _patch_llm(monkeypatch, classification=HIGH_RISK_CLASSIFICATION, retrieved=[])
    resp = await db_client.post(
        "/api/v1/chat/messages", json={"message": "I got a legal notice from a vendor"}
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["assistant_message"]["content"] == (
        f"{INSUFFICIENT_EVIDENCE_MESSAGE}\n\n{ADVOCATE_RECOMMENDATION_MESSAGE}"
    )


async def test_low_risk_does_not_append_advocate_recommendation(
    db_client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _patch_llm(monkeypatch, answer="Plain answer, no recommendation needed.")
    resp = await db_client.post("/api/v1/chat/messages", json={"message": "What is an affidavit?"})
    assert resp.status_code == 200
    content = resp.json()["assistant_message"]["content"]
    assert content == "Plain answer, no recommendation needed."
    assert ADVOCATE_RECOMMENDATION_MESSAGE not in content


async def test_insufficient_evidence_short_circuits_generation(
    db_client: AsyncClient, monkeypatch: pytest.MonkeyPatch, strict_sources: None
) -> None:
    generate_called = False

    async def fake_generate(*_args: object, **_kwargs: object) -> str:
        nonlocal generate_called
        generate_called = True
        return "should not be reached"

    _patch_llm(monkeypatch, retrieved=[])
    monkeypatch.setattr(llm_module, "generate_grounded_answer", fake_generate)

    resp = await db_client.post("/api/v1/chat/messages", json={"message": "What is an affidavit?"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["assistant_message"]["content"] == INSUFFICIENT_EVIDENCE_MESSAGE
    assert body["assistant_message"]["sources"] == []
    assert generate_called is False


async def test_retrieval_unavailable_falls_back_to_insufficient_evidence(
    db_client: AsyncClient, monkeypatch: pytest.MonkeyPatch, strict_sources: None
) -> None:
    from app.core.errors import ServiceUnavailableError

    async def raising_search(query: str, *, db: object, settings: object) -> list[RetrievedChunk]:
        raise ServiceUnavailableError("no key", code="embeddings_not_configured")

    async def fake_classify(message: str, *, settings: object) -> legal_classifier.Classification:
        return IT_LAW_CLASSIFICATION

    monkeypatch.setattr(legal_classifier, "classify_query", fake_classify)
    monkeypatch.setattr(retrieval_module, "hybrid_search", raising_search)

    resp = await db_client.post("/api/v1/chat/messages", json={"message": "What is an affidavit?"})
    assert resp.status_code == 200
    assert resp.json()["assistant_message"]["content"] == INSUFFICIENT_EVIDENCE_MESSAGE


async def test_no_sources_gets_a_general_answer_by_default(
    db_client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    grounded_called = False

    async def fake_grounded(*_args: object, **_kwargs: object) -> str:
        nonlocal grounded_called
        grounded_called = True
        return "should not be reached"

    _patch_llm(monkeypatch, retrieved=[])
    monkeypatch.setattr(llm_module, "generate_grounded_answer", fake_grounded)
    calls = _patch_general(monkeypatch, answer="An affidavit is a sworn statement.")

    resp = await db_client.post("/api/v1/chat/messages", json={"message": "What is an affidavit?"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["assistant_message"]["content"] == "An affidavit is a sworn statement."
    assert body["assistant_message"]["sources"] == []  # the UI labels this "general information"
    assert calls == ["What is an affidavit?"]
    assert grounded_called is False


async def test_retrieval_unavailable_still_gets_a_general_answer(
    db_client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.core.errors import ServiceUnavailableError

    async def raising_search(query: str, *, db: object, settings: object) -> list[RetrievedChunk]:
        raise ServiceUnavailableError("quota", code="embeddings_rate_limited")

    _patch_llm(monkeypatch)
    monkeypatch.setattr(retrieval_module, "hybrid_search", raising_search)
    _patch_general(monkeypatch, answer="General info.")

    resp = await db_client.post("/api/v1/chat/messages", json={"message": "What is an affidavit?"})
    assert resp.status_code == 200
    assert resp.json()["assistant_message"]["content"] == "General info."


async def test_out_of_scope_short_circuits_generation(
    db_client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    generate_called = False

    async def fake_generate(*_args: object, **_kwargs: object) -> str:
        nonlocal generate_called
        generate_called = True
        return "should not be reached"

    async def fake_classify(*_args: object, **_kwargs: object) -> legal_classifier.Classification:
        return OUT_OF_SCOPE_CLASSIFICATION

    monkeypatch.setattr(legal_classifier, "classify_query", fake_classify)
    monkeypatch.setattr(llm_module, "generate_grounded_answer", fake_generate)

    resp = await db_client.post("/api/v1/chat/messages", json={"message": "write me a poem"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["assistant_message"]["content"] == OUT_OF_SCOPE_MESSAGE
    assert body["assistant_message"]["sources"] is None
    assert body["user_message"]["is_out_of_scope"] is True
    assert generate_called is False


async def test_continuing_a_conversation_passes_history(
    db_client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    history_calls: list[list[tuple[str, str]]] = []
    _patch_llm(monkeypatch, record_history=history_calls)

    first = await db_client.post("/api/v1/chat/messages", json={"message": "What is a contract?"})
    conversation_id = first.json()["conversation_id"]

    second = await db_client.post(
        "/api/v1/chat/messages",
        json={"conversation_id": conversation_id, "message": "And an agreement?"},
    )
    assert second.status_code == 200
    assert second.json()["conversation_id"] == conversation_id

    assert len(history_calls) == 2
    assert history_calls[0] == []  # first message: no prior history
    assert len(history_calls[1]) == 2  # second message: sees the first Q&A pair


async def test_logged_in_user_conversation_is_listed(
    db_client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _patch_llm(monkeypatch)
    tokens = await _register(db_client)
    headers = {"Authorization": f"Bearer {tokens['access_token']}"}

    sent = await db_client.post(
        "/api/v1/chat/messages", json={"message": "What is an NDA?"}, headers=headers
    )
    conversation_id = sent.json()["conversation_id"]

    listing = await db_client.get("/api/v1/chat/conversations", headers=headers)
    assert listing.status_code == 200
    ids = [c["id"] for c in listing.json()]
    assert conversation_id in ids


async def test_anonymous_cannot_list_conversations(db_client: AsyncClient) -> None:
    resp = await db_client.get("/api/v1/chat/conversations")
    assert resp.status_code == 401


async def test_anonymous_conversation_is_readable_without_auth(
    db_client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _patch_llm(monkeypatch)
    sent = await db_client.post("/api/v1/chat/messages", json={"message": "What is bail?"})
    conversation_id = sent.json()["conversation_id"]

    resp = await db_client.get(f"/api/v1/chat/conversations/{conversation_id}")
    assert resp.status_code == 200
    assert len(resp.json()["messages"]) == 2


async def test_users_cannot_read_each_others_conversations(
    db_client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _patch_llm(monkeypatch)
    owner_tokens = await _register(db_client)
    owner_headers = {"Authorization": f"Bearer {owner_tokens['access_token']}"}
    sent = await db_client.post(
        "/api/v1/chat/messages", json={"message": "confidential question"}, headers=owner_headers
    )
    conversation_id = sent.json()["conversation_id"]

    other_tokens = await _register(db_client)
    other_headers = {"Authorization": f"Bearer {other_tokens['access_token']}"}

    read = await db_client.get(
        f"/api/v1/chat/conversations/{conversation_id}", headers=other_headers
    )
    assert read.status_code == 403

    reply = await db_client.post(
        "/api/v1/chat/messages",
        json={"conversation_id": conversation_id, "message": "trying to butt in"},
        headers=other_headers,
    )
    assert reply.status_code == 403


async def test_get_unknown_conversation_is_404(db_client: AsyncClient) -> None:
    resp = await db_client.get("/api/v1/chat/conversations/00000000-0000-0000-0000-000000000000")
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Streaming endpoint (Server-Sent Events)
# ---------------------------------------------------------------------------


def _parse_sse(body: str) -> list[tuple[str, dict[str, object]]]:
    import json

    events: list[tuple[str, dict[str, object]]] = []
    for block in body.strip().split("\n\n"):
        lines = dict(line.split(": ", 1) for line in block.splitlines())
        events.append((lines["event"], json.loads(lines["data"])))
    return events


def _patch_stream(
    monkeypatch: pytest.MonkeyPatch, *, deltas: list[str], fail: bool = False
) -> None:
    from app.core.errors import ServiceUnavailableError

    async def fake_stream(message: str, **_kwargs: object):  # type: ignore[no-untyped-def]
        for delta in deltas:
            yield delta
        if fail:
            raise ServiceUnavailableError("limit reached", code="llm_rate_limited")

    monkeypatch.setattr(llm_module, "stream_grounded_answer", fake_stream)


async def test_stream_emits_start_deltas_and_done_then_persists(
    db_client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _patch_llm(monkeypatch)
    _patch_stream(monkeypatch, deltas=["Section 1 ", "says X [1]."])

    resp = await db_client.post(
        "/api/v1/chat/messages/stream", json={"message": "What does the Act say?"}
    )
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/event-stream")
    events = _parse_sse(resp.text)

    assert [name for name, _ in events] == ["start", "delta", "delta", "done"]
    start = events[0][1]
    assert start["legal_category"] == "IT_LAW"
    assert start["sources"][0]["document_title"] == FAKE_CHUNK.document_title  # type: ignore[index]
    done = events[-1][1]
    assert done["assistant_message"]["content"] == "Section 1 says X [1]."  # type: ignore[index]

    # Persisted exactly like the non-streaming endpoint.
    conversation_id = done["conversation_id"]
    detail = await db_client.get(f"/api/v1/chat/conversations/{conversation_id}")
    assert [m["role"] for m in detail.json()["messages"]] == ["user", "assistant"]


async def test_stream_appends_advocate_recommendation_for_high_risk(
    db_client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _patch_llm(monkeypatch, classification=HIGH_RISK_CLASSIFICATION)
    _patch_stream(monkeypatch, deltas=["Answer."])

    resp = await db_client.post("/api/v1/chat/messages/stream", json={"message": "notice"})
    events = _parse_sse(resp.text)
    done = events[-1][1]
    assert done["assistant_message"]["content"].endswith(ADVOCATE_RECOMMENDATION_MESSAGE)  # type: ignore[index]


async def test_stream_insufficient_evidence_needs_no_generation(
    db_client: AsyncClient, monkeypatch: pytest.MonkeyPatch, strict_sources: None
) -> None:
    _patch_llm(monkeypatch, retrieved=[])
    _patch_stream(monkeypatch, deltas=["SHOULD NOT APPEAR"])

    resp = await db_client.post("/api/v1/chat/messages/stream", json={"message": "q"})
    events = _parse_sse(resp.text)
    assert events[1] == ("delta", {"text": INSUFFICIENT_EVIDENCE_MESSAGE})
    assert events[-1][0] == "done"


async def test_stream_no_sources_streams_a_general_answer(
    db_client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _patch_llm(monkeypatch, retrieved=[])
    _patch_stream(monkeypatch, deltas=["SHOULD NOT APPEAR"])

    async def fake_general_stream(message: str, **_kwargs: object):  # type: ignore[no-untyped-def]
        yield "General "
        yield "answer."

    monkeypatch.setattr(llm_module, "stream_general_answer", fake_general_stream)

    resp = await db_client.post("/api/v1/chat/messages/stream", json={"message": "q"})
    events = _parse_sse(resp.text)
    assert events[0][1]["sources"] == []
    assert [e for e in events if e[0] == "delta"] == [
        ("delta", {"text": "General "}),
        ("delta", {"text": "answer."}),
    ]
    assert events[-1][1]["assistant_message"]["content"] == "General answer."  # type: ignore[index]


async def test_stream_generation_failure_emits_error_and_persists_nothing(
    db_client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _patch_llm(monkeypatch)
    _patch_stream(monkeypatch, deltas=["partial "], fail=True)

    resp = await db_client.post("/api/v1/chat/messages/stream", json={"message": "q"})
    events = _parse_sse(resp.text)
    assert events[-1] == ("error", {"code": "llm_rate_limited", "message": "limit reached"})
    conversation_id = events[0][1]["conversation_id"]
    detail = await db_client.get(f"/api/v1/chat/conversations/{conversation_id}")
    assert detail.status_code == 404


async def test_stream_without_provider_returns_json_503(db_client: AsyncClient) -> None:
    resp = await db_client.post("/api/v1/chat/messages/stream", json={"message": "q"})
    assert resp.status_code == 503
    assert resp.json()["error"]["code"] == "llm_not_configured"


# ---------------------------------------------------------------------------
# Status endpoint
# ---------------------------------------------------------------------------


async def test_status_reports_real_counts_and_no_secrets(db_client: AsyncClient) -> None:
    resp = await db_client.get("/api/v1/status")
    assert resp.status_code == 200
    body = resp.json()
    assert body["llm"] == {
        "configured": False,
        "provider": None,
        "model": None,
        "is_free_tier": None,
        "last_call_ok": None,
        "last_call_at": None,
        "last_error_code": None,
        "last_error_message": None,
    }
    assert body["embeddings"]["configured"] is False
    kb = body["knowledge_base"]
    assert kb["available"] is True
    assert kb["documents_indexed"] >= 0
    assert body["advocate_directory"]["available"] is True
    assert body["features"] == {"open_login": False, "general_answers": True}
    assert "generated_at" in body


# ---------------------------------------------------------------------------
# AI connection check
# ---------------------------------------------------------------------------


async def test_check_llm_reports_not_configured(client: AsyncClient) -> None:
    resp = await client.post("/api/v1/status/check-llm")
    assert resp.status_code == 200
    body = resp.json()
    assert body["ok"] is False
    assert body["error_code"] == "llm_not_configured"


async def test_check_llm_reports_success(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.api.v1.routes import meta

    class _Provider:
        name = "gemini"
        model = "gemini-flash-latest"

        async def complete(self, **_kwargs: object) -> str:
            return "OK"

    monkeypatch.setattr(meta, "get_provider", lambda settings: _Provider())
    resp = await client.post("/api/v1/status/check-llm")
    body = resp.json()
    assert body["ok"] is True
    assert body["provider"] == "gemini"
    assert body["latency_ms"] is not None
