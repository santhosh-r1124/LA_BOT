"""Ingest Indian legal documents from a Hugging Face dataset.

    Hugging Face dataset
      --> rows, a page at a time (dataset viewer API, or the repo's parquet /
          JSON Lines file read with HTTP range requests)
      --> field detection (text / title / court / date / citation / id)
      --> normalisation --> chunking --> legal_documents + legal_chunks
      --> (separately, resumable) embeddings --> hybrid retrieval

Nothing is downloaded as a whole. The dataset viewer API
(``datasets-server.huggingface.co``) serves rows in pages of
``HF_BATCH_SIZE``. Datasets the viewer can't serve are read straight from one
of their data files: a parquet file one row group at a time (only the footer
and the needed column chunks are fetched), a JSON Lines file as a stream that
is closed once enough rows are read.

``HF_MAX_DOCUMENTS`` is how many documents from the dataset to have indexed:
re-running with the same value does nothing, a larger value continues where
the last run stopped.

Each row becomes one ``LegalDocument`` keyed by (dataset, row id). Metadata is
copied from the dataset's own fields only, never inferred. Chunks are stored
without embeddings, which keyword retrieval can already use; ``embed_missing``
adds embeddings later (it spends Gemini free-tier quota and stops cleanly when
that runs out).
"""

from __future__ import annotations

import asyncio
import hashlib
import io
import json
import re
import time
from collections.abc import AsyncGenerator, AsyncIterator, Callable, Iterator
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any
from urllib.parse import quote

import httpx
import pyarrow.parquet as pq
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.errors import ServiceUnavailableError
from app.core.logging import get_logger
from app.models.legal_document import DocumentType, IngestionStatus, LegalChunk, LegalDocument
from app.services.ingestion.chunk import chunk_document
from app.services.ingestion.clean import clean_document_text
from app.services.ingestion.embed import embed_texts

logger = get_logger("app.hf_ingestion")

HUB_URL = "https://huggingface.co"
HUB_API = f"{HUB_URL}/api/datasets"
VIEWER_API = "https://datasets-server.huggingface.co"
_MAX_PAGE = 100  # the viewer API's per-request row limit
_MIN_TEXT_CHARS = 200  # shorter "documents" are headers/noise, not legal text
_SAMPLE_ROWS = 5
_RANGE_BLOCK = 1 << 20  # small reads (parquet footer, page headers) are fetched 1 MiB at a time
# A parquet row group is the smallest unit that can be read; refuse files whose
# row groups are too big to fetch on a laptop.
_MAX_ROW_GROUP_BYTES = 256 * 1024 * 1024
# Non-mapped columns larger than this (per row group) are not fetched at all.
_SMALL_COLUMN_BYTES = 1024 * 1024
_MAX_EXTRA_FIELDS = 20
_DATA_SUFFIXES = (".parquet", ".jsonl")
# Hub ids: letters/digits first, then letters, digits, "-", "_", ".".
_DATASET_ID = re.compile(r"[A-Za-z0-9][\w.-]{0,95}/[A-Za-z0-9][\w.-]{0,95}")

_TEXT_FIELDS = (
    "text", "judgment", "judgement", "judgment_text", "judgement_text", "indexable_text",
    "content", "document", "full_text", "case_text", "body", "context", "passage",
    "page_content", "chunk", "facts",
)  # fmt: skip
_TITLE_FIELDS = ("case_name", "case_title", "title", "name", "parties", "case", "heading")
_ID_FIELDS = ("id", "doc_id", "document_id", "judgment_id", "_id", "uuid", "chunk_id")
_COURT_FIELDS = ("court", "court_name", "bench", "court_type")
_DATE_FIELDS = ("date", "judgment_date", "decision_date", "date_of_judgment", "judgement_date")
_CITATION_FIELDS = (
    "citation", "neutral_citation", "citations", "law_report_citation", "cite",
    "case_citation",
)  # fmt: skip


class HFDatasetError(Exception):
    """A user-facing reason the dataset couldn't be read."""

    def __init__(self, message: str, *, status: int | None = None) -> None:
        super().__init__(message)
        self.status = status


@dataclass(frozen=True, slots=True)
class FieldMap:
    text: str
    title: str | None = None
    id: str | None = None
    court: str | None = None
    date: str | None = None
    citation: str | None = None

    def columns(self) -> list[str]:
        """Top-level columns the mapped fields live in."""
        names = (self.text, self.title, self.id, self.court, self.date, self.citation)
        return list(dict.fromkeys(n.split(".")[0] for n in names if n))


@dataclass(slots=True)
class DatasetInfo:
    name: str
    num_rows: int | None
    size_bytes: int | None
    license: str | None
    gated: bool
    features: dict[str, str]
    fields: FieldMap
    sample: list[dict[str, Any]] = field(default_factory=list)
    # Read through the dataset viewer API ...
    config: str | None = None
    split: str | None = None
    # ... or straight from this file in the dataset repo.
    file: str | None = None
    viewer_error: str | None = None
    """Why the viewer wasn't used, when the dataset is read from a file."""
    requested_name: str | None = None
    """The id it was asked for, when the repo has since been renamed."""

    @property
    def url(self) -> str:
        return f"{HUB_URL}/datasets/{self.name}"

    @property
    def source(self) -> str:
        return "file" if self.file else "viewer"

    @property
    def source_key(self) -> str:
        """Identifies the row sequence that ``row_index`` counts in."""
        return self.file or f"{self.config}/{self.split}"

    def row_url(self, row_idx: int) -> str:
        if self.file:
            return f"{self.url}/blob/main/{quote(self.file)}"
        return f"{self.url}/viewer/{self.config}/{self.split}?row={row_idx}"


