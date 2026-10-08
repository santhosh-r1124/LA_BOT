"""Tests for app.services.ingestion.hf_dataset against a fake Hugging Face.

``FakeHub`` answers the Hub API, the dataset viewer API and file downloads
(with HTTP range requests) from in-memory fixtures, so no test reaches the
network. Every row text here is an obviously synthetic TEST FIXTURE, never
presented as real law, and all database writes are rolled back.
"""

from __future__ import annotations

import io
import json
import re
from collections.abc import Callable
from datetime import date
from typing import Any

import httpx
import pyarrow as pa
import pyarrow.parquet as pq
import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models.legal_document import DocumentType, LegalChunk, LegalDocument
from app.services.ingestion import hf_dataset
from app.services.ingestion.hf_dataset import HFClient, HFDatasetError


def fixture_text(i: int) -> str:
    return (
        f"TEST FIXTURE {i}. Synthetic text for automated tests only; not a real judgment. "
        "The petitioner sought a refund of the security deposit withheld by the landlord. "
    ) * 4


def rows(n: int) -> list[dict[str, Any]]:
    return [
        {
            "id": f"case-{i}",
            "case_title": f"Fixture Petitioner {i} v. Fixture Respondent",
            "court_name": "Test High Court",
            "decision_date": date(2020, 1, 1 + i),
            "neutral_citation": f"TEST/{i}",
            "indexable_text": fixture_text(i),
        }
        for i in range(n)
    ]


def parquet_bytes(data: list[dict[str, Any]], row_group_size: int = 2) -> bytes:
    sink = io.BytesIO()
    pq.write_table(pa.Table.from_pylist(data), sink, row_group_size=row_group_size)
    return sink.getvalue()


