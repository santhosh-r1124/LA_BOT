"""Unit tests for app.services.llm_provider — provider selection, the
OpenAI-compatible HTTP client (Groq/Ollama) against a mock transport, Gemini
response handling with a fake SDK client, and error normalisation. No
network, no real keys.
"""

from __future__ import annotations

import json
from typing import Any

import httpx
import pytest

from app.core.config import Settings
from app.core.errors import ServiceUnavailableError
from app.services import llm_provider
from app.services.llm_provider import (
    GeminiProvider,
    OpenAICompatibleProvider,
    describe_provider,
    get_provider,
)


def _settings(**overrides: Any) -> Settings:
    base: dict[str, Any] = {
        "llm_provider": "auto",
        "anthropic_api_key": None,
        "gemini_api_key": None,
        "groq_api_key": None,
        "ollama_base_url": None,
    }
    base.update(overrides)
    return Settings(**base)


# ---------------------------------------------------------------------------
# Selection
# ---------------------------------------------------------------------------


def test_auto_with_nothing_configured_raises_not_configured() -> None:
    with pytest.raises(ServiceUnavailableError) as exc_info:
        get_provider(_settings())
    assert exc_info.value.code == "llm_not_configured"
    assert "GEMINI_API_KEY" in exc_info.value.message


def test_auto_prefers_free_providers_over_anthropic() -> None:
    settings = _settings(anthropic_api_key="a", groq_api_key="g")
    assert get_provider(settings).name == "groq"
    assert describe_provider(settings).is_free_tier is True


def test_auto_picks_gemini_first() -> None:
    settings = _settings(gemini_api_key="k", groq_api_key="g")
    info = describe_provider(settings)
    assert info.provider == "gemini"
    assert info.model == settings.gemini_llm_model


def test_auto_falls_back_to_ollama_then_anthropic() -> None:
    assert get_provider(_settings(ollama_base_url="http://x:11434/v1")).name == "ollama"
    assert get_provider(_settings(anthropic_api_key="a")).name == "anthropic"
    assert describe_provider(_settings(anthropic_api_key="a")).is_free_tier is False


def test_explicit_provider_without_its_key_is_not_configured() -> None:
    settings = _settings(llm_provider="groq", gemini_api_key="k")
    with pytest.raises(ServiceUnavailableError) as exc_info:
        get_provider(settings)
    assert "GROQ_API_KEY" in exc_info.value.message
    info = describe_provider(settings)
    assert info.configured is False
    assert info.model is None


def test_describe_provider_never_exposes_keys() -> None:
    info = describe_provider(_settings(groq_api_key="super-secret"))
    assert "super-secret" not in repr(info)


# ---------------------------------------------------------------------------
# OpenAI-compatible (Groq / Ollama)
# ---------------------------------------------------------------------------


def _openai_provider(handler: Any, *, model: str = "llama-test") -> OpenAICompatibleProvider:
    return OpenAICompatibleProvider(
        name="groq",
        base_url="https://api.example.test/v1/",
        model=model,
        api_key="k",
        timeout_seconds=5,
        transport=httpx.MockTransport(handler),
    )


async def test_openai_complete_sends_system_and_history() -> None:
    seen: dict[str, Any] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["auth"] = request.headers.get("authorization")
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, json={"choices": [{"message": {"content": " Answer [1]. "}}]})

    provider = _openai_provider(handler)
    text = await provider.complete(
        system="SYS", messages=[("user", "q1"), ("assistant", "a1"), ("user", "q2")], max_tokens=50
    )

    assert text == "Answer [1]."
    assert seen["url"] == "https://api.example.test/v1/chat/completions"
    assert seen["auth"] == "Bearer k"
    assert seen["body"]["messages"][0] == {"role": "system", "content": "SYS"}
    assert [m["role"] for m in seen["body"]["messages"][1:]] == ["user", "assistant", "user"]
    assert "reasoning_effort" not in seen["body"]


async def test_openai_gpt_oss_models_get_low_reasoning_effort() -> None:
    seen: dict[str, Any] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen.update(json.loads(request.content))
        return httpx.Response(200, json={"choices": [{"message": {"content": "ok"}}]})

    await _openai_provider(handler, model="openai/gpt-oss-120b").complete(
        system="s", messages=[("user", "q")], max_tokens=10
    )
    assert seen["reasoning_effort"] == "low"


async def test_openai_stream_parses_sse_deltas() -> None:
    lines = [
        'data: {"choices":[{"delta":{"role":"assistant"}}]}',
        'data: {"choices":[{"delta":{"content":"Hel"}}]}',
        "",
        'data: {"choices":[{"delta":{"content":"lo"}}]}',
        "data: not-json",
        "data: [DONE]",
        'data: {"choices":[{"delta":{"content":"IGNORED"}}]}',
    ]

    def handler(request: httpx.Request) -> httpx.Response:
        assert json.loads(request.content)["stream"] is True
        return httpx.Response(200, text="\n".join(lines))

    chunks = [
        c async for c in _openai_provider(handler).stream(system="s", messages=[], max_tokens=5)
    ]
    assert chunks == ["Hel", "lo"]