@dataclass(slots=True)
class IngestReport:
    dataset: str
    rows_read: int = 0
    added: int = 0
    updated: int = 0
    unchanged: int = 0
    skipped: int = 0
    chunks: int = 0
    already_indexed: int = 0
    duplicates: int = 0
    notes: list[str] = field(default_factory=list)


# ---------------------------------------------------------------------------
# HTTP
# ---------------------------------------------------------------------------


def _retryable(status: int) -> bool:
    return status in (429, 500, 502, 503, 504)


class HFClient:
    """Minimal client for the Hub API, the dataset viewer API and repo files.

    The token is only ever sent to huggingface.co: httpx drops the
    ``Authorization`` header when a file download redirects to the CDN.
    """

    def __init__(
        self,
        token: str | None = None,
        *,
        transport: httpx.MockTransport | None = None,
        timeout_seconds: float = 60.0,
        retries: int = 3,
        retry_delay_seconds: float = 2.0,
    ) -> None:
        headers = {"Accept": "application/json", "User-Agent": "la-bot-ingestion"}
        if token:
            headers["Authorization"] = f"Bearer {token}"
        timeout = httpx.Timeout(timeout_seconds, connect=15.0)
        self._client = httpx.AsyncClient(
            headers=headers, timeout=timeout, transport=transport, follow_redirects=True
        )
        # Parquet is read by pyarrow in a worker thread, through a sync client.
        self._sync = httpx.Client(
            headers=headers, timeout=timeout, transport=transport, follow_redirects=True
        )
        self._retries = retries
        self._delay = retry_delay_seconds

    async def __aenter__(self) -> HFClient:
        return self

    async def __aexit__(self, *_exc: object) -> None:
        await self.aclose()

    async def aclose(self) -> None:
        await self._client.aclose()
        self._sync.close()

    async def get_json(self, url: str, params: dict[str, Any] | None = None) -> Any:
        delay = self._delay
        for attempt in range(1, self._retries + 1):
            try:
                response = await self._client.get(url, params=params)
            except httpx.HTTPError as exc:
                if attempt == self._retries:
                    raise _unreachable(exc) from exc
            else:
                if response.status_code == 200:
                    try:
                        return response.json()
                    except ValueError as exc:
                        raise HFDatasetError(
                            f"Hugging Face sent a response that isn't JSON ({url}).",
                            status=200,
                        ) from exc
                if not (_retryable(response.status_code) and attempt < self._retries):
                    raise HFDatasetError(_http_error_message(response), status=response.status_code)
            await asyncio.sleep(delay)
            delay *= 2
        raise HFDatasetError("Hugging Face did not respond.")  # pragma: no cover

    # -- repo files ----------------------------------------------------------

    @staticmethod
    def file_url(dataset: str, path: str) -> str:
        return f"{HUB_URL}/datasets/{dataset}/resolve/main/{quote(path)}"

    def read_range(self, url: str, start: int, end: int) -> tuple[bytes, int | None]:
        """Bytes ``start..end`` (inclusive) of a remote file, and the file's
        total size when the server reports it. Blocking: call from a thread."""
        delay = self._delay
        for attempt in range(1, self._retries + 1):
            try:
                with self._sync.stream(
                    "GET", url, headers={"Range": f"bytes={start}-{end}"}
                ) as response:
                    status = response.status_code
                    if status == 206:
                        total = response.headers.get("Content-Range", "").rpartition("/")[2]
                        return response.read(), int(total) if total.isdigit() else None
                    if status == 200:
                        # Range ignored: only acceptable when the whole file was wanted.
                        size = int(response.headers.get("Content-Length") or -1)
                        if start == 0 and 0 <= size <= end + 1:
                            return response.read(), size
                        raise HFDatasetError(
                            "The file server doesn't support partial downloads, so the "
                            "file can't be read without downloading all of it.",
                            status=200,
                        )
                    if status == 416:  # start beyond the end of the file
                        return b"", None
                    response.read()
                    if not (_retryable(status) and attempt < self._retries):
                        raise HFDatasetError(_http_error_message(response), status=status)
            except httpx.HTTPError as exc:
                if attempt == self._retries:
                    raise _unreachable(exc) from exc
            time.sleep(delay)
            delay *= 2
        raise HFDatasetError("Hugging Face did not respond.")  # pragma: no cover

    def file_size(self, url: str) -> int:
        _, total = self.read_range(url, 0, 0)
        if total is None:
            raise HFDatasetError("Hugging Face didn't report the file's size.")
        return total

    async def stream_lines(self, url: str) -> AsyncIterator[str]:
        """Lines of a remote text file. Stopping the iteration closes the
        connection, so only what was read is downloaded."""
        try:
            async with self._client.stream("GET", url) as response:
                if response.status_code != 200:
                    await response.aread()
                    raise HFDatasetError(_http_error_message(response), status=response.status_code)
                async for line in response.aiter_lines():
                    yield line
        except httpx.HTTPError as exc:
            raise _unreachable(exc) from exc


