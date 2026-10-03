"""Download a source document over HTTP."""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from urllib.parse import urljoin

import httpx

from app.core.config import Settings
from app.core.errors import ValidationAppError
from app.core.net_safety import assert_public_url

_USER_AGENT = "legal-platform-ingestion/0.1 (+contact: platform-team)"
_TIMEOUT_SECONDS = 30.0
_MAX_REDIRECTS = 5


@dataclass(frozen=True, slots=True)
class FetchedDocument:
    url: str
    content_type: str
    raw_bytes: bytes
    checksum: str  # sha256 hex of raw_bytes


async def fetch_document(url: str, *, settings: Settings) -> FetchedDocument:
    """Download ``url``. Raises :class:`ValidationAppError` on any failure —
    ingestion callers catch broadly and record it on the ``LegalDocument`` row
    rather than letting one bad source fail the whole request.

    Redirects are followed manually so every hop passes the SSRF check
    (``app/core/net_safety.py``) — httpx's automatic redirects would let a
    public URL bounce the request to an internal address.
    """
    current = url
    try:
        async with httpx.AsyncClient(
            timeout=_TIMEOUT_SECONDS, follow_redirects=False, headers={"User-Agent": _USER_AGENT}
        ) as client:
            for _ in range(_MAX_REDIRECTS + 1):
                await assert_public_url(current, allowed_hosts=settings.ingestion_allowed_hosts)
                response = await client.get(current)
                if response.is_redirect:
                    location = response.headers.get("location")
                    if not location:
                        break
                    current = urljoin(current, location)
                    continue
                break
            else:
                raise ValidationAppError("Too many redirects.", code="fetch_failed")
            response.raise_for_status()
    except httpx.HTTPError as exc:
        raise ValidationAppError(
            f"Could not download the source document: {exc}", code="fetch_failed"
        ) from exc

    body = response.content
    if len(body) > settings.ingestion_max_source_bytes:
        raise ValidationAppError(
            f"Source document exceeds the ingestion size limit "
            f"({settings.ingestion_max_source_bytes // (1024 * 1024)} MB).",
            code="fetch_too_large",
        )

    content_type = response.headers.get("content-type", "").split(";")[0].strip().lower()
    checksum = hashlib.sha256(body).hexdigest()
    return FetchedDocument(
        url=current, content_type=content_type, raw_bytes=body, checksum=checksum
    )