async def test_openai_complete_json_extracts_object_and_requests_json_mode() -> None:
    seen: dict[str, Any] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen.update(json.loads(request.content))
        content = 'Sure! ```json\n{"category": "IT_LAW", "risk_level": "LOW"}\n```'
        return httpx.Response(200, json={"choices": [{"message": {"content": content}}]})

    data = await _openai_provider(handler).complete_json(
        system="classify", message="m", schema={"type": "object"}, schema_name="x", max_tokens=10
    )
    assert data == {"category": "IT_LAW", "risk_level": "LOW"}
    assert seen["response_format"] == {"type": "json_object"}
    assert "JSON Schema" in seen["messages"][0]["content"]


async def test_openai_complete_json_returns_empty_dict_for_garbage() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"choices": [{"message": {"content": "no json here"}}]})

    data = await _openai_provider(handler).complete_json(
        system="s", message="m", schema={}, schema_name="x", max_tokens=10
    )
    assert data == {}


async def test_openai_429_maps_to_rate_limited() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(429, json={"error": {"message": "slow down"}})

    with pytest.raises(ServiceUnavailableError) as exc_info:
        await _openai_provider(handler).complete(system="s", messages=[], max_tokens=5)
    assert exc_info.value.code == "llm_rate_limited"
    assert "slow down" not in exc_info.value.message  # provider detail stays in logs


async def test_openai_500_and_malformed_bodies_map_to_llm_error() -> None:
    def server_error(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, text="boom")

    def malformed(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, text="<html>not json</html>")

    for handler in (server_error, malformed):
        with pytest.raises(ServiceUnavailableError) as exc_info:
            await _openai_provider(handler).complete(system="s", messages=[], max_tokens=5)
        assert exc_info.value.code == "llm_error"


async def test_openai_stream_error_maps_to_service_unavailable() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(503, text="unavailable")

    with pytest.raises(ServiceUnavailableError) as exc_info:
        async for _ in _openai_provider(handler).stream(system="s", messages=[], max_tokens=5):
            pass
    assert exc_info.value.code == "llm_error"


# ---------------------------------------------------------------------------
# Gemini (fake SDK client)
# ---------------------------------------------------------------------------


class _FakeGeminiResponse:
    def __init__(self, text: str | None) -> None:
        self.text = text


class _FakeGeminiModels:
    def __init__(self, *, text: str | None = None, error: Exception | None = None) -> None:
        self.text = text
        self.error = error
        self.calls: list[dict[str, Any]] = []

    async def generate_content(self, **kwargs: Any) -> _FakeGeminiResponse:
        self.calls.append(kwargs)
        if self.error:
            raise self.error
        return _FakeGeminiResponse(self.text)

    async def generate_content_stream(self, **kwargs: Any) -> Any:
        self.calls.append(kwargs)
        if self.error:
            raise self.error

        async def gen() -> Any:
            for part in ["Grounded ", None, "answer."]:
                yield _FakeGeminiResponse(part)

        return gen()


def _gemini(models: _FakeGeminiModels) -> GeminiProvider:
    provider = GeminiProvider(api_key="k", model="gemini-test", timeout_seconds=5)

    class _Aio:
        pass

    class _Client:
        aio = _Aio()

    _Client.aio.models = models  # type: ignore[attr-defined]
    provider._client = _Client()  # type: ignore[assignment]
    return provider


async def test_gemini_complete_maps_roles_and_system_instruction() -> None:
    models = _FakeGeminiModels(text=" hi ")
    text = await _gemini(models).complete(
        system="SYS", messages=[("user", "q"), ("assistant", "a"), ("user", "q2")], max_tokens=100
    )
    assert text == "hi"
    call = models.calls[0]
    assert [c.role for c in call["contents"]] == ["user", "model", "user"]
    assert call["config"].system_instruction == "SYS"
    assert call["config"].max_output_tokens > 100  # thinking headroom


async def test_gemini_stream_skips_empty_chunks() -> None:
    chunks = [
        c
        async for c in _gemini(_FakeGeminiModels()).stream(
            system="s", messages=[("user", "q")], max_tokens=10
        )
    ]
    assert chunks == ["Grounded ", "answer."]