def _unreachable(exc: Exception) -> HFDatasetError:
    return HFDatasetError(
        f"Could not reach Hugging Face ({type(exc).__name__}). Check the internet "
        "connection, and that huggingface.co, datasets-server.huggingface.co and "
        "the download CDN (cdn-lfs.huggingface.co, *.xethub.hf.co) aren't blocked."
    )


def _http_error_message(response: httpx.Response) -> str:
    detail = ""
    try:
        body = response.json()
        if isinstance(body, dict):
            detail = str(body.get("error") or body.get("message") or "")[:200]
    except ValueError:
        pass
    status = response.status_code
    if status in (401, 403):
        return (
            f"Hugging Face refused access ({status}). The dataset may be gated or private: "
            "accept its terms on huggingface.co and set HF_TOKEN. " + detail
        ).strip()
    if status == 404:
        return f"Not found on Hugging Face (404): {response.request.url.path}. {detail}".strip()
    if status == 501 or "viewer" in detail.lower():
        return f"The Hugging Face dataset viewer can't serve this dataset ({status}). {detail}"
    return f"Hugging Face returned HTTP {status}. {detail}".strip()


# ---------------------------------------------------------------------------
# Field detection
# ---------------------------------------------------------------------------


def _feature_type(spec: Any) -> str:
    if isinstance(spec, dict):
        if "dtype" in spec:
            return str(spec["dtype"])
        if "_type" in spec:
            return str(spec["_type"])
        return "struct"
    if isinstance(spec, list):
        return "list"
    return str(spec)


def _flatten(row: dict[str, Any]) -> dict[str, Any]:
    """Lift one level of nested dicts (``metadata.court``) next to top-level fields."""
    flat: dict[str, Any] = {}
    for key, value in row.items():
        if isinstance(value, dict):
            for sub_key, sub_value in value.items():
                flat[f"{key}.{sub_key}"] = sub_value
        else:
            flat[key] = value
    return flat


def _pick(names: tuple[str, ...], available: list[str]) -> str | None:
    by_leaf: dict[str, str] = {}
    for column in available:
        by_leaf.setdefault(column.split(".")[-1].lower(), column)
    for name in names:
        if name in by_leaf:
            return by_leaf[name]
    return None


def detect_fields(
    sample_rows: list[dict[str, Any]],
    *,
    text_field: str | None = None,
    title_field: str | None = None,
) -> FieldMap:
    """Choose the columns to use. Explicit settings win; otherwise well-known
    names; for text, falling back to the string column with the longest
    values in the sample."""
    flat = [_flatten(r) for r in sample_rows]
    string_columns = sorted({k for row in flat for k, v in row.items() if isinstance(v, str)})
    if not string_columns:
        raise HFDatasetError("The dataset has no text columns.")

    def avg_len(column: str) -> float:
        values = [len(v) for row in flat if isinstance(v := row.get(column), str)]
        return sum(values) / max(len(values), 1)

    if text_field:
        if text_field not in string_columns:
            raise HFDatasetError(
                f"HF_TEXT_FIELD={text_field!r} is not a text column. Text columns: "
                + ", ".join(string_columns)
            )
        text = text_field
    else:
        named = _pick(_TEXT_FIELDS, string_columns)
        longest = max(string_columns, key=avg_len)
        # A well-known name wins unless another column is much longer (the
        # real document body).
        text = named if named and avg_len(named) * 3 >= avg_len(longest) else longest

    if title_field and title_field not in {k for row in flat for k in row}:
        raise HFDatasetError(f"HF_TITLE_FIELD={title_field!r} is not a column of the dataset.")
    others = [c for c in string_columns if c != text]
    all_columns = sorted({k for row in flat for k in row} - {text})
    return FieldMap(
        text=text,
        title=title_field or _pick(_TITLE_FIELDS, others),
        id=_pick(_ID_FIELDS, all_columns),
        court=_pick(_COURT_FIELDS, others),
        date=_pick(_DATE_FIELDS, all_columns),
        citation=_pick(_CITATION_FIELDS, all_columns),
    )


def _license_from_hub(hub: dict[str, Any]) -> str | None:
    card = hub.get("cardData") or {}
    value = card.get("license")
    if isinstance(value, list):
        value = ", ".join(str(v) for v in value)
    if value:
        return str(value)
    for tag in hub.get("tags") or []:
        if isinstance(tag, str) and tag.startswith("license:"):
            return tag.split(":", 1)[1]
    return None


# ---------------------------------------------------------------------------
# Inspection
# ---------------------------------------------------------------------------


