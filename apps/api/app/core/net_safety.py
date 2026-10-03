"""Outbound-URL safety (SSRF defence) for server-side fetches.

The ingestion pipeline downloads whatever URL a catalog entry or an admin
supplies — and since dynamic discovery (docs/adr/0011) those URLs can come
from third-party datasets. Without a check, a row pointing at
``http://169.254.169.254/`` (cloud metadata) or ``http://localhost:6379``
would make the API fetch internal resources on an attacker's behalf.

Every hop (including each redirect) must pass ``assert_public_url``:

* scheme is http/https;
* if ``INGESTION_ALLOWED_HOSTS`` is set, the host is one of them (or a
  subdomain) — the strongest setting for production;
* every address the host resolves to is globally routable (no private,
  loopback, link-local, CGNAT, multicast or reserved ranges).

Residual risk, documented in docs/adr/0014: DNS can change between this
check and httpx's own connection (rebinding). An allow-list closes that.
"""

from __future__ import annotations

import asyncio
import ipaddress
import socket
from urllib.parse import urlsplit

from app.core.errors import ValidationAppError


class UnsafeUrlError(ValidationAppError):
    code = "unsafe_url"
    message = "This URL can't be fetched."


def _host_allowed(host: str, allowed_hosts: list[str]) -> bool:
    host = host.lower().rstrip(".")
    return any(host == a or host.endswith(f".{a}") for a in (h.lower() for h in allowed_hosts))


def _is_public(address: str) -> bool:
    ip = ipaddress.ip_address(address)
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        ip = ip.ipv4_mapped
    return ip.is_global and not ip.is_multicast


async def assert_public_url(url: str, *, allowed_hosts: list[str]) -> None:
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https"):
        raise UnsafeUrlError(f"Only http(s) URLs can be fetched (got {parts.scheme!r}).")
    host = parts.hostname
    if not host:
        raise UnsafeUrlError("URL has no host.")
    if allowed_hosts and not _host_allowed(host, allowed_hosts):
        raise UnsafeUrlError(f"Host {host!r} is not in INGESTION_ALLOWED_HOSTS.")

    try:
        literal = ipaddress.ip_address(host)
    except ValueError:
        literal = None
    if literal is not None:
        addresses = [str(literal)]
    else:
        port = parts.port or (443 if parts.scheme == "https" else 80)
        try:
            infos = await asyncio.get_running_loop().getaddrinfo(
                host, port, type=socket.SOCK_STREAM
            )
        except socket.gaierror as exc:
            raise UnsafeUrlError(f"Could not resolve host {host!r}.") from exc
        addresses = [str(info[4][0]) for info in infos]

    if not addresses or not all(_is_public(a) for a in addresses):
        raise UnsafeUrlError(f"Host {host!r} resolves to a non-public address.")