async def test_gemini_complete_json_uses_response_schema() -> None:
    models = _FakeGeminiModels(text='{"category": "IP_LAW"}')
    data = await _gemini(models).complete_json(
        system="s", message="m", schema={"type": "object"}, schema_name="x", max_tokens=10
    )
    assert data == {"category": "IP_LAW"}
    config = models.calls[0]["config"]
    assert config.response_mime_type == "application/json"
    assert config.response_json_schema == {"type": "object"}


async def test_gemini_resource_exhausted_maps_to_rate_limited() -> None:
    models = _FakeGeminiModels(error=RuntimeError("429 RESOURCE_EXHAUSTED quota"))
    with pytest.raises(ServiceUnavailableError) as exc_info:
        await _gemini(models).complete(system="s", messages=[("user", "q")], max_tokens=10)
    assert exc_info.value.code == "llm_rate_limited"


def test_parse_json_object_handles_non_objects() -> None:
    assert llm_provider._parse_json_object("[1, 2]") == {}
    assert llm_provider._parse_json_object('{"a": 1} trailing') == {"a": 1}
    assert llm_provider._parse_json_object("{broken") == {}


# ---------------------------------------------------------------------------
# Gemini model fallback + failure classification
# ---------------------------------------------------------------------------


def _google_error(code: int, status: str, message: str, reason: str | None = None) -> Exception:
    from google.genai import errors

    error: dict[str, Any] = {"code": code, "message": message, "status": status}
    if reason:
        error["details"] = [{"reason": reason}]
    return errors.ClientError(code, {"error": error})


_NOT_FOUND = _google_error(404, "NOT_FOUND", "models/x is not found for API version v1beta")
_BAD_KEY = _google_error(
    400, "INVALID_ARGUMENT", "API key not valid. Please pass a valid API key.", "API_KEY_INVALID"
)
_NO_THINKING = _google_error(
    400, "INVALID_ARGUMENT", "Thinking level is not supported for this model."
)
_QUOTA = _google_error(429, "RESOURCE_EXHAUSTED", "You exceeded your current quota.")


class _ScriptedGeminiModels:
    """Fails per (model, thinking) as scripted, otherwise answers."""

    def __init__(self, failures: dict[tuple[str, bool], Exception]) -> None:
        self.failures = failures
        self.calls: list[tuple[str, bool]] = []

    def _check(self, kwargs: dict[str, Any]) -> None:
        key = (kwargs["model"], kwargs["config"].thinking_config is not None)
        self.calls.append(key)
        if key in self.failures:
            raise self.failures[key]

    async def generate_content(self, **kwargs: Any) -> _FakeGeminiResponse:
        self._check(kwargs)
        return _FakeGeminiResponse(f"answer from {kwargs['model']}")

    async def generate_content_stream(self, **kwargs: Any) -> Any:
        self._check(kwargs)

        async def gen() -> Any:
            yield _FakeGeminiResponse(f"streamed from {kwargs['model']}")

        return gen()


def _scripted(models: _ScriptedGeminiModels, model: str = "gemini-3.5-flash") -> GeminiProvider:
    provider = _gemini(models)  # type: ignore[arg-type]
    provider.model = model
    return provider


@pytest.fixture(autouse=True)
def _reset_gemini_memory() -> Any:
    GeminiProvider._resolved.clear()
    yield
    GeminiProvider._resolved.clear()


async def test_gemini_falls_back_when_model_is_retired() -> None:
    models = _ScriptedGeminiModels(
        {("gemini-3.5-flash", True): _NOT_FOUND, ("gemini-3.5-flash", False): _NOT_FOUND}
    )
    text = await _scripted(models).complete(system="s", messages=[("user", "q")], max_tokens=10)
    assert text == "answer from gemini-flash-latest"
    # A 404 skips the model entirely — no second (no-thinking) attempt on it.
    assert models.calls == [("gemini-3.5-flash", True), ("gemini-flash-latest", True)]

    # The working model is remembered for the next request.
    models.calls.clear()
    await _scripted(models).complete(system="s", messages=[("user", "q")], max_tokens=10)
    assert models.calls == [("gemini-flash-latest", True)]


async def test_gemini_retries_without_thinking_when_unsupported() -> None:
    models = _ScriptedGeminiModels({("gemini-3.5-flash", True): _NO_THINKING})
    text = await _scripted(models).complete(system="s", messages=[("user", "q")], max_tokens=10)
    assert text == "answer from gemini-3.5-flash"
    assert models.calls == [("gemini-3.5-flash", True), ("gemini-3.5-flash", False)]


async def test_gemini_2x_models_never_get_thinking_level() -> None:
    models = _ScriptedGeminiModels({})
    await _scripted(models, model="gemini-2.5-flash").complete(
        system="s", messages=[("user", "q")], max_tokens=10
    )
    assert models.calls == [("gemini-2.5-flash", False)]


