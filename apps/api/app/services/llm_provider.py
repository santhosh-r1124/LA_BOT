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
from typing import Any, Protocol

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


# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------


def _is_rate_limit(exc: BaseException) -> bool:
    for attr in ("status_code", "code", "status"):
        if getattr(exc, attr, None) in (429, "429", "RESOURCE_EXHAUSTED"):
            return True
    response = getattr(exc, "response", None)
    if getattr(response, "status_code", None) == 429:
        return True
    text = str(exc)
    return "429" in text or "RESOURCE_EXHAUSTED" in text or "rate limit" in text.lower()


def provider_error(exc: BaseException, *, provider: str, operation: str) -> ServiceUnavailableError:
    """Map any SDK/transport exception to a user-safe error. The raw message
    is logged server-side only (it can contain request details)."""
    rate_limited = _is_rate_limit(exc)
    logger.warning(
        "llm_provider_failed",
        provider=provider,
        operation=operation,
        rate_limited=rate_limited,
        error_type=type(exc).__name__,
        error=str(exc)[:500],
    )
    if rate_limited:
        return ServiceUnavailableError(_RATE_LIMITED_MESSAGE, code="llm_rate_limited")
    return ServiceUnavailableError(_UNAVAILABLE_MESSAGE, code="llm_error")


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


class GeminiProvider:
    name = "gemini"

    # Gemini "thinking" tokens are billed against max_output_tokens. Give the
    # model headroom so a low-effort thought pass can't truncate the answer.
    _THINKING_HEADROOM_TOKENS = 1024

    def __init__(self, *, api_key: str, model: str, timeout_seconds: float) -> None:
        from google import genai
        from google.genai import types

        self.model = model
        self._types = types
        self._client = genai.Client(
            api_key=api_key,
            http_options=types.HttpOptions(timeout=int(timeout_seconds * 1000)),
        )

    def _contents(self, messages: Sequence[ChatTurn]) -> list[Any]:
        types = self._types
        return [
            types.Content(
                role="model" if role == "assistant" else "user",
                parts=[types.Part(text=content)],
            )
            for role, content in messages
        ]

    def _config(self, *, system: str, max_tokens: int, **extra: Any) -> Any:
        types = self._types
        return types.GenerateContentConfig(
            system_instruction=system,
            max_output_tokens=max_tokens + self._THINKING_HEADROOM_TOKENS,
            thinking_config=types.ThinkingConfig(thinking_level=types.ThinkingLevel.LOW),
            **extra,
        )

    async def complete(self, *, system: str, messages: Sequence[ChatTurn], max_tokens: int) -> str:
        try:
            response = await self._client.aio.models.generate_content(
                model=self.model,
                contents=self._contents(messages),
                config=self._config(system=system, max_tokens=max_tokens),
            )
        except Exception as exc:
            raise provider_error(exc, provider=self.name, operation="complete") from exc
        return (response.text or "").strip()

    async def stream(
        self, *, system: str, messages: Sequence[ChatTurn], max_tokens: int
    ) -> AsyncIterator[str]:
        try:
            chunks = await self._client.aio.models.generate_content_stream(
                model=self.model,
                contents=self._contents(messages),
                config=self._config(system=system, max_tokens=max_tokens),
            )
            async for chunk in chunks:
                if chunk.text:
                    yield chunk.text
        except ServiceUnavailableError:
            raise
        except Exception as exc:
            raise provider_error(exc, provider=self.name, operation="stream") from exc

    async def complete_json(
        self,
        *,
        system: str,
        message: str,
        schema: dict[str, Any],
        schema_name: str,
        max_tokens: int,
    ) -> dict[str, Any]:
        try:
            response = await self._client.aio.models.generate_content(
                model=self.model,
                contents=self._contents([("user", message)]),
                config=self._config(
                    system=system,
                    max_tokens=max_tokens,
                    response_mime_type="application/json",
                    response_json_schema=schema,
                ),
            )
        except Exception as exc:
            raise provider_error(exc, provider=self.name, operation="complete_json") from exc
        return _parse_json_object(response.text or "")


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
