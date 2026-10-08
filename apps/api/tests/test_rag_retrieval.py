"""Tests for app.services.rag.retrieval.

`reciprocal_rank_fusion` is pure logic (no DB) — the fusion math is the part
most worth getting right and easiest to get subtly wrong, so it's tested in
isolation with plain lists. `hybrid_search` needs a real Postgres (pgvector +
the generated `content_tsv` column both have to actually work), so that part
is one integration test — see conftest.db_txn_session.
"""

from __future__ import annotations

import pytest

from app.core.config import get_settings
from app.models.legal_document import DocumentType, LegalChunk, LegalDocument
from app.services.rag import retrieval as retrieval_module
from app.services.rag.retrieval import reciprocal_rank_fusion

# ---------------------------------------------------------------------------
# reciprocal_rank_fusion — pure logic, no DB
# ---------------------------------------------------------------------------


def test_rrf_ranks_item_present_in_both_lists_above_single_list_items() -> None:
    # "b" is #2 in one list and #1 in the other — it should outrank "a" and
    # "c", which each only appear once.
    vector_ranked = ["a", "b", "c"]
    keyword_ranked = ["b", "d", "e"]

    fused = reciprocal_rank_fusion([vector_ranked, keyword_ranked])

    assert fused[0] == "b"
    assert set(fused) == {"a", "b", "c", "d", "e"}


def test_rrf_preserves_order_for_a_single_list() -> None:
    assert reciprocal_rank_fusion([["x", "y", "z"]]) == ["x", "y", "z"]


def test_rrf_handles_empty_lists() -> None:
    assert reciprocal_rank_fusion([]) == []
    assert reciprocal_rank_fusion([[], []]) == []


def test_rrf_can_let_a_dual_signal_item_outrank_a_single_signal_top_rank() -> None:
    # This is the actual point of fusing two signals rather than picking one:
    # "49" is the *worst* vector match (rank 50 of 50) but the *only* keyword
    # match, while "0" is the best vector match but has no keyword support at
    # all. Appearing in both ranked lists lets "49" outscore "0".
    long_list = [str(i) for i in range(50)]  # "0" = vector rank 1 ... "49" = vector rank 50
    fused = reciprocal_rank_fusion([long_list, ["49"]])
    assert fused[0] == "49"


# ---------------------------------------------------------------------------
# hybrid_search — needs Postgres (pgvector + generated tsvector column)
# ---------------------------------------------------------------------------


async def test_hybrid_search_fuses_vector_and_keyword_signals(
    db_txn_session: object, monkeypatch: pytest.MonkeyPatch
) -> None:
    document = LegalDocument(
        title="Digital Personal Data Protection Act, 2023",
        source_url="https://example.com/dpdpa",
        document_type=DocumentType.ACT,
        checksum="abc",
    )
    db_txn_session.add(document)  # type: ignore[attr-defined]
    await db_txn_session.flush()  # type: ignore[attr-defined]

    # relevant: matches the query both semantically (vector) and lexically
    # ("data fiduciary" appears verbatim).
    relevant_vector = [1.0] + [0.0] * 767
    relevant = LegalChunk(
        document_id=document.id,
        chunk_index=0,
        content="A data fiduciary must obtain consent before processing personal data.",
        embedding=relevant_vector,
    )
    # unrelated on both axes.
    unrelated = LegalChunk(
        document_id=document.id,
        chunk_index=1,
        content="Filing fees for a company incorporation form are prescribed separately.",
        embedding=[0.0] * 767 + [1.0],
    )
    db_txn_session.add_all([relevant, unrelated])  # type: ignore[attr-defined]
    await db_txn_session.flush()  # type: ignore[attr-defined]

    async def fake_embed_query(query: str, *, settings: object) -> list[float]:
        return relevant_vector

    monkeypatch.setattr(retrieval_module, "embed_query", fake_embed_query)

    results = await retrieval_module.hybrid_search(
        "data fiduciary consent",
        db=db_txn_session,
        settings=get_settings(),  # type: ignore[arg-type]
    )

    assert len(results) == 2
    assert results[0].chunk_id == relevant.id
    assert results[0].document_title == document.title