async def test_gemini_bad_key_fails_fast_with_specific_message() -> None:
    models = _ScriptedGeminiModels({("gemini-3.5-flash", True): _BAD_KEY})
    with pytest.raises(ServiceUnavailableError) as exc_info:
        await _scripted(models).complete(system="s", messages=[("user", "q")], max_tokens=10)
    assert exc_info.value.code == "llm_auth_failed"
    assert "GEMINI_API_KEY" in exc_info.value.message
    assert models.calls == [("gemini-3.5-flash", True)]  # no pointless fallback attempts


async def test_gemini_quota_on_primary_uses_fallback_but_does_not_pin_it() -> None:
    models = _ScriptedGeminiModels({("gemini-3.5-flash", True): _QUOTA})
    text = await _scripted(models).complete(system="s", messages=[("user", "q")], max_tokens=10)
    assert text == "answer from gemini-flash-latest"
    assert GeminiProvider._resolved == {}


async def test_gemini_all_models_unavailable_lists_what_was_tried() -> None:
    models = _ScriptedGeminiModels(
        {
            (m, t): _NOT_FOUND
            for m in (
                "gemini-3.5-flash",
                "gemini-flash-latest",
                "gemini-2.5-flash",
                "gemini-flash-lite-latest",
            )
            for t in (True, False)
        }
    )
    with pytest.raises(ServiceUnavailableError) as exc_info:
        await _scripted(models).complete(system="s", messages=[("user", "q")], max_tokens=10)
    assert exc_info.value.code == "llm_model_unavailable"
    assert "gemini-flash-latest" in exc_info.value.message


async def test_gemini_stream_falls_back_before_first_chunk() -> None:
    models = _ScriptedGeminiModels({("gemini-3.5-flash", True): _NOT_FOUND})
    chunks = [
        c
        async for c in _scripted(models).stream(system="s", messages=[("user", "q")], max_tokens=5)
    ]
    assert chunks == ["streamed from gemini-flash-latest"]


async def test_gemini_complete_json_falls_back_too() -> None:
    models = _ScriptedGeminiModels({("gemini-3.5-flash", True): _NOT_FOUND})
    data = await _scripted(models).complete_json(
        system="s", message="m", schema={"type": "object"}, schema_name="x", max_tokens=10
    )
    assert data == {}  # "answer from ..." isn't JSON; the point is it didn't raise


@pytest.mark.parametrize(
    ("exc", "kind"),
    [
        (_BAD_KEY, "auth"),
        (_NOT_FOUND, "model_unavailable"),
        (_NO_THINKING, "thinking_unsupported"),
        (_QUOTA, "rate_limited"),
        (
            _google_error(403, "PERMISSION_DENIED", "Generative Language API has not been used"),
            "permission",
        ),
        (
            _google_error(
                400, "FAILED_PRECONDITION", "User location is not supported for the API use."
            ),
            "region",
        ),
        (httpx.ConnectError("boom"), "unreachable"),
        (httpx.ReadTimeout("slow"), "timeout"),
        (RuntimeError("simulated transport failure"), "error"),
    ],
)
def test_classify_failure(exc: Exception, kind: str) -> None:
    from app.services.llm_provider import classify_failure

    assert classify_failure(exc) == kind


async def test_provider_health_records_last_outcome() -> None:
    from app.services.llm_provider import provider_health

    models = _ScriptedGeminiModels({("gemini-3.5-flash", True): _BAD_KEY})
    with pytest.raises(ServiceUnavailableError):
        await _scripted(models).complete(system="s", messages=[("user", "q")], max_tokens=10)
    health = provider_health()
    assert health is not None and health.ok is False and health.error_code == "llm_auth_failed"

    models.failures.clear()
    await _scripted(models).complete(system="s", messages=[("user", "q")], max_tokens=10)
    health = provider_health()
    assert health is not None and health.ok is True and health.model == "gemini-3.5-flash"


async def test_gemini_complete_json_retries_without_schema_on_unclassified_errors() -> None:
    schema_rejected = _google_error(400, "INVALID_ARGUMENT", "Invalid value at 'response_schema'")

    class _SchemaPickyModels(_ScriptedGeminiModels):
        async def generate_content(self, **kwargs: Any) -> _FakeGeminiResponse:
            self.calls.append((kwargs["model"], kwargs["config"].response_json_schema is not None))
            if kwargs["config"].response_json_schema is not None:
                raise schema_rejected
            return _FakeGeminiResponse('{"category": "IP_LAW"}')

    models = _SchemaPickyModels({})
    data = await _scripted(models).complete_json(
        system="s", message="m", schema={"type": "object"}, schema_name="x", max_tokens=10
    )
    assert data == {"category": "IP_LAW"}
    assert models.calls == [("gemini-3.5-flash", True), ("gemini-3.5-flash", False)]
