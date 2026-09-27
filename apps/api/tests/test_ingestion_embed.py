"""Unit tests for app.services.ingestion.embed — no network, no real API key."""

from __future__ import annotations

import pytest

from app.core.config import Settings
from app.core.errors import ServiceUnavailableError
from app.services.ingestion import embed

UNCONFIGURED = Settings(gemini_api_key=None)
CONFIGURED = Settings(gemini_api_key="fake-key-for-tests")


class _FakeContentEmbedding:
    def __init__(self, values: list[float]) -> None:
        self.values = values


class _FakeEmbedResponse:
    def __init__(self, embeddings: list[_FakeContentEmbedding]) -> None:
        self.embeddings = embeddings


class _FakeModels:
    def __init__(self, response: object, *, calls: list[dict[str, object]]) -> None:
        self._response = response
        self._calls = calls

    async def embed_content(self, **kwargs: object) -> object:
        self._calls.append(kwargs)
        return self._response


class _FakeAio:
    def __init__(self, response: object, *, calls: list[dict[str, object]]) -> None:
        self.models = _FakeModels(response, calls=calls)


class _FakeClient:
    def __init__(self, response: object, *, calls: list[dict[str, object]] | None = None) -> None:
        self.aio = _FakeAio(response, calls=calls if calls is not None else [])


class _RaisingModels:
    async def embed_content(self, **_kwargs: object) -> object:
        raise RuntimeError("simulated transport failure")


class _RaisingAio:
    def __init__(self) -> None:
        self.models = _RaisingModels()


class _RaisingClient:
    def __init__(self) -> None:
        self.aio = _RaisingAio()


async def test_embed_texts_raises_when_not_configured() -> None:
    with pytest.raises(ServiceUnavailableError) as exc_info:
        await embed.embed_texts(["hello"], settings=UNCONFIGURED)
    assert exc_info.value.code == "embeddings_not_configured"


async def test_embed_query_raises_when_not_configured() -> None:
    with pytest.raises(ServiceUnavailableError) as exc_info:
        await embed.embed_query("hello", settings=UNCONFIGURED)
    assert exc_info.value.code == "embeddings_not_configured"


async def test_embed_texts_empty_list_short_circuits(monkeypatch: pytest.MonkeyPatch) -> None:
    def _unreachable(settings: Settings) -> _FakeClient:
        raise AssertionError("embed_texts should not build a client for an empty batch")

    monkeypatch.setattr(embed, "_client", _unreachable)
    assert await embed.embed_texts([], settings=CONFIGURED) == []


async def test_embed_texts_returns_parsed_vectors(monkeypatch: pytest.MonkeyPatch) -> None:
    response = _FakeEmbedResponse([_FakeContentEmbedding([0.1, 0.2, 0.3])])
    monkeypatch.setattr(embed, "_client", lambda settings: _FakeClient(response))

    vectors = await embed.embed_texts(["some legal text"], settings=CONFIGURED)

    assert vectors == [[0.1, 0.2, 0.3]]


