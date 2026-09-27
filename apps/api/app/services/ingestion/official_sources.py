"""Curated catalogue of official Indian legal sources for the knowledge base.

Every URL points at a Government of India publication host — India Code
(``indiacode.nic.in``, Legislative Department), the Legislative Department
itself (``legislative.gov.in``) or the issuing ministry (``meity.gov.in``) —
never a commercial mirror. Seed them with::

    uv run python -m app.scripts.seed_corpus

Coverage follows FRD §3 (IT/technology, business/corporate, IP, plus the
Constitution and the property/document statutes behind the document
assistant's stamping/registration guidance).

Government sites occasionally move files. The seeding script records a
``FAILED`` row with the reason instead of crashing, so a moved URL shows up in
``GET /api/v1/admin/legal-sources?status=FAILED`` — update the URL here and
re-run with ``--retry-failed``.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.models.legal_document import DocumentType


@dataclass(frozen=True, slots=True)
class OfficialSource:
    title: str
    law_name: str
    source_url: str
    document_type: DocumentType = DocumentType.ACT
    # Rough grouping, for the seeding script's --only filter.
    area: str = "general"


OFFICIAL_SOURCES: tuple[OfficialSource, ...] = (
    # ---- IT / technology law -------------------------------------------
    OfficialSource(
        title="The Information Technology Act, 2000",
        law_name="Information Technology Act, 2000",
        source_url="https://www.indiacode.nic.in/bitstream/123456789/13116/1/it_act_2000_updated.pdf",
        area="it",
    ),
    OfficialSource(
        title="The Digital Personal Data Protection Act, 2023",
        law_name="Digital Personal Data Protection Act, 2023",
        source_url="https://www.meity.gov.in/static/uploads/2024/06/2bf1f0e9f04e6fb4f8fef35e82c42aa5.pdf",
        area="it",
    ),
    OfficialSource(
        title="The Telecommunications Act, 2023",
        law_name="Telecommunications Act, 2023",
        source_url="https://www.indiacode.nic.in/bitstream/123456789/20101/1/A2023-44.pdf",
        area="it",
    ),
    # ---- Business / corporate ------------------------------------------
    OfficialSource(
        title="The Indian Contract Act, 1872",
        law_name="Indian Contract Act, 1872",
        source_url="https://www.indiacode.nic.in/bitstream/123456789/2187/1/A1872-9.pdf",
        area="business",
    ),
    OfficialSource(
        title="The Companies Act, 2013",
        law_name="Companies Act, 2013",
        source_url="https://www.indiacode.nic.in/bitstream/123456789/2114/3/a2013-18.pdf",
        area="business",
    ),
    OfficialSource(
        title="The Limited Liability Partnership Act, 2008",
        law_name="Limited Liability Partnership Act, 2008",
        source_url="https://www.indiacode.nic.in/bitstream/123456789/2023/1/A2009-06.pdf",
        area="business",
    ),
    OfficialSource(
        title="The Consumer Protection Act, 2019",
        law_name="Consumer Protection Act, 2019",
        source_url="https://www.indiacode.nic.in/bitstream/123456789/16939/1/a2019-35.pdf",
        area="business",
    ),
    OfficialSource(
        title="The Specific Relief Act, 1963",
        law_name="Specific Relief Act, 1963",
        source_url="https://www.indiacode.nic.in/bitstream/123456789/1583/7/A1963-47.pdf",
        area="business",
    ),
    OfficialSource(
        title="The Indian Partnership Act, 1932",
        law_name="Indian Partnership Act, 1932",
        source_url="https://www.indiacode.nic.in/bitstream/123456789/20142/1/the_indian_partnership_act_1932.pdf",
        area="business",
    ),
    # ---- Intellectual property -----------------------------------------
    OfficialSource(
        title="The Copyright Act, 1957",
        law_name="Copyright Act, 1957",
        source_url="https://www.indiacode.nic.in/bitstream/123456789/1367/5/a1957-14.pdf",
        area="ip",
    ),
    OfficialSource(
        title="The Trade Marks Act, 1999",
        law_name="Trade Marks Act, 1999",
        source_url="https://www.indiacode.nic.in/bitstream/123456789/1993/5/a1999-47.pdf",
        area="ip",
    ),
    OfficialSource(
        title="The Patents Act, 1970",
        law_name="Patents Act, 1970",
        source_url="https://www.indiacode.nic.in/bitstream/123456789/1392/1/A1970-39.pdf",
        area="ip",
    ),
    # ---- Documents: stamping & registration (central Acts; states amend) --
    OfficialSource(
        title="The Registration Act, 1908",
        law_name="Registration Act, 1908",
        source_url="https://www.indiacode.nic.in/bitstream/123456789/2190/1/A1908-16.pdf",
        area="documents",
    ),
    OfficialSource(
        title="The Indian Stamp Act, 1899",
        law_name="Indian Stamp Act, 1899",
        source_url="https://www.indiacode.nic.in/bitstream/123456789/20095/1/the_indian_stamp_act,_1899.pdf",
        area="documents",
    ),
    # ---- Constitution ---------------------------------------------------
    OfficialSource(
        title="The Constitution of India",
        law_name="Constitution of India",
        source_url="https://www.legislative.gov.in/static/uploads/2025/07/359f70a69695affb9d72f8393102bd2e.pdf",
        document_type=DocumentType.OTHER,
        area="constitution",
    ),
)