class FakeHub:
    """A tiny stand-in for huggingface.co + datasets-server.huggingface.co."""

    def __init__(
        self,
        *,
        name: str = "example/indian-cases",
        files: dict[str, bytes] | None = None,
        viewer_rows: list[dict[str, Any]] | None = None,
        hub_status: int = 200,
        license: str | None = "apache-2.0",
        truncate: set[int] | None = None,
    ) -> None:
        self.name = name
        self.files = files or {}
        self.viewer_rows = viewer_rows
        self.hub_status = hub_status
        self.license = license
        self.truncate = truncate or set()
        self.requests: list[httpx.Request] = []

    def transport(self) -> httpx.MockTransport:
        return httpx.MockTransport(self.handle)

    def handle(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        url = request.url
        if url.host == "huggingface.co" and url.path == f"/api/datasets/{self.name}":
            if self.hub_status != 200:
                return httpx.Response(self.hub_status, json={"error": "Access denied"})
            return httpx.Response(
                200,
                json={
                    "id": self.name,
                    "gated": False,
                    "cardData": {"license": self.license} if self.license else {},
                    "siblings": [{"rfilename": "README.md"}]
                    + [{"rfilename": f} for f in self.files],
                },
            )
        if url.host == "datasets-server.huggingface.co":
            return self.viewer(url)
        prefix = f"/datasets/{self.name}/resolve/main/"
        if url.host == "huggingface.co" and url.path.startswith(prefix):
            path = url.path[len(prefix) :]
            if path not in self.files:
                return httpx.Response(404, json={"error": "Entry not found"})
            return self.download(request, self.files[path])
        return httpx.Response(404, json={"error": f"unexpected {url}"})

    def viewer(self, url: httpx.URL) -> httpx.Response:
        if self.viewer_rows is None:
            return httpx.Response(
                500, json={"error": "The dataset viewer is not available for this dataset."}
            )
        if url.path == "/splits":
            return httpx.Response(
                200,
                json={"splits": [{"dataset": self.name, "config": "default", "split": "train"}]},
            )
        if url.path == "/size":
            return httpx.Response(
                200, json={"size": {"dataset": {"num_bytes_parquet_files": 12345}}}
            )
        if url.path == "/rows":
            offset = int(url.params["offset"])
            length = int(url.params["length"])
            out = []
            for idx in range(offset, min(offset + length, len(self.viewer_rows))):
                row = dict(self.viewer_rows[idx])
                truncated = []
                if idx in self.truncate and length > 1:
                    row["indexable_text"] = row["indexable_text"][:50]
                    truncated = ["indexable_text"]
                out.append({"row_idx": idx, "row": row, "truncated_cells": truncated})
            return httpx.Response(
                200,
                json={
                    "features": [{"name": k, "type": {"dtype": "string"}} for k in out[0]["row"]]
                    if out
                    else [],
                    "rows": out,
                    "num_rows_total": len(self.viewer_rows),
                },
            )
        return httpx.Response(404, json={"error": "unknown endpoint"})

    @staticmethod
    def download(request: httpx.Request, data: bytes) -> httpx.Response:
        header = request.headers.get("Range")
        if not header:
            return httpx.Response(200, content=data)
        match = re.fullmatch(r"bytes=(\d+)-(\d+)", header)
        assert match, header
        start, end = int(match[1]), min(int(match[2]), len(data) - 1)
        if start >= len(data):
            return httpx.Response(416)
        return httpx.Response(
            206,
            content=data[start : end + 1],
            headers={"Content-Range": f"bytes {start}-{end}/{len(data)}"},
        )


def make_client(hub: FakeHub) -> HFClient:
    return HFClient(transport=hub.transport(), retries=1, retry_delay_seconds=0)


# ---------------------------------------------------------------------------
# Field detection / file choice (pure)
# ---------------------------------------------------------------------------


def test_detect_fields_maps_well_known_columns() -> None:
    fields = hf_dataset.detect_fields(rows(2))
    assert fields == hf_dataset.FieldMap(
        text="indexable_text",
        title="case_title",
        id="id",
        court="court_name",
        date="decision_date",
        citation="neutral_citation",
    )


def test_detect_fields_falls_back_to_the_longest_text_column() -> None:
    sample = [{"a": "short", "b": "x" * 900, "n": 1}]
    assert hf_dataset.detect_fields(sample).text == "b"


def test_detect_fields_rejects_a_bad_override() -> None:
    with pytest.raises(HFDatasetError, match="HF_TEXT_FIELD"):
        hf_dataset.detect_fields(rows(1), text_field="nope")


def test_choose_data_file_prefers_a_sample_parquet() -> None:
    files = [
        "README.md",
        "structured/v1/year=2026/part.parquet",
        "sample/v1/sample.parquet",
        "dump.jsonl",
    ]
    assert hf_dataset.choose_data_file(files) == "sample/v1/sample.parquet"
    assert hf_dataset.choose_data_file(["a.jsonl", "README.md"]) == "a.jsonl"
    with pytest.raises(HFDatasetError, match="no parquet"):
        hf_dataset.choose_data_file(["README.md", "data.zip"])


def test_normalize_row_copies_metadata_from_the_dataset_only() -> None:
    info = hf_dataset.DatasetInfo(
        name="example/indian-cases",
        num_rows=1,
        size_bytes=None,
        license="apache-2.0",
        gated=False,
        features={},
        fields=hf_dataset.detect_fields(rows(1)),
        config="default",
        split="train",
    )
    doc = hf_dataset.normalize_row(info, 0, rows(1)[0])
    assert doc is not None
    assert doc.external_id == "case-0"
    assert doc.title == "Fixture Petitioner 0 v. Fixture Respondent"
    assert doc.document_type is DocumentType.JUDGMENT
    assert doc.effective_date == date(2020, 1, 1)
    assert doc.source_url.endswith("/viewer/default/train?row=0")
    assert {k: doc.metadata[k] for k in ("court", "date", "citation", "dataset", "license")} == {
        "court": "Test High Court",
        "date": "2020-01-01",
        "citation": "TEST/0",
        "dataset": "example/indian-cases",
        "license": "apache-2.0",
    }

    # A row without those fields gets none invented.
    bare = {"indexable_text": fixture_text(9)}
    doc = hf_dataset.normalize_row(info, 7, bare)
    assert doc is not None
    assert "citation" not in doc.metadata and "court" not in doc.metadata
    assert doc.external_id == "default/train#7"
    # Too short to be a legal document.
    assert hf_dataset.normalize_row(info, 8, {"indexable_text": "Index"}) is None


# ---------------------------------------------------------------------------
# Inspection + errors (no database)
# ---------------------------------------------------------------------------


async def test_inspect_uses_the_dataset_viewer_when_available() -> None:
    hub = FakeHub(viewer_rows=[{**r, "decision_date": "2020-01-01"} for r in rows(3)])
    async with make_client(hub) as client:
        info = await hf_dataset.inspect_dataset(client, hub.name)
    assert info.source == "viewer"
    assert (info.config, info.split, info.num_rows) == ("default", "train", 3)
    assert info.license == "apache-2.0"
    assert info.size_bytes == 12345
    assert info.fields.text == "indexable_text"


async def test_inspect_falls_back_to_reading_a_parquet_file() -> None:
    data = parquet_bytes(rows(5))
    hub = FakeHub(files={"sample/v1/sample.parquet": data, "big/full.parquet": data})
    async with make_client(hub) as client:
        info = await hf_dataset.inspect_dataset(client, hub.name)
    assert info.source == "file"
    assert info.file == "sample/v1/sample.parquet"
    assert info.num_rows == 5
    assert "dataset viewer" in (info.viewer_error or "")
    assert info.fields.citation == "neutral_citation"
    # Read with range requests only: never one request for the whole file.
    downloads = [r for r in hub.requests if "/resolve/main/" in r.url.path]
    assert downloads and all("Range" in r.headers for r in downloads)


async def test_gated_dataset_explains_hf_token() -> None:
    hub = FakeHub(hub_status=401)
    async with make_client(hub) as client:
        with pytest.raises(HFDatasetError, match="HF_TOKEN"):
            await hf_dataset.inspect_dataset(client, hub.name)


async def test_unreachable_hugging_face_is_reported_not_faked() -> None:
    def offline(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("blocked", request=request)

    client = HFClient(transport=httpx.MockTransport(offline), retries=2, retry_delay_seconds=0)
    async with client:
        with pytest.raises(HFDatasetError, match="Could not reach Hugging Face"):
            await hf_dataset.inspect_dataset(client, "example/indian-cases")


async def test_invalid_dataset_id_is_rejected_before_any_request() -> None:
    hub = FakeHub()
    async with make_client(hub) as client:
        for bad in ("../../etc/passwd", "../x", "owner/..", "no-slash", "a/b/c"):
            with pytest.raises(HFDatasetError, match="owner/name"):
                await hf_dataset.inspect_dataset(client, bad)
    assert hub.requests == []


async def test_server_ignoring_range_requests_is_an_error_not_a_full_download() -> None:
    class NoRanges(FakeHub):
        @staticmethod
        def download(request: httpx.Request, data: bytes) -> httpx.Response:
            return httpx.Response(200, content=data)

    hub = NoRanges(files={"data.parquet": parquet_bytes(rows(3))})
    async with make_client(hub) as client:
        with pytest.raises(HFDatasetError, match="partial downloads"):
            await hf_dataset.inspect_dataset(client, hub.name)


# ---------------------------------------------------------------------------
# Ingestion (database; rolled back)
# ---------------------------------------------------------------------------


@pytest.fixture
def sessions(db_conn: object) -> Callable[[], AsyncSession]:
    def factory() -> AsyncSession:
        return AsyncSession(
            bind=db_conn,  # type: ignore[arg-type]
            expire_on_commit=False,
            join_transaction_mode="create_savepoint",
        )

    return factory


async def _count(sessions: Callable[[], AsyncSession], name: str) -> tuple[int, int]:
    async with sessions() as db:
        docs = await db.scalar(select(func.count()).where(LegalDocument.source_dataset == name))
        chunks = await db.scalar(
            select(func.count())
            .select_from(LegalChunk)
            .join(LegalDocument)
            .where(LegalDocument.source_dataset == name)
        )
    return int(docs or 0), int(chunks or 0)


async def test_parquet_ingestion_is_incremental_and_idempotent(
    sessions: Callable[[], AsyncSession],
) -> None:
    hub = FakeHub(files={"data/train.parquet": parquet_bytes(rows(7))})
    settings = get_settings()

    async def run(max_documents: int, *, from_start: bool = False) -> hf_dataset.IngestReport:
        async with make_client(hub) as client:
            _, report = await hf_dataset.ingest_dataset(
                settings=settings,
                session_factory=sessions,
                client=client,
                name=hub.name,
                max_documents=max_documents,
                batch_size=2,
                from_start=from_start,
            )
        return report

    first = await run(3)
    assert (first.added, first.already_indexed) == (3, 0)
    docs, chunks = await _count(sessions, hub.name)
    assert docs == 3 and chunks >= 3

    again = await run(3)  # same target: nothing to do
    assert again.added == 0 and again.rows_read == 0
    assert "already indexed" in again.notes[0]

    more = await run(5)  # continues after the last row read
    assert more.added == 2
    assert (await _count(sessions, hub.name))[0] == 5

    refresh = await run(5, from_start=True)
    assert (refresh.added, refresh.updated, refresh.unchanged) == (0, 0, 5)
    assert (await _count(sessions, hub.name))[0] == 5

    async with sessions() as db:
        doc = await db.scalar(select(LegalDocument).where(LegalDocument.external_id == "case-4"))
        assert doc is not None
        assert doc.doc_metadata["court"] == "Test High Court"
        assert doc.doc_metadata["citation"] == "TEST/4"
        assert doc.doc_metadata["file"] == "data/train.parquet"
        assert doc.effective_date == date(2020, 1, 5)
        # Text is stored first; embeddings come later (embed_missing).
        embedded = await db.scalar(
            select(func.count()).where(
                LegalChunk.document_id == doc.id, LegalChunk.embedding.is_not(None)
            )
        )
        assert embedded == 0


async def test_viewer_ingestion_refetches_truncated_rows(
    sessions: Callable[[], AsyncSession],
) -> None:
    data = [{**r, "decision_date": "2021-03-04"} for r in rows(4)]
    hub = FakeHub(viewer_rows=data, truncate={1})
    async with make_client(hub) as client:
        info, report = await hf_dataset.ingest_dataset(
            settings=get_settings(),
            session_factory=sessions,
            client=client,
            name=hub.name,
            max_documents=10,
            batch_size=3,
        )
    assert info.source == "viewer"
    assert report.added == 4
    assert any("Reached the end" in n for n in report.notes)
    async with sessions() as db:
        doc = await db.scalar(select(LegalDocument).where(LegalDocument.external_id == "case-1"))
        assert doc is not None
        assert "text_truncated" not in doc.doc_metadata  # the full row was fetched


async def test_jsonl_ingestion_streams_only_what_it_needs(
    sessions: Callable[[], AsyncSession],
) -> None:
    lines = "\n".join(json.dumps({**r, "decision_date": "2019-05-06"}) for r in rows(6)).encode()
    hub = FakeHub(files={"cases.jsonl": lines})
    async with make_client(hub) as client:
        _, report = await hf_dataset.ingest_dataset(
            settings=get_settings(),
            session_factory=sessions,
            client=client,
            name=hub.name,
            max_documents=2,
            batch_size=5,
        )
    assert report.added == 2
    assert (await _count(sessions, hub.name))[0] == 2


async def test_embed_missing_stops_cleanly_without_a_key(
    sessions: Callable[[], AsyncSession],
) -> None:
    hub = FakeHub(files={"data.parquet": parquet_bytes(rows(1))})
    settings = get_settings()
    async with make_client(hub) as client:
        await hf_dataset.ingest_dataset(
            settings=settings,
            session_factory=sessions,
            client=client,
            name=hub.name,
            max_documents=1,
            batch_size=1,
        )
    embedded, stopped = await hf_dataset.embed_missing(settings=settings, session_factory=sessions)
    assert embedded == 0
    assert stopped and "GEMINI_API_KEY" in stopped


async def test_embed_missing_fills_null_embeddings(
    sessions: Callable[[], AsyncSession], monkeypatch: pytest.MonkeyPatch
) -> None:
    hub = FakeHub(files={"data.parquet": parquet_bytes(rows(2))})
    settings = get_settings()
    async with make_client(hub) as client:
        await hf_dataset.ingest_dataset(
            settings=settings,
            session_factory=sessions,
            client=client,
            name=hub.name,
            max_documents=2,
            batch_size=2,
        )

    async def fake_embed(texts: list[str], *, settings: object) -> list[list[float]]:
        return [[0.5] * 768 for _ in texts]

    monkeypatch.setattr(hf_dataset, "embed_texts", fake_embed)
    embedded, stopped = await hf_dataset.embed_missing(
        settings=settings, session_factory=sessions, batch_size=1
    )
    assert stopped is None
    assert embedded == (await _count(sessions, hub.name))[1]
    async with sessions() as db:
        missing = await db.scalar(
            select(func.count()).select_from(LegalChunk).where(LegalChunk.embedding.is_(None))
        )
    assert missing == 0


# ---------------------------------------------------------------------------
# Startup autoload + /status
# ---------------------------------------------------------------------------


async def test_autoload_failure_is_reported_on_status(
    db_available: bool, monkeypatch: pytest.MonkeyPatch
) -> None:
    if not db_available:
        pytest.skip("Postgres not reachable")
    from app.core.config import Settings
    from app.db.session import dispose_engine
    from app.services import startup

    def offline(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("blocked", request=request)

    def offline_client(token: str | None = None) -> HFClient:
        return HFClient(token, transport=httpx.MockTransport(offline), retries=1)

    monkeypatch.setattr(startup.hf_dataset, "HFClient", offline_client)
    settings = Settings(legal_corpus_autoload=True, hf_max_documents=5)
    try:
        await startup.load_legal_corpus(settings)
    finally:
        await dispose_engine()
    assert startup.corpus_load.state == "failed"
    assert "Could not reach Hugging Face" in (startup.corpus_load.message or "")

    await startup.load_legal_corpus(Settings(legal_corpus_autoload=False))
    assert startup.corpus_load.state == "disabled"


async def test_status_lists_knowledge_base_sources(db_client: httpx.AsyncClient) -> None:
    resp = await db_client.get("/api/v1/status")
    assert resp.status_code == 200
    kb = resp.json()["knowledge_base"]
    assert kb["available"] is True
    assert isinstance(kb["sources"], list)
    assert kb["chunks_embedded"] >= 0
    assert kb["corpus_load"]["state"] in {"not_started", "disabled", "running", "done", "failed"}
