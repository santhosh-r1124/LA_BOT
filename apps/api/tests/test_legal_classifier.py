"""Unit tests for app.services.legal_classifier — no database, no real network
calls. Classification + risk scoring share one forced tool call (Phase 5); see
docs/adr/0008-risk-scoring.md for why they weren't split into two.

With no provider configured, or when the provider call fails, the deterministic
rules classifier (app.services.rules_classifier, tested in
tests/test_rules_classifier.py) answers instead.
"""

from __future__ import annotations

import pytest

from app.core.config import Settings
from app.core.errors import ServiceUnavailableError
from app.services import anthropic_client, legal_classifier, rules_classifier

# Every provider unset -> "auto" resolves to nothing -> llm_not_configured.
UNCONFIGURED = Settings(
    llm_provider="auto",
    anthropic_api_key=None,
    gemini_api_key=None,
    groq_api_key=None,
    ollama_base_url=None,
)
# These tests drive the Anthropic provider with a fake SDK client; the other
# providers are covered in tests/test_llm_provider.py.
CONFIGURED = Settings(llm_provider="anthropic", anthropic_api_key="fake-key-for-tests")


class _FakeToolUseBlock:
    type = "tool_use"

    def __init__(self, name: str, input_data: dict[str, object]) -> None:
        self.name = name
        self.input = input_data


class _FakeTextBlock:
    type = "text"

    def __init__(self, text: str) -> None:
        self.text = text


class _FakeMessages:
    def __init__(self, response: object) -> None:
        self._response = response

    async def create(self, **_kwargs: object) -> object:
        return self._response


class _FakeClient:
    def __init__(self, response: object) -> None:
        self.messages = _FakeMessages(response)


class _FakeResponse:
    def __init__(self, content: list[object]) -> None:
        self.content = content


class _RaisingMessages:
    async def create(self, **_kwargs: object) -> object:
        raise RuntimeError("simulated transport failure")


class _RaisingClient:
    def __init__(self) -> None:
        self.messages = _RaisingMessages()


def _tool_response(**overrides: object) -> _FakeResponse:
    data: dict[str, object] = {
        "category": "IT_LAW",
        "jurisdiction_scope": "CENTRAL",
        "risk_level": "LOW",
        "is_out_of_scope": False,
        **overrides,
    }
    return _FakeResponse([_FakeToolUseBlock("classify_legal_query", data)])


# ---------------------------------------------------------------------------
# Not configured (no ANTHROPIC_API_KEY) — the "build now, key later" path.
# ---------------------------------------------------------------------------


async def test_classify_query_uses_rules_when_not_configured() -> None:
    question = "What are my legal options if my employer has not paid my salary for several months?"
    result = await legal_classifier.classify_query(question, settings=UNCONFIGURED)
    assert result == rules_classifier.classify(question)
    assert result.category == "EMPLOYMENT_LAW"
    assert result.risk_level == "HIGH"
    assert result.is_out_of_scope is False


# ---------------------------------------------------------------------------
# Response parsing (client swapped for a fake — no network, no API key needed)
# ---------------------------------------------------------------------------


async def test_classify_query_parses_tool_response(monkeypatch: pytest.MonkeyPatch) -> None:
    response = _tool_response(category="IT_LAW", jurisdiction_scope="CENTRAL", risk_level="LOW")
    monkeypatch.setattr(anthropic_client, "get_client", lambda settings: _FakeClient(response))

    result = await legal_classifier.classify_query("What is the IT Act, 2000?", settings=CONFIGURED)

    assert result.category == "IT_LAW"
    assert result.jurisdiction_scope == "CENTRAL"
    assert result.risk_level == "LOW"
    assert result.is_out_of_scope is False


async def test_classify_query_parses_high_risk(monkeypatch: pytest.MonkeyPatch) -> None:
    response = _tool_response(
        category="ADVOCATE_REQUIRED", risk_level="CRITICAL", jurisdiction_scope="COURT"
    )
    monkeypatch.setattr(anthropic_client, "get_client", lambda settings: _FakeClient(response))

    result = await legal_classifier.classify_query("I've been arrested", settings=CONFIGURED)

    assert result.risk_level == "CRITICAL"


async def test_classify_query_falls_back_on_invalid_enum_values(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    response = _tool_response(
        category="NOT_A_REAL_CATEGORY", jurisdiction_scope="MARS", risk_level="EXTREME"
    )
    monkeypatch.setattr(anthropic_client, "get_client", lambda settings: _FakeClient(response))

    result = await legal_classifier.classify_query("gibberish", settings=CONFIGURED)

    assert result.category == "OUT_OF_SCOPE"
    assert result.jurisdiction_scope == "UNKNOWN"
    # No "unknown" risk value exists — falls back to the conservative side
    # (recommend an advocate) rather than silently dropping the signal.
    assert result.risk_level == "HIGH"


async def test_classify_query_fails_safe_when_tool_not_called(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    response = _FakeResponse([_FakeTextBlock("I'd rather just chat.")])
    monkeypatch.setattr(anthropic_client, "get_client", lambda settings: _FakeClient(response))

    result = await legal_classifier.classify_query("hi", settings=CONFIGURED)

    assert result.is_out_of_scope is True
    assert result.risk_level == "HIGH"


async def test_classify_query_falls_back_to_rules_on_a_provider_outage(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # A classification outage must not break chat: the transport failure is
    # normalised to a ServiceUnavailableError (llm_error) and the rules answer.
    monkeypatch.setattr(anthropic_client, "get_client", lambda settings: _RaisingClient())
    result = await legal_classifier.classify_query("I have been arrested", settings=CONFIGURED)
    assert result.category == "CRIMINAL_LAW"
    assert result.risk_level == "CRITICAL"


async def test_classify_query_falls_back_to_rules_on_any_service_unavailable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class _RateLimited:
        name = "fake"
        model = "fake"

        async def complete_json(self, **_kwargs: object) -> dict[str, object]:
            raise ServiceUnavailableError("limit reached", code="llm_rate_limited")

    monkeypatch.setattr(legal_classifier, "get_provider", lambda settings: _RateLimited())
    result = await legal_classifier.classify_query("What is GST?", settings=CONFIGURED)
    assert (result.category, result.risk_level) == ("TAX_LAW", "LOW")


async def test_classifier_logs_never_contain_the_message(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    events: list[dict[str, object]] = []

    def capture(event: str, **kwargs: object) -> None:
        events.append({"event": event, **kwargs})

    monkeypatch.setattr(legal_classifier.logger, "info", capture)
    monkeypatch.setattr(legal_classifier.logger, "warning", capture)
    secret = "my landlord Mr Zxqv Plumtree is refusing to return my deposit"
    await legal_classifier.classify_query(secret, settings=UNCONFIGURED)

    assert events
    assert all(str(e["event"]).startswith("classifier_") for e in events)
    assert "Plumtree" not in str(events)
