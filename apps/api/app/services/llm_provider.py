"""Chat-model provider abstraction.

Every caller that needs a language model — the query classifier
(`legal_classifier.py`), grounded chat answers (`llm.py`) and document drafts
(`document_assistant/generation.py`) — goes through :func:`get_provider`
instead of a vendor SDK directly. That lets the platform run entirely on free
providers and swap between them with one environment variable
(``LLM_PROVIDER``) instead of a code change.

Providers:

* ``gemini``    Google AI Studio free tier. Reuses ``GEMINI_API_KEY`` — the
                same key the knowledge base already needs for embeddings, so
                one free key runs the whole platform.
* ``groq``      GroqCloud free tier, OpenAI-compatible HTTP API.
* ``ollama``    A local open-source model through Ollama's OpenAI-compatible
                endpoint. No key, no cost, no data leaves the machine.
* ``anthropic`` Claude. Paid; optional; kept for teams that already have a key.

``auto`` (the default) picks the first *configured* provider in that order,
free ones first.

Each provider implements three operations:

* :meth:`LLMProvider.complete` — one full response.
* :meth:`LLMProvider.stream`   — the same, yielded incrementally (chat UI).
* :meth:`LLMProvider.complete_json` — a JSON object matching a schema
  (classification). Callers still validate every field; nothing returned
  here is trusted blindly.

Failures are normalised to :class:`~app.core.errors.ServiceUnavailableError`
with stable codes (``llm_not_configured``, ``llm_rate_limited``,
``llm_error``) so the API and UI can explain what happened without leaking
provider internals.
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, ClassVar, Protocol

import httpx

from app.core.config import Settings
from app.core.errors import ServiceUnavailableError
from app.core.logging import get_logger

logger = get_logger("app.llm_provider")

ChatTurn = tuple[str, str]  # (role: "user" | "assistant", content)

_UNAVAILABLE_MESSAGE = "Could not reach the legal assistant. Please try again shortly."
_RATE_LIMITED_MESSAGE = (
    "The AI service's free-tier usage limit has been reached. Please wait a minute and try again."
)
_EMPTY_MESSAGE = "The assistant returned an empty response. Please try again."

_KEY_SETTING = {
    "gemini": "GEMINI_API_KEY",
    "groq": "GROQ_API_KEY",
    "anthropic": "ANTHROPIC_API_KEY",
    "ollama": "OLLAMA_BASE_URL",
}


# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------


def _status_code(exc: BaseException) -> int | None:
    response = getattr(exc, "response", None)
    for value in (
        getattr(exc, "status_code", None),
        getattr(exc, "code", None),
        getattr(response, "status_code", None),
    ):
        if isinstance(value, int):
            return value
        if isinstance(value, str) and value.isdigit():
            return int(value)
    return None


_UNREACHABLE_HINTS = (
    "connection refused",
    "connection error",
    "connection reset",
    "connecterror",
    "name or service not known",
    "temporary failure in name resolution",
    "nodename nor servname",
    "network is unreachable",
)
_MODEL_GONE_HINTS = (
    "not found",
    "not supported",
    "no longer available",
    "deprecated",
    "unsupported",
)


def classify_failure(exc: BaseException) -> str:
    """Bucket an SDK/transport exception into a stable failure kind."""
    status = _status_code(exc)
    api_status = str(getattr(exc, "status", "") or "").upper()
    text = f"{getattr(exc, 'message', '') or ''} {exc}".lower()
    if status == 429 or api_status == "RESOURCE_EXHAUSTED" or "resource_exhausted" in text:
        return "rate_limited"
    if "429" in text or "rate limit" in text:
        return "rate_limited"
    if status == 401 or any(
        hint in text
        for hint in ("api key not valid", "api_key_invalid", "invalid api key", "api key expired")
    ):
        return "auth"
    if "user location is not supported" in text:
        return "region"
    if status == 403 or api_status == "PERMISSION_DENIED":
        return "permission"
    if status == 404 or api_status == "NOT_FOUND":
        return "model_unavailable"
    if status == 400 and "thinking" in text:
        return "thinking_unsupported"
    if status == 400 and "model" in text and any(h in text for h in _MODEL_GONE_HINTS):
        return "model_unavailable"
    if isinstance(exc, httpx.TimeoutException | TimeoutError) or "timed out" in text:
        return "timeout"
    if isinstance(exc, httpx.TransportError) or any(h in text for h in _UNREACHABLE_HINTS):
        return "unreachable"
    return "error"


def _failure_details(kind: str, *, provider: str, models: Sequence[str] = ()) -> tuple[str, str]:
    key = _KEY_SETTING.get(provider, "the provider API key")
    if kind == "rate_limited":
        return "llm_rate_limited", _RATE_LIMITED_MESSAGE
    if kind == "auth":
        return (
            "llm_auth_failed",
            f"The AI service rejected the server's API key. Check {key} in the server settings.",
        )
    if kind == "permission":
        return (
            "llm_permission_denied",
            f"The AI service refused access for the server's API key. Check that {key} is "
            "active and allowed to use the configured model.",
        )
    if kind == "model_unavailable":
        tried = f" (tried: {', '.join(models)})" if models else ""
        return (
            "llm_model_unavailable",
            f"The configured AI model isn't available for the server's API key{tried}.",
        )
    if kind == "region":
        return "llm_region_unsupported", "The AI service isn't available from the server's region."
    if kind == "timeout":
        return "llm_timeout", "The AI service took too long to respond. Please try again."
    if kind == "unreachable":
        return (
            "llm_unreachable",
            "The server couldn't connect to the AI service. Please try again shortly.",
        )
    return "llm_error", _UNAVAILABLE_MESSAGE


def provider_error(
    exc: BaseException, *, provider: str, operation: str, models: Sequence[str] = ()
) -> ServiceUnavailableError:
    """Map any SDK/transport exception to a user-safe error. The raw message
    is logged server-side only (it can contain request details)."""
    kind = classify_failure(exc)
    logger.warning(
        "llm_provider_failed",
        provider=provider,
        operation=operation,
        kind=kind,
        error_type=type(exc).__name__,
        error=str(exc)[:500],
    )
    code, message = _failure_details(kind, provider=provider, models=models)
    _record_failure(provider, code, message)
    return ServiceUnavailableError(message, code=code)


# ---------------------------------------------------------------------------
# Health: the outcome of the most recent real call, for the status API. No
# probe requests -- those would spend free-tier quota on every page view.
# ---------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class ProviderHealth:
    ok: bool
    provider: str
    model: str | None
    error_code: str | None
    error_message: str | None
    at: datetime


_last_outcome: ProviderHealth | None = None


def _record_success(provider: str, model: str) -> None:
    global _last_outcome
    _last_outcome = ProviderHealth(
        ok=True,
        provider=provider,
        model=model,
        error_code=None,
        error_message=None,
        at=datetime.now(UTC),
    )


def _record_failure(provider: str, code: str, message: str) -> None:
    global _last_outcome
    _last_outcome = ProviderHealth(
        ok=False,
        provider=provider,
        model=None,
        error_code=code,
        error_message=message,
        at=datetime.now(UTC),
    )


def provider_health() -> ProviderHealth | None:
    return _last_outcome


# ---------------------------------------------------------------------------
# Interface
# ---------------------------------------------------------------------------


class LLMProvider(Protocol):
    name: str
    model: str

    async def complete(
        self, *, system: str, messages: Sequence[ChatTurn], max_tokens: int
    ) -> str: ...

    def stream(
        self, *, system: str, messages: Sequence[ChatTurn], max_tokens: int
    ) -> AsyncIterator[str]: ...

    async def complete_json(
        self,
        *,
        system: str,
        message: str,
        schema: dict[str, Any],
        schema_name: str,
        max_tokens: int,
    ) -> dict[str, Any]: ...


@dataclass(frozen=True, slots=True)
class ProviderInfo:
    """Public, secret-free description of the active provider (status API)."""

    configured: bool
    provider: str | None
    model: str | None
    is_free_tier: bool | None


_FREE = {"gemini": True, "groq": True, "ollama": True, "anthropic": False}


def _parse_json_object(text: str) -> dict[str, Any]:
    """Models sometimes wrap JSON in prose or code fences; take the outermost
    object. Anything unparsable becomes ``{}`` and the caller's own
    validation falls back to its safe defaults."""
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end <= start:
        return {}
    try:
        value = json.loads(text[start : end + 1])
    except json.JSONDecodeError:
        return {}
    return value if isinstance(value, dict) else {}


def _json_instruction(schema: dict[str, Any]) -> str:
    return (
        "\n\nRespond with ONLY a single JSON object (no prose, no code fences) "
        f"that validates against this JSON Schema:\n{json.dumps(schema)}"
    )


# ---------------------------------------------------------------------------
# Google Gemini (free tier)
# ---------------------------------------------------------------------------


# Tried after the configured model when Google can't serve it (retired or
# renamed model, unsupported setting, or that model's free-tier quota is used
# up -- quotas are per model). The ``-latest`` aliases follow Google's current
# release, so they keep working when a numbered model is retired.
GEMINI_FALLBACK_MODELS = ("gemini-flash-latest", "gemini-2.5-flash", "gemini-flash-lite-latest")


def _supports_thinking_level(model: str) -> bool:
    """``thinking_level`` arrived with Gemini 3; 1.x/2.x models reject it."""
    return not model.startswith(("gemini-1", "gemini-2"))


class GeminiProvider:
    name = "gemini"

    # Gemini "thinking" tokens are billed against max_output_tokens. Give the
    # model headroom so a low-effort thought pass can't truncate the answer.
    _THINKING_HEADROOM_TOKENS = 1024

    # Providers are rebuilt per request; remember which (model, thinking)
    # combination last worked for each configured model so later requests
    # skip the attempts that are known to fail.
    _resolved: ClassVar[dict[str, tuple[str, bool]]] = {}

    def __init__(
        self,
        *,
        api_key: str,
        model: str,
        timeout_seconds: float,
        fallback_models: Sequence[str] = GEMINI_FALLBACK_MODELS,
    ) -> None:
        from google import genai
        from google.genai import types

        self.model = model
        self._fallback_models = tuple(fallback_models)
        self._types = types
        self._client = genai.Client(
            api_key=api_key,
            http_options=types.HttpOptions(timeout=int(timeout_seconds * 1000)),
        )

    def _models(self) -> list[str]:
        return list(dict.fromkeys([self.model, *self._fallback_models]))

    def _attempts(self) -> list[tuple[str, bool]]:
        attempts: list[tuple[str, bool]] = []
        if resolved := self._resolved.get(self.model):
            attempts.append(resolved)
        for model in self._models():
            for thinking in (True, False) if _supports_thinking_level(model) else (False,):
                if (model, thinking) not in attempts:
                    attempts.append((model, thinking))
        return attempts

    def _contents(self, messages: Sequence[ChatTurn]) -> list[Any]:
        types = self._types
        return [
            types.Content(
                role="model" if role == "assistant" else "user",
                parts=[types.Part(text=content)],
            )
            for role, content in messages
        ]

    def _config(self, *, system: str, max_tokens: int, thinking: bool, **extra: Any) -> Any:
        types = self._types
        if thinking:
            extra["thinking_config"] = types.ThinkingConfig(thinking_level=types.ThinkingLevel.LOW)
        return types.GenerateContentConfig(
            system_instruction=system,
            max_output_tokens=max_tokens + self._THINKING_HEADROOM_TOKENS,
            automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
            **extra,
        )

    async def _generate(self, *, operation: str, contents: list[Any], **config: Any) -> Any:
        run = _FallbackRun(self, operation)
        for model, thinking in self._attempts():
            if run.skip(model):
                continue
            try:
                response = await self._client.aio.models.generate_content(
                    model=model,
                    contents=contents,
                    config=self._config(thinking=thinking, **config),
                )
            except Exception as exc:
                run.failed(exc, model=model, thinking=thinking)
                continue
            run.succeeded(model, thinking)
            return response
        raise run.final_error()

    async def complete(self, *, system: str, messages: Sequence[ChatTurn], max_tokens: int) -> str:
        response = await self._generate(
            operation="complete",
            contents=self._contents(messages),
            system=system,
            max_tokens=max_tokens,
        )
        return (response.text or "").strip()

    async def stream(
        self, *, system: str, messages: Sequence[ChatTurn], max_tokens: int
    ) -> AsyncIterator[str]:
        run = _FallbackRun(self, "stream")
        for model, thinking in self._attempts():
            if run.skip(model):
                continue
            yielded = False
            try:
                chunks = await self._client.aio.models.generate_content_stream(
                    model=model,
                    contents=self._contents(messages),
                    config=self._config(system=system, max_tokens=max_tokens, thinking=thinking),
                )
                async for chunk in chunks:
                    if chunk.text:
                        yielded = True
                        yield chunk.text
            except ServiceUnavailableError:
                raise
            except Exception as exc:
                if yielded:  # part of an answer already went out; can't switch model now
                    raise provider_error(exc, provider=self.name, operation="stream") from exc
                run.failed(exc, model=model, thinking=thinking)
                continue
            run.succeeded(model, thinking)
            return
        raise run.final_error()

    async def complete_json(
        self,
        *,
        system: str,
        message: str,
        schema: dict[str, Any],
        schema_name: str,
        max_tokens: int,
    ) -> dict[str, Any]:
        response = await self._generate(
            operation="complete_json",
            contents=self._contents([("user", message)]),
            system=system,
            max_tokens=max_tokens,
            response_mime_type="application/json",
            response_json_schema=schema,
        )
        return _parse_json_object(response.text or "")


class _FallbackRun:
    """Bookkeeping for one Gemini request walking through its attempts."""

    def __init__(self, provider: GeminiProvider, operation: str) -> None:
        self._provider = provider
        self._operation = operation
        self._skipped_models: set[str] = set()
        self._last_exc: BaseException | None = None
        self._rate_limited = False

    def skip(self, model: str) -> bool:
        return model in self._skipped_models

    def failed(self, exc: BaseException, *, model: str, thinking: bool) -> None:
        """Decide whether the next attempt may help; raise if it can't."""
        kind = classify_failure(exc)
        logger.info(
            "gemini_attempt_failed",
            operation=self._operation,
            model=model,
            thinking=thinking,
            kind=kind,
            error=str(exc)[:300],
        )
        self._last_exc = exc
        if kind == "thinking_unsupported" and thinking:
            return  # same model again, without thinking_config
        if kind in ("model_unavailable", "rate_limited", "thinking_unsupported"):
            self._rate_limited |= kind == "rate_limited"
            self._skipped_models.add(model)
            return
        raise provider_error(exc, provider="gemini", operation=self._operation) from exc

    def succeeded(self, model: str, thinking: bool) -> None:
        # A rate-limited primary recovers within minutes; don't pin the fallback.
        if not self._rate_limited:
            self._provider._resolved[self._provider.model] = (model, thinking)
        _record_success("gemini", model)

    def final_error(self) -> ServiceUnavailableError:
        assert self._last_exc is not None
        return provider_error(
            self._last_exc,
            provider="gemini",
            operation=self._operation,
            models=self._provider._models(),
        )