async def inspect_dataset(
    client: HFClient,
    name: str,
    *,
    config: str | None = None,
    split: str | None = None,
    data_file: str | None = None,
    text_field: str | None = None,
    title_field: str | None = None,
) -> DatasetInfo:
    """Look the dataset up and read a few sample rows. Uses the dataset
    viewer when it can serve the dataset, else (or when ``data_file`` is
    given) one of the repo's parquet / JSON Lines files."""
    if not _DATASET_ID.fullmatch(name) or ".." in name:
        raise HFDatasetError(f"{name!r} is not a dataset id like 'owner/name'.")
    hub = await client.get_json(f"{HUB_API}/{name}")
    if not isinstance(hub, dict):
        raise HFDatasetError(f"Unexpected Hub API response for {name}.")
    canonical = str(hub.get("id") or name)  # a renamed repo answers with its new id

    viewer_error: str | None = None
    if not data_file:
        try:
            info = await _inspect_viewer(
                client, canonical, hub, config, split, text_field, title_field
            )
        except HFDatasetError as exc:
            if exc.status in (401, 403):
                raise
            viewer_error = str(exc)
            logger.info("hf_viewer_unavailable", dataset=canonical, reason=viewer_error[:200])
        else:
            info.requested_name = name if name != canonical else None
            return info

    try:
        info = await _inspect_file(
            client, canonical, hub, data_file, split, text_field, title_field
        )
    except HFDatasetError as exc:
        if viewer_error:
            raise HFDatasetError(
                f"{exc} (The dataset viewer couldn't be used either: {viewer_error})",
                status=exc.status,
            ) from exc
        raise
    info.viewer_error = viewer_error
    info.requested_name = name if name != canonical else None
    return info


def _hub_fields(hub: dict[str, Any]) -> dict[str, Any]:
    return {"license": _license_from_hub(hub), "gated": bool(hub.get("gated"))}


async def _inspect_viewer(
    client: HFClient,
    name: str,
    hub: dict[str, Any],
    config: str | None,
    split: str | None,
    text_field: str | None,
    title_field: str | None,
) -> DatasetInfo:
    splits = (await client.get_json(f"{VIEWER_API}/splits", {"dataset": name})).get("splits")
    if not splits:
        raise HFDatasetError(f"The dataset viewer lists no splits for {name}.")

    configs = list(dict.fromkeys(s["config"] for s in splits))
    chosen_config = config or ("default" if "default" in configs else configs[0])
    if chosen_config not in configs:
        raise HFDatasetError(f"Config {chosen_config!r} not found. Available: {', '.join(configs)}")
    config_splits = [s["split"] for s in splits if s["config"] == chosen_config]
    chosen_split = split or ("train" if "train" in config_splits else config_splits[0])
    if chosen_split not in config_splits:
        raise HFDatasetError(
            f"Split {chosen_split!r} not found. Available: {', '.join(config_splits)}"
        )

    page = await client.get_json(
        f"{VIEWER_API}/rows",
        {
            "dataset": name,
            "config": chosen_config,
            "split": chosen_split,
            "offset": 0,
            "length": _SAMPLE_ROWS,
        },
    )
    sample = [r["row"] for r in page.get("rows") or []]
    if not sample:
        raise HFDatasetError(f"The split {chosen_split!r} of {name} is empty.")
    features = {f["name"]: _feature_type(f.get("type")) for f in page.get("features") or []}

    size_bytes: int | None = None
    try:
        size = await client.get_json(f"{VIEWER_API}/size", {"dataset": name})
        size_bytes = (size.get("size") or {}).get("dataset", {}).get("num_bytes_parquet_files")
    except HFDatasetError:
        pass  # size is informative only

    return DatasetInfo(
        name=name,
        config=chosen_config,
        split=chosen_split,
        num_rows=page.get("num_rows_total"),
        size_bytes=size_bytes,
        features=features,
        fields=detect_fields(sample, text_field=text_field, title_field=title_field),
        sample=sample,
        **_hub_fields(hub),
    )


async def _repo_files(client: HFClient, name: str, hub: dict[str, Any]) -> list[str]:
    files = [s["rfilename"] for s in hub.get("siblings") or [] if s.get("rfilename")]
    if files:
        return files
    tree = await client.get_json(f"{HUB_API}/{name}/tree/main", {"recursive": "true"})
    return [t["path"] for t in tree or [] if t.get("type") == "file"]


def choose_data_file(files: list[str], *, split: str | None = None) -> str:
    """The data file to read: parquet over JSON Lines, a publisher's
    ``sample`` file first (small and meant for trying the data), then one
    named after the split, then the first by name."""
    data = [f for f in files if f.lower().endswith(_DATA_SUFFIXES)]
    if not data:
        raise HFDatasetError(
            "The dataset has no parquet or JSON Lines (.jsonl) files to read. "
            f"Files: {', '.join(files[:15]) or 'none'}"
        )
    wanted_split = (split or "train").lower()

    def rank(path: str) -> tuple[bool, bool, bool, str]:
        lower = path.lower()
        return (
            not lower.endswith(".parquet"),
            "sample" not in lower,
            wanted_split not in lower,
            path,
        )

    return min(data, key=rank)