async def test_embed_texts_batches_large_input(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[dict[str, object]] = []

    class _DynamicModels:
        async def embed_content(self, **kwargs: object) -> object:
            calls.append(kwargs)
            batch = kwargs["contents"]
            assert isinstance(batch, list)
            return _FakeEmbedResponse([_FakeContentEmbedding([0.0]) for _ in batch])

    class _DynamicAio:
        def __init__(self) -> None:
            self.models = _DynamicModels()

    class _ClientWithDynamicModels:
        def __init__(self) -> None:
            self.aio = _DynamicAio()

    monkeypatch.setattr(embed, "_client", lambda settings: _ClientWithDynamicModels())
    monkeypatch.setattr(embed, "_MAX_BATCH", 2)

    texts = [f"text {i}" for i in range(5)]
    vectors = await embed.embed_texts(texts, settings=CONFIGURED)

    assert len(vectors) == 5
    assert len(calls) == 3  # batches of 2, 2, 1


async def test_embed_texts_raises_on_mismatched_response_size(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    response = _FakeEmbedResponse([_FakeContentEmbedding([0.1])])  # only 1, expects 2
    monkeypatch.setattr(embed, "_client", lambda settings: _FakeClient(response))

    with pytest.raises(ServiceUnavailableError) as exc_info:
        await embed.embed_texts(["a", "b"], settings=CONFIGURED)
    assert exc_info.value.code == "embeddings_error"


async def test_embed_texts_wraps_transport_errors(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(embed, "_client", lambda settings: _RaisingClient())
    with pytest.raises(ServiceUnavailableError) as exc_info:
        await embed.embed_texts(["hello"], settings=CONFIGURED)
    assert exc_info.value.code == "embeddings_error"


async def test_embed_query_uses_retrieval_query_task_type(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[dict[str, object]] = []
    response = _FakeEmbedResponse([_FakeContentEmbedding([1.0, 0.0])])
    monkeypatch.setattr(embed, "_client", lambda settings: _FakeClient(response, calls=calls))

    await embed.embed_query("find me a case about X", settings=CONFIGURED)

    assert len(calls) == 1
    config = calls[0]["config"]
    assert config.task_type == "RETRIEVAL_QUERY"  # type: ignore[union-attr]


# ---------------------------------------------------------------------------
# Free-tier protection: 429 retry (ingestion only) + query-embedding cache
# ---------------------------------------------------------------------------


class _FlakyModels:
    def __init__(self, failures: int, response: object) -> None:
        self.failures = failures
        self.response = response
        self.calls = 0

    async def embed_content(self, **_kwargs: object) -> object:
        self.calls += 1
        if self.calls <= self.failures:
            raise RuntimeError("429 RESOURCE_EXHAUSTED")
        return self.response


class _FlakyClient:
    def __init__(self, models: _FlakyModels) -> None:
        self.aio = type("Aio", (), {"models": models})()


async def test_ingestion_embeddings_retry_on_rate_limit(monkeypatch: pytest.MonkeyPatch) -> None:
    models = _FlakyModels(2, _FakeEmbedResponse([_FakeContentEmbedding([0.5])]))
    monkeypatch.setattr(embed, "_client", lambda settings: _FlakyClient(models))
    sleeps: list[float] = []

    async def fake_sleep(seconds: float) -> None:
        sleeps.append(seconds)

    monkeypatch.setattr(embed.asyncio, "sleep", fake_sleep)
    assert await embed.embed_texts(["x"], settings=CONFIGURED) == [[0.5]]
    assert models.calls == 3
    assert len(sleeps) == 2


async def test_query_embeddings_do_not_retry_and_report_rate_limit(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    models = _FlakyModels(5, None)
    monkeypatch.setattr(embed, "_client", lambda settings: _FlakyClient(models))
    with pytest.raises(ServiceUnavailableError) as exc_info:
        await embed.embed_texts(["x"], settings=CONFIGURED, task_type="RETRIEVAL_QUERY")
    assert exc_info.value.code == "embeddings_rate_limited"
    assert models.calls == 1


async def test_embed_query_uses_cache(monkeypatch: pytest.MonkeyPatch) -> None:
    settings = Settings(gemini_api_key="k", embedding_dimensions=2)
    store: dict[str, list[float]] = {}
    calls: list[list[str]] = []

    async def fake_get(key: str) -> list[float] | None:
        return store.get(key)

    async def fake_set(key: str, vector: list[float], ttl: int) -> None:
        store[key] = vector

    async def fake_embed_texts(texts: list[str], **_kwargs: object) -> list[list[float]]:
        calls.append(texts)
        return [[0.1, 0.2]]

    monkeypatch.setattr(embed, "_client", lambda settings: object())
    monkeypatch.setattr(embed, "_cache_get", fake_get)
    monkeypatch.setattr(embed, "_cache_set", fake_set)
    monkeypatch.setattr(embed, "embed_texts", fake_embed_texts)

    assert await embed.embed_query("What is  Section 43A?", settings=settings) == [0.1, 0.2]
    assert await embed.embed_query("what is section 43a?", settings=settings) == [0.1, 0.2]
    assert len(calls) == 1  # second (normalised-equal) query served from cache