# ---------------------------------------------------------------------------
# OpenAI-compatible HTTP APIs: GroqCloud (free tier) and Ollama (local)
# ---------------------------------------------------------------------------


class OpenAICompatibleProvider:
    """Plain ``httpx`` client for ``/chat/completions`` — no extra SDK."""

    def __init__(
        self,
        *,
        name: str,
        base_url: str,
        model: str,
        api_key: str | None,
        timeout_seconds: float,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self.name = name
        self._transport = transport  # injectable for tests
        self.model = model
        self._url = base_url.rstrip("/") + "/chat/completions"
        self._headers = {"Content-Type": "application/json"}
        if api_key:
            self._headers["Authorization"] = f"Bearer {api_key}"
        self._timeout = httpx.Timeout(timeout_seconds, connect=10.0)

    def _body(
        self, *, system: str, messages: Sequence[ChatTurn], max_tokens: int, **extra: Any
    ) -> dict[str, Any]:
        body: dict[str, Any] = {
            "model": self.model,
            "messages": [{"role": "system", "content": system}]
            + [{"role": role, "content": content} for role, content in messages],
            "max_tokens": max_tokens,
            **extra,
        }
        # gpt-oss models spend completion tokens on reasoning first; keep it
        # short so the visible answer isn't starved.
        if self.model.startswith("openai/gpt-oss"):
            body["reasoning_effort"] = "low"
        return body

    async def complete(self, *, system: str, messages: Sequence[ChatTurn], max_tokens: int) -> str:
        return await self._post(
            self._body(system=system, messages=messages, max_tokens=max_tokens),
            operation="complete",
        )

    async def _post(self, body: dict[str, Any], *, operation: str) -> str:
        try:
            async with httpx.AsyncClient(
                timeout=self._timeout, transport=self._transport
            ) as client:
                response = await client.post(self._url, headers=self._headers, json=body)
                response.raise_for_status()
                data = response.json()
            content = data["choices"][0]["message"].get("content") or ""
        except Exception as exc:
            raise provider_error(exc, provider=self.name, operation=operation) from exc
        _record_success(self.name, self.model)
        return str(content).strip()

    async def stream(
        self, *, system: str, messages: Sequence[ChatTurn], max_tokens: int
    ) -> AsyncIterator[str]:
        body = self._body(system=system, messages=messages, max_tokens=max_tokens, stream=True)
        try:
            async with (
                httpx.AsyncClient(timeout=self._timeout, transport=self._transport) as client,
                client.stream("POST", self._url, headers=self._headers, json=body) as response,
            ):
                response.raise_for_status()
                async for line in response.aiter_lines():
                    if not line.startswith("data:"):
                        continue
                    payload = line[len("data:") :].strip()
                    if payload == "[DONE]":
                        break
                    try:
                        event = json.loads(payload)
                    except json.JSONDecodeError:
                        continue
                    choices = event.get("choices") or [{}]
                    delta = (choices[0].get("delta") or {}).get("content")
                    if delta:
                        yield str(delta)
        except ServiceUnavailableError:
            raise
        except Exception as exc:
            raise provider_error(exc, provider=self.name, operation="stream") from exc
        _record_success(self.name, self.model)

    async def complete_json(
        self,
        *,
        system: str,
        message: str,
        schema: dict[str, Any],
        schema_name: str,
        max_tokens: int,
    ) -> dict[str, Any]:
        body = self._body(
            system=system + _json_instruction(schema),
            messages=[("user", message)],
            max_tokens=max_tokens,
            response_format={"type": "json_object"},
            temperature=0,
        )
        return _parse_json_object(await self._post(body, operation="complete_json"))


# ---------------------------------------------------------------------------
# Anthropic Claude (paid, optional)
# ---------------------------------------------------------------------------


class AnthropicProvider:
    name = "anthropic"

    def __init__(self, *, settings: Settings) -> None:
        from app.services.anthropic_client import get_client

        self.model = settings.llm_model
        self._client = get_client(settings)

    async def complete(self, *, system: str, messages: Sequence[ChatTurn], max_tokens: int) -> str:
        try:
            response = await self._client.messages.create(
                model=self.model,
                max_tokens=max_tokens,
                system=system,
                messages=[{"role": r, "content": c} for r, c in messages],  # type: ignore[typeddict-item]
            )
        except Exception as exc:
            raise provider_error(exc, provider=self.name, operation="complete") from exc
        _record_success(self.name, self.model)
        return "\n".join(b.text for b in response.content if b.type == "text").strip()

    async def stream(
        self, *, system: str, messages: Sequence[ChatTurn], max_tokens: int
    ) -> AsyncIterator[str]:
        try:
            async with self._client.messages.stream(
                model=self.model,
                max_tokens=max_tokens,
                system=system,
                messages=[{"role": r, "content": c} for r, c in messages],  # type: ignore[typeddict-item]
            ) as stream:
                async for text in stream.text_stream:
                    yield text
        except ServiceUnavailableError:
            raise
        except Exception as exc:
            raise provider_error(exc, provider=self.name, operation="stream") from exc
        _record_success(self.name, self.model)

    async def complete_json(
        self,
        *,
        system: str,
        message: str,
        schema: dict[str, Any],
        schema_name: str,
        max_tokens: int,
    ) -> dict[str, Any]:
        tool = {"name": schema_name, "description": "Record the result.", "input_schema": schema}
        try:
            response = await self._client.messages.create(  # type: ignore[call-overload]
                model=self.model,
                max_tokens=max_tokens,
                system=system,
                messages=[{"role": "user", "content": message}],
                tools=[tool],
                tool_choice={"type": "tool", "name": schema_name},
            )
        except Exception as exc:
            raise provider_error(exc, provider=self.name, operation="complete_json") from exc
        _record_success(self.name, self.model)
        for block in response.content:
            if block.type == "tool_use" and block.name == schema_name:
                return block.input if isinstance(block.input, dict) else {}
        return {}


# ---------------------------------------------------------------------------
# Selection
# ---------------------------------------------------------------------------


def _resolve_name(settings: Settings) -> str | None:
    if settings.llm_provider != "auto":
        return settings.llm_provider
    if settings.gemini_api_key:
        return "gemini"
    if settings.groq_api_key:
        return "groq"
    if settings.ollama_base_url:
        return "ollama"
    if settings.anthropic_api_key:
        return "anthropic"
    return None


def _missing_config_message(name: str | None) -> str:
    needs = {
        None: "set GEMINI_API_KEY (free), GROQ_API_KEY (free) or OLLAMA_BASE_URL (local)",
        "gemini": "missing GEMINI_API_KEY",
        "groq": "missing GROQ_API_KEY",
        "ollama": "missing OLLAMA_BASE_URL",
        "anthropic": "missing ANTHROPIC_API_KEY",
    }[name]
    return f"The legal assistant isn't configured yet ({needs})."


def describe_provider(settings: Settings) -> ProviderInfo:
    name = _resolve_name(settings)
    configured = name is not None and _is_configured(name, settings)
    model = {
        "gemini": settings.gemini_llm_model,
        "groq": settings.groq_model,
        "ollama": settings.ollama_model,
        "anthropic": settings.llm_model,
    }.get(name or "")
    return ProviderInfo(
        configured=configured,
        provider=name,
        model=model if configured else None,
        is_free_tier=_FREE.get(name or "") if configured else None,
    )


def _is_configured(name: str, settings: Settings) -> bool:
    return bool(
        {
            "gemini": settings.gemini_api_key,
            "groq": settings.groq_api_key,
            "ollama": settings.ollama_base_url,
            "anthropic": settings.anthropic_api_key,
        }[name]
    )


def get_provider(settings: Settings) -> LLMProvider:
    """Build the configured provider, or raise ``llm_not_configured`` (503)."""
    name = _resolve_name(settings)
    if name is None or not _is_configured(name, settings):
        raise ServiceUnavailableError(_missing_config_message(name), code="llm_not_configured")

    timeout = settings.llm_request_timeout_seconds
    if name == "gemini":
        assert settings.gemini_api_key is not None
        return GeminiProvider(
            api_key=settings.gemini_api_key,
            model=settings.gemini_llm_model,
            timeout_seconds=timeout,
        )
    if name == "groq":
        return OpenAICompatibleProvider(
            name="groq",
            base_url=settings.groq_base_url,
            model=settings.groq_model,
            api_key=settings.groq_api_key,
            timeout_seconds=timeout,
        )
    if name == "ollama":
        assert settings.ollama_base_url is not None
        return OpenAICompatibleProvider(
            name="ollama",
            base_url=settings.ollama_base_url,
            model=settings.ollama_model,
            api_key=None,
            timeout_seconds=timeout,
        )
    return AnthropicProvider(settings=settings)