async def _inspect_file(
    client: HFClient,
    name: str,
    hub: dict[str, Any],
    data_file: str | None,
    split: str | None,
    text_field: str | None,
    title_field: str | None,
) -> DatasetInfo:
    files = await _repo_files(client, name, hub)
    if data_file:
        if files and data_file not in files:
            near = [f for f in files if f.lower().endswith(_DATA_SUFFIXES)][:15]
            raise HFDatasetError(
                f"HF_DATASET_FILE={data_file!r} is not in {name}. Data files: {', '.join(near)}"
            )
        path = data_file
    else:
        path = choose_data_file(files, split=split)
    url = client.file_url(name, path)

    if path.lower().endswith(".parquet"):
        num_rows, size_bytes, features, sample = await asyncio.to_thread(
            _parquet_overview, client, url
        )
    elif path.lower().endswith(".jsonl"):
        sample = await _jsonl_sample(client, url)
        num_rows, size_bytes = None, None
        features = {k: type(v).__name__ for k, v in sample[0].items()} if sample else {}
    else:
        raise HFDatasetError(f"{path} is not a parquet or JSON Lines (.jsonl) file.")
    if not sample:
        raise HFDatasetError(f"{path} in {name} has no rows.")

    return DatasetInfo(
        name=name,
        file=path,
        split=split,
        num_rows=num_rows,
        size_bytes=size_bytes,
        features=features,
        fields=detect_fields(sample, text_field=text_field, title_field=title_field),
        sample=sample,
        **_hub_fields(hub),
    )


# ---------------------------------------------------------------------------
# Remote parquet / JSON Lines
# ---------------------------------------------------------------------------


class _RangeFile(io.RawIOBase):
    """Read-only, seekable view of a remote file over HTTP range requests,
    for pyarrow. Small reads are served from a 1 MiB block cache."""

    def __init__(self, client: HFClient, url: str, size: int) -> None:
        super().__init__()
        self._client = client
        self._url = url
        self._size = size
        self._pos = 0
        self._block_start = -1
        self._block = b""
        self.bytes_fetched = 0

    def readable(self) -> bool:
        return True

    def seekable(self) -> bool:
        return True

    def tell(self) -> int:
        return self._pos

    def seek(self, offset: int, whence: int = io.SEEK_SET) -> int:
        base = {io.SEEK_SET: 0, io.SEEK_CUR: self._pos, io.SEEK_END: self._size}[whence]
        self._pos = max(0, base + offset)
        return self._pos

    def _fetch(self, start: int, end: int) -> bytes:
        data, _ = self._client.read_range(self._url, start, end)
        self.bytes_fetched += len(data)
        return data

    def readinto(self, buffer: Any) -> int:
        view = memoryview(buffer).cast("B")
        wanted = min(len(view), self._size - self._pos)
        if wanted <= 0:
            return 0
        start = self._pos
        block_end = self._block_start + len(self._block)
        if self._block_start <= start and start + wanted <= block_end:
            offset = start - self._block_start
            data = self._block[offset : offset + wanted]
        elif wanted < _RANGE_BLOCK:
            self._block_start = start
            self._block = self._fetch(start, min(start + _RANGE_BLOCK, self._size) - 1)
            data = self._block[:wanted]
        else:
            data = self._fetch(start, start + wanted - 1)
        view[: len(data)] = data
        self._pos += len(data)
        return len(data)


def _open_parquet(client: HFClient, url: str) -> tuple[pq.ParquetFile, int]:
    size = client.file_size(url)
    try:
        return pq.ParquetFile(_RangeFile(client, url, size)), size
    except HFDatasetError:
        raise
    except Exception as exc:  # pyarrow: not a parquet file / corrupt footer
        raise HFDatasetError(f"Could not read the parquet file: {exc}") from exc


def _row_group_bytes(metadata: Any, index: int) -> dict[str, int]:
    """Compressed size of each top-level column in one row group."""
    group = metadata.row_group(index)
    sizes: dict[str, int] = {}
    for i in range(group.num_columns):
        column = group.column(i)
        top = column.path_in_schema.split(".")[0]
        sizes[top] = sizes.get(top, 0) + int(column.total_compressed_size)
    return sizes


def _check_row_group(metadata: Any, index: int, columns: list[str] | None) -> None:
    sizes = _row_group_bytes(metadata, index)
    total = sum(v for k, v in sizes.items() if columns is None or k in columns)
    if total > _MAX_ROW_GROUP_BYTES:
        raise HFDatasetError(
            f"This parquet file stores rows in blocks of {total // (1024 * 1024)} MB, too "
            "large to read piece by piece. Set HF_DATASET_FILE to a smaller file of the "
            "dataset (for example one marked 'sample')."
        )


def _parquet_overview(
    client: HFClient, url: str
) -> tuple[int, int, dict[str, str], list[dict[str, Any]]]:
    parquet, size = _open_parquet(client, url)
    metadata = parquet.metadata
    features = {f.name: str(f.type) for f in parquet.schema_arrow}
    if metadata.num_row_groups == 0:
        return int(metadata.num_rows), size, features, []
    _check_row_group(metadata, 0, None)
    table = parquet.read_row_group(0)
    return int(metadata.num_rows), size, features, table.slice(0, _SAMPLE_ROWS).to_pylist()


def _parquet_columns(parquet: pq.ParquetFile, fields: FieldMap) -> list[str]:
    """The mapped fields, plus any other column small enough to be worth
    keeping as metadata. Big unmapped columns (a second full text, say) are
    never fetched."""
    wanted = fields.columns()
    if parquet.metadata.num_row_groups == 0:
        return wanted
    sizes = _row_group_bytes(parquet.metadata, 0)
    small = [c for c in parquet.schema_arrow.names if sizes.get(c, 0) <= _SMALL_COLUMN_BYTES]
    return list(dict.fromkeys([*wanted, *small]))