async def test_hybrid_search_returns_empty_list_when_no_chunks_exist(
    db_txn_session: object, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def fake_embed_query(query: str, *, settings: object) -> list[float]:
        return [0.0] * 768

    monkeypatch.setattr(retrieval_module, "embed_query", fake_embed_query)

    results = await retrieval_module.hybrid_search(
        "anything",
        db=db_txn_session,
        settings=get_settings(),  # type: ignore[arg-type]
    )
    assert results == []


# ---------------------------------------------------------------------------
# Keyword-only retrieval (no embeddings / no GEMINI_API_KEY) + citation metadata
# ---------------------------------------------------------------------------


async def _keyword_fixture(db: object) -> tuple[LegalChunk, LegalChunk, LegalDocument]:
    # Test fixture text, not a real judgment.
    judgment = LegalDocument(
        title="TEST FIXTURE v. EXAMPLE",
        source_url="https://huggingface.co/datasets/example/cases/viewer/default/train?row=0",
        document_type=DocumentType.JUDGMENT,
        checksum="kw-1",
        source_dataset="example/cases",
        external_id="case-1",
        doc_metadata={
            "dataset": "example/cases",
            "case_name": "TEST FIXTURE v. EXAMPLE",
            "court": "Test Court",
            "date": "2020-01-02",
        },
    )
    db.add(judgment)  # type: ignore[attr-defined]
    await db.flush()  # type: ignore[attr-defined]
    relevant = LegalChunk(
        document_id=judgment.id,
        chunk_index=0,
        content="The tenant withheld the security deposit refund; the landlord claimed damages.",
        embedding=None,
    )
    # Shares only generic legal words with the query below.
    generic = LegalChunk(
        document_id=judgment.id,
        chunk_index=1,
        content="The High Court of the State held that the law applies to every person in India.",
        embedding=None,
    )
    db.add_all([relevant, generic])  # type: ignore[attr-defined]
    await db.flush()  # type: ignore[attr-defined]
    return relevant, generic, judgment


async def test_keyword_only_search_works_without_embeddings(
    db_txn_session: object, monkeypatch: pytest.MonkeyPatch
) -> None:
    relevant, generic, judgment = await _keyword_fixture(db_txn_session)

    async def must_not_embed(query: str, *, settings: object) -> list[float]:
        raise AssertionError("no chunk has an embedding: the query must not be embedded")

    monkeypatch.setattr(retrieval_module, "embed_query", must_not_embed)

    results = await retrieval_module.hybrid_search(
        "Under Indian law, can a landlord keep my security deposit?",
        db=db_txn_session,  # type: ignore[arg-type]
        settings=get_settings(),
    )

    assert [r.chunk_id for r in results] == [relevant.id]
    assert generic.id not in [r.chunk_id for r in results]
    # Citation metadata comes from the dataset only.
    assert results[0].metadata == {
        "court": "Test Court",
        "date": "2020-01-02",
        "case_name": "TEST FIXTURE v. EXAMPLE",
        "dataset": "example/cases",
    }
    assert results[0].document_title == judgment.title


async def test_unrelated_question_retrieves_nothing(
    db_txn_session: object, monkeypatch: pytest.MonkeyPatch
) -> None:
    await _keyword_fixture(db_txn_session)
    results = await retrieval_module.hybrid_search(
        "What is the law on cryptocurrency taxation in India?",
        db=db_txn_session,  # type: ignore[arg-type]
        settings=get_settings(),
    )
    assert results == []


async def test_embedding_outage_falls_back_to_keyword_search(
    db_txn_session: object, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.core.errors import ServiceUnavailableError

    relevant, _generic, _doc = await _keyword_fixture(db_txn_session)
    relevant.embedding = [1.0] + [0.0] * 767  # some chunks embedded
    await db_txn_session.flush()  # type: ignore[attr-defined]

    async def quota_exhausted(query: str, *, settings: object) -> list[float]:
        raise ServiceUnavailableError("quota", code="embeddings_rate_limited")

    monkeypatch.setattr(retrieval_module, "embed_query", quota_exhausted)

    results = await retrieval_module.hybrid_search(
        "security deposit refund",
        db=db_txn_session,  # type: ignore[arg-type]
        settings=get_settings(),
    )
    assert [r.chunk_id for r in results] == [relevant.id]


def test_required_term_matches() -> None:
    assert retrieval_module.required_term_matches(1) == 1
    assert retrieval_module.required_term_matches(2) == 1
    assert retrieval_module.required_term_matches(5) == 2