def _parquet_pages(
    client: HFClient, url: str, fields: FieldMap, *, start: int, batch_size: int
) -> Iterator[list[tuple[int, dict[str, Any], bool]]]:
    parquet, _ = _open_parquet(client, url)
    metadata = parquet.metadata
    columns = _parquet_columns(parquet, fields)
    base = 0
    for group in range(metadata.num_row_groups):
        count = metadata.row_group(group).num_rows
        if base + count <= start:  # skipped row groups are never downloaded
            base += count
            continue
        _check_row_group(metadata, group, columns)
        rows = parquet.read_row_group(group, columns=columns).to_pylist()
        for first in range(max(start - base, 0), len(rows), batch_size):
            yield [
                (base + i, rows[i], False) for i in range(first, min(first + batch_size, len(rows)))
            ]
        base += count


async def _iterate_in_thread[T](items: Iterator[T]) -> AsyncIterator[T]:
    done = object()
    while True:
        item = await asyncio.to_thread(next, items, done)
        if item is done:
            return
        yield item  # type: ignore[misc]


def _parse_json_line(line: str, number: int) -> dict[str, Any] | None:
    if not line.strip():
        return None
    try:
        value = json.loads(line)
    except ValueError as exc:
        raise HFDatasetError(f"Line {number} of the file is not valid JSON.") from exc
    if not isinstance(value, dict):
        raise HFDatasetError(f"Line {number} of the file is not a JSON object.")
    return value


async def _jsonl_rows(
    client: HFClient, url: str
) -> AsyncGenerator[tuple[int, dict[str, Any]], None]:
    row_idx = 0
    number = 0
    async for line in client.stream_lines(url):
        number += 1
        row = _parse_json_line(line, number)
        if row is not None:
            yield row_idx, row
            row_idx += 1


async def _jsonl_sample(client: HFClient, url: str) -> list[dict[str, Any]]:
    sample: list[dict[str, Any]] = []
    rows = _jsonl_rows(client, url)
    try:
        async for _, row in rows:
            sample.append(row)
            if len(sample) >= _SAMPLE_ROWS:
                break
    finally:
        await rows.aclose()  # closes the download
    return sample


async def _jsonl_pages(
    client: HFClient, url: str, *, start: int, batch_size: int
) -> AsyncIterator[list[tuple[int, dict[str, Any], bool]]]:
    page: list[tuple[int, dict[str, Any], bool]] = []
    rows = _jsonl_rows(client, url)
    try:
        async for row_idx, row in rows:
            if row_idx < start:
                continue
            page.append((row_idx, row, False))
            if len(page) >= batch_size:
                yield page
                page = []
        if page:
            yield page
    finally:
        await rows.aclose()


async def _viewer_pages(
    client: HFClient, info: DatasetInfo, *, start: int, batch_size: int
) -> AsyncIterator[list[tuple[int, dict[str, Any], bool]]]:
    offset = start
    length = max(1, min(batch_size, _MAX_PAGE))
    params = {"dataset": info.name, "config": info.config, "split": info.split}
    while True:
        page = await client.get_json(
            f"{VIEWER_API}/rows", {**params, "offset": offset, "length": length}
        )
        rows = page.get("rows") or []
        if not rows:
            return
        batch: list[tuple[int, dict[str, Any], bool]] = []
        for item in rows:
            row_idx = int(item["row_idx"])
            row = item["row"]
            truncated = info.fields.text in (item.get("truncated_cells") or [])
            if truncated:
                # Large cells get cut when a page is too big: fetch the row alone.
                single = await client.get_json(
                    f"{VIEWER_API}/rows", {**params, "offset": row_idx, "length": 1}
                )
                if single.get("rows"):
                    row = single["rows"][0]["row"]
                    truncated = info.fields.text in (single["rows"][0].get("truncated_cells") or [])
            batch.append((row_idx, row, truncated))
        yield batch
        offset = batch[-1][0] + 1
        total = page.get("num_rows_total")
        if total is not None and offset >= int(total):
            return


async def iter_rows(
    client: HFClient, info: DatasetInfo, *, start: int, batch_size: int
) -> AsyncIterator[list[tuple[int, dict[str, Any], bool]]]:
    """Yield pages of (row_idx, row, text_truncated) from row ``start`` on."""
    batch_size = max(1, batch_size)
    if info.file is None:
        pages = _viewer_pages(client, info, start=start, batch_size=batch_size)
    elif info.file.lower().endswith(".parquet"):
        url = client.file_url(info.name, info.file)
        pages = _iterate_in_thread(
            _parquet_pages(client, url, info.fields, start=start, batch_size=batch_size)
        )
    else:
        pages = _jsonl_pages(
            client, client.file_url(info.name, info.file), start=start, batch_size=batch_size
        )
    async for page in pages:
        yield page


# ---------------------------------------------------------------------------
# Rows -> documents
# ---------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class NormalizedDocument:
    external_id: str
    title: str
    text: str
    checksum: str
    document_type: DocumentType
    effective_date: date | None
    source_url: str
    metadata: dict[str, Any]


def _scalar(value: Any, limit: int = 500) -> Any:
    if isinstance(value, bool | int | float):
        return value
    if isinstance(value, datetime | date):
        return value.isoformat()
    if isinstance(value, str):
        return value.strip()[:limit]
    if isinstance(value, list) and value and all(isinstance(v, str) for v in value):
        return "; ".join(v.strip() for v in value if v.strip())[:limit]
    return None


def _iso_date(value: Any) -> date | None:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if not isinstance(value, str):
        return None
    match = re.match(r"^(\d{4})-(\d{2})-(\d{2})", value.strip())
    if not match:
        return None
    try:
        return date(int(match[1]), int(match[2]), int(match[3]))
    except ValueError:
        return None


def _external_id(info: DatasetInfo, row_idx: int, raw_id: Any) -> str:
    if raw_id not in (None, "") and not isinstance(raw_id, dict | list):
        value = str(raw_id).strip()
    else:
        value = f"{info.source_key}#{row_idx}"
    if len(value) > 200:
        value = "sha256:" + hashlib.sha256(value.encode()).hexdigest()
    return value


def normalize_row(
    info: DatasetInfo, row_idx: int, row: dict[str, Any], *, text_truncated: bool = False
) -> NormalizedDocument | None:
    """One dataset row as a document, or ``None`` when it has no usable text."""
    flat = _flatten(row)
    fields = info.fields
    text = flat.get(fields.text)
    if not isinstance(text, str) or len(text.strip()) < _MIN_TEXT_CHARS:
        return None
    text = text.strip()

    def field_value(column: str | None) -> Any:
        return _scalar(flat.get(column)) if column else None

    case_name = field_value(fields.title)
    first_line = next((line.strip() for line in text.splitlines() if line.strip()), "")
    title = (str(case_name) if case_name else first_line or f"{info.name} row {row_idx}")[:500]

    metadata: dict[str, Any] = {
        "dataset": info.name,
        "dataset_url": info.url,
        "source": info.source,
        "source_key": info.source_key,
        "row_index": row_idx,
    }
    if info.file:
        metadata["file"] = info.file
    else:
        metadata["config"] = info.config
        metadata["split"] = info.split
    if info.requested_name:
        metadata["requested_as"] = info.requested_name
    if info.license:
        metadata["license"] = info.license
    if case_name:
        metadata["case_name"] = case_name
    for key, column in (
        ("court", fields.court),
        ("date", fields.date),
        ("citation", fields.citation),
    ):
        value = field_value(column)
        if value not in (None, ""):
            metadata[key] = value
    if text_truncated:
        metadata["text_truncated"] = True
    extra: dict[str, Any] = {}
    for key, raw in flat.items():
        if key == fields.text or len(extra) >= _MAX_EXTRA_FIELDS:
            continue
        value = _scalar(raw, 300)
        if value not in (None, ""):
            extra[key] = value
    if extra:
        metadata["fields"] = extra

    is_case_law = bool(fields.court or fields.citation) or "case" in info.name.lower()
    return NormalizedDocument(
        external_id=_external_id(info, row_idx, flat.get(fields.id) if fields.id else None),
        title=title,
        text=text,
        checksum=hashlib.sha256(text.encode("utf-8")).hexdigest(),
        document_type=DocumentType.JUDGMENT if is_case_law else DocumentType.OTHER,
        effective_date=_iso_date(flat.get(fields.date) if fields.date else None),
        source_url=info.row_url(row_idx),
        metadata=metadata,
    )


# ---------------------------------------------------------------------------
# Persistence
# ---------------------------------------------------------------------------


def _chunks_for(doc: NormalizedDocument, settings: Settings) -> list[LegalChunk]:
    cleaned = clean_document_text(doc.text)
    pieces = chunk_document(
        cleaned,
        max_chars=settings.ingestion_chunk_max_chars,
        overlap_chars=settings.ingestion_chunk_overlap_chars,
    )
    return [
        LegalChunk(
            chunk_index=index,
            section=None,
            article=None,
            page_number=None,
            content=piece.content,
            embedding=None,
        )
        for index, piece in enumerate(pieces)
    ]


async def _save(
    db: AsyncSession, doc: NormalizedDocument, existing: LegalDocument | None, settings: Settings
) -> str:
    """Insert or refresh one document. Returns 'added' / 'updated' / 'unchanged'."""
    if existing is not None and existing.checksum == doc.checksum:
        if existing.doc_metadata != doc.metadata or existing.title != doc.title:
            existing.doc_metadata = doc.metadata
            existing.title = doc.title
            existing.source_url = doc.source_url
            return "updated"
        return "unchanged"

    chunks = _chunks_for(doc, settings)
    if existing is None:
        document = LegalDocument(
            title=doc.title,
            jurisdiction="IN",
            source_url=doc.source_url,
            document_type=doc.document_type,
            effective_date=doc.effective_date,
            checksum=doc.checksum,
            ingestion_status=IngestionStatus.COMPLETED,
            chunk_count=len(chunks),
            source_dataset=doc.metadata["dataset"],
            external_id=doc.external_id,
            doc_metadata=doc.metadata,
        )
        document.chunks = chunks
        db.add(document)
        return "added"

    existing.chunks = chunks  # delete-orphan cascade drops the old ones
    existing.title = doc.title
    existing.source_url = doc.source_url
    existing.checksum = doc.checksum
    existing.effective_date = doc.effective_date
    existing.doc_metadata = doc.metadata
    existing.chunk_count = len(chunks)
    existing.ingestion_status = IngestionStatus.COMPLETED
    existing.ingestion_error = None
    return "updated"


async def count_indexed(db: AsyncSession, dataset: str) -> int:
    """Documents indexed from ``dataset`` (by its current or former id)."""
    stmt = select(func.count()).where(
        or_(
            LegalDocument.source_dataset == dataset,
            LegalDocument.doc_metadata["requested_as"].as_string() == dataset,
        )
    )
    return int(await db.scalar(stmt) or 0)


async def ingest_dataset(
    *,
    settings: Settings,
    session_factory: Callable[[], AsyncSession],
    client: HFClient,
    name: str,
    config: str | None = None,
    split: str | None = None,
    data_file: str | None = None,
    max_documents: int,
    batch_size: int,
    from_start: bool = False,
    on_progress: Callable[[IngestReport], None] | None = None,
) -> tuple[DatasetInfo, IngestReport]:
    """Bring the dataset's first ``max_documents`` usable rows into the
    knowledge base, committing page by page (safe to interrupt and resume).
    ``from_start`` re-reads from the first row, refreshing changed rows."""
    info = await inspect_dataset(
        client,
        name,
        config=config,
        split=split,
        data_file=data_file,
        text_field=settings.hf_text_field,
        title_field=settings.hf_title_field,
    )
    report = IngestReport(dataset=info.name)

    async with session_factory() as db:
        indexed = await count_indexed(db, info.name)
        last_row = await db.scalar(
            select(func.max(LegalDocument.doc_metadata["row_index"].as_integer())).where(
                LegalDocument.source_dataset == info.name,
                LegalDocument.doc_metadata["source_key"].as_string() == info.source_key,
            )
        )
    report.already_indexed = indexed
    if indexed >= max_documents and not from_start:
        report.notes.append(f"{indexed} documents from {info.name} are already indexed.")
        return info, report
    start = 0 if from_start or last_row is None else int(last_row) + 1
    target = max_documents if from_start else max_documents - indexed

    processed = 0
    exhausted = True
    async for page in iter_rows(client, info, start=start, batch_size=batch_size):
        docs: list[NormalizedDocument] = []
        for row_idx, row, truncated in page:
            report.rows_read += 1
            doc = normalize_row(info, row_idx, row, text_truncated=truncated)
            if doc is None:
                report.skipped += 1
                continue
            docs.append(doc)
            if processed + len(docs) >= target:
                break

        async with session_factory() as db:
            existing_rows = await db.scalars(
                select(LegalDocument).where(
                    LegalDocument.source_dataset == info.name,
                    LegalDocument.external_id.in_([d.external_id for d in docs]),
                )
            )
            existing = {d.external_id: d for d in existing_rows}
            # Same judgment text under a different row id (datasets repeat
            # records): keep the first copy, skip the rest.
            known_text = set(
                await db.scalars(
                    select(LegalDocument.checksum).where(
                        LegalDocument.source_dataset == info.name,
                        LegalDocument.checksum.in_(
                            [d.checksum for d in docs if d.external_id not in existing]
                        ),
                    )
                )
            )
            seen: set[str] = set()
            seen_text: set[str] = set()
            for doc in docs:
                if doc.external_id in seen:  # duplicate id inside the dataset
                    report.skipped += 1
                    continue
                if doc.external_id not in existing and (
                    doc.checksum in known_text or doc.checksum in seen_text
                ):
                    report.skipped += 1
                    report.duplicates += 1
                    continue
                seen.add(doc.external_id)
                seen_text.add(doc.checksum)
                outcome = await _save(db, doc, existing.get(doc.external_id), settings)
                setattr(report, outcome, getattr(report, outcome) + 1)
            try:
                await db.commit()
            except IntegrityError:
                await db.rollback()
                report.notes.append("Another ingestion wrote some of these rows at the same time.")
        processed += len(docs)
        if on_progress:
            on_progress(report)
        if processed >= target:
            exhausted = False
            break
    if exhausted:
        report.notes.append(
            f"Reached the end of {info.source_key} after {processed} new documents."
            + (" Set HF_DATASET_FILE to another file of the dataset for more." if info.file else "")
        )

    async with session_factory() as db:
        report.chunks = int(
            await db.scalar(
                select(func.coalesce(func.sum(LegalDocument.chunk_count), 0)).where(
                    LegalDocument.source_dataset == info.name
                )
            )
            or 0
        )
    return info, report


async def embed_missing(
    *,
    settings: Settings,
    session_factory: Callable[[], AsyncSession],
    limit: int | None = None,
    batch_size: int = 50,
) -> tuple[int, str | None]:
    """Embed chunks that don't have an embedding yet. Returns (embedded, stop
    reason). Resumable: stops cleanly on missing key / quota errors."""
    done = 0
    while limit is None or done < limit:
        size = batch_size if limit is None else min(batch_size, limit - done)
        async with session_factory() as db:
            chunks = list(
                await db.scalars(
                    select(LegalChunk)
                    .where(LegalChunk.embedding.is_(None))
                    .order_by(LegalChunk.document_id, LegalChunk.chunk_index)
                    .limit(size)
                )
            )
            if not chunks:
                return done, None
            try:
                vectors = await embed_texts([c.content for c in chunks], settings=settings)
            except ServiceUnavailableError as exc:
                return done, exc.message
            for chunk, vector in zip(chunks, vectors, strict=True):
                chunk.embedding = vector
            await db.commit()
            done += len(chunks)
    return done, None
