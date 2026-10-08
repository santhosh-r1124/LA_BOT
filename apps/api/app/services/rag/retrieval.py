"""Hybrid search over `legal_chunks`: pgvector cosine similarity + Postgres
full-text search, fused with Reciprocal Rank Fusion (RRF) — Phase 4.

Why RRF instead of a dedicated reranker model: the user asked for free
alternatives only (no paid services) for the rest of this project. RRF is a
simple, well-established rank-fusion technique (Cormack, Clarke & Buettcher,
2009) — it needs no extra model, no extra API call, and no training, and it's
what Postgres/pgvector "hybrid search" reference implementations (e.g.
Supabase's) use for exactly this reason. See docs/adr/0007-hybrid-search-and-grounding.md
for the full writeup, including why a hard cosine-distance threshold was
rejected as a guardrail (uncalibratable without a real corpus — see below).

The vector half only runs when chunks have embeddings and the query can be
embedded (``GEMINI_API_KEY``); otherwise retrieval is keyword-only rather
than empty. The keyword half matches *any* query term (an all-terms match
almost never happens for a natural-language question) but only keeps chunks
containing enough of the question's informative terms — words such as
"law", "India" or "court" occur in nearly every judgment and say nothing
about relevance on their own.

This is deliberately separate from `app.services.ingestion.search.semantic_search`
(Phase 3's admin debug tool, plain vector search) rather than replacing it —
that endpoint exists to let an admin sanity-check what an embedding actually
retrieves, and hybrid+RRF re-ordering would muddy that signal.
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from dataclasses import dataclass, field

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.errors import ServiceUnavailableError
from app.core.logging import get_logger
from app.models.legal_document import LegalChunk, LegalDocument
from app.services.ingestion.embed import embed_query

logger = get_logger("app.retrieval")

# The original RRF paper found result quality insensitive to k in a wide
# range around 60 — no corpus-specific tuning needed, unlike a raw distance
# cutoff would require.
_RRF_K = 60
# How many candidates each individual ranker (vector, keyword) contributes to
# the fusion pool, before RRF picks the final top_k.
_CANDIDATE_POOL = 20
# Keyword candidates examined for term coverage before the pool is cut.
_KEYWORD_SCAN = 200

# Stemmed (Postgres "english") forms of words that appear in almost every
# Indian legal text: they rank results but never make a chunk relevant alone.
_GENERIC_LEXEMES = frozenset(
    {
        "law", "legal", "india", "indian", "act", "section", "court", "case", "right",
        "rule", "person", "shall", "provis", "appel", "respond", "petition", "order",
        "judgment", "high", "suprem", "state", "govern", "mean", "differ", "basic",
        "principl", "general", "posit", "avail", "regard", "explain", "tell", "would",
        "may", "can", "also",
    }
)  # fmt: skip


@dataclass(frozen=True, slots=True)
class RetrievedChunk:
    chunk_id: uuid.UUID
    document_id: uuid.UUID
    document_title: str
    source_url: str
    section: str | None
    article: str | None
    content: str
    # Dataset-provided metadata (court, date, citation, dataset...); empty for
    # sources that don't carry any. Never inferred.
    metadata: dict[str, object] = field(default_factory=dict)


def reciprocal_rank_fusion[T](ranked_lists: Sequence[Sequence[T]], *, k: int = _RRF_K) -> list[T]:
    """Combine several ranked ID lists into one, by summing ``1/(k+rank)``
    across lists. An ID that appears near the top of *either* list, or
    moderately high in *both*, outranks one that only ever appears near the
    top of a single list — that's the whole point of fusing two different
    retrieval signals instead of picking one.
    """
    scores: dict[T, float] = {}
    for ranked in ranked_lists:
        for rank, item in enumerate(ranked, start=1):
            scores[item] = scores.get(item, 0.0) + 1.0 / (k + rank)
    return sorted(scores, key=lambda item: scores[item], reverse=True)


def required_term_matches(informative_terms: int) -> int:
    """How many informative query terms a chunk must contain."""
    return 1 if informative_terms <= 2 else 2


async def _query_lexemes(query: str, *, db: AsyncSession) -> list[str]:
    row = await db.execute(select(func.tsvector_to_array(func.to_tsvector("english", query))))
    return sorted(set(row.scalar_one() or []))


def _or_tsquery(lexemes: Sequence[str]) -> str:
    # Lexemes come from to_tsvector, but quote them anyway so no input can
    # ever be read as tsquery syntax.
    return " | ".join("'" + lex.replace("\\", "\\\\").replace("'", "''") + "'" for lex in lexemes)


async def _vector_ranked_ids(
    query_vector: list[float], *, db: AsyncSession, limit: int
) -> list[uuid.UUID]:
    distance = LegalChunk.embedding.cosine_distance(query_vector)
    stmt = (
        select(LegalChunk.id)
        .where(LegalChunk.embedding.is_not(None))
        .order_by(distance)
        .limit(limit)
    )
    return list((await db.execute(stmt)).scalars().all())


async def _keyword_ranked_ids(query: str, *, db: AsyncSession, limit: int) -> list[uuid.UUID]:
    lexemes = await _query_lexemes(query, db=db)
    if not lexemes:
        return []
    informative = [lex for lex in lexemes if lex not in _GENERIC_LEXEMES] or lexemes
    needed = required_term_matches(len(informative))

    tsquery = func.to_tsquery("simple", _or_tsquery(lexemes))
    rank = func.ts_rank_cd(LegalChunk.content_tsv, tsquery)
    stmt = (
        select(LegalChunk.id, func.tsvector_to_array(LegalChunk.content_tsv))
        .where(LegalChunk.content_tsv.op("@@")(tsquery))
        .order_by(rank.desc())
        .limit(_KEYWORD_SCAN)
    )
    wanted = set(informative)
    ranked: list[uuid.UUID] = []
    for chunk_id, chunk_lexemes in (await db.execute(stmt)).all():
        if len(wanted.intersection(chunk_lexemes)) >= needed:
            ranked.append(chunk_id)
            if len(ranked) >= limit:
                break
    return ranked


async def _query_vector(query: str, *, db: AsyncSession, settings: Settings) -> list[float] | None:
    has_vectors = await db.scalar(
        select(LegalChunk.id).where(LegalChunk.embedding.is_not(None)).limit(1)
    )
    if has_vectors is None:
        return None
    try:
        return await embed_query(query, settings=settings)
    except ServiceUnavailableError as exc:
        logger.info("retrieval_keyword_only", reason=exc.code)
        return None


async def hybrid_search(
    query: str, *, db: AsyncSession, settings: Settings, top_k: int = 6
) -> list[RetrievedChunk]:
    # An empty knowledge base can't match anything: skip the embedding call
    # (it costs free-tier quota and latency on every chat message).
    if await db.scalar(select(LegalChunk.id).limit(1)) is None:
        return []

    query_vector = await _query_vector(query, db=db, settings=settings)
    vector_ids = (
        await _vector_ranked_ids(query_vector, db=db, limit=_CANDIDATE_POOL)
        if query_vector is not None
        else []
    )
    keyword_ids = await _keyword_ranked_ids(query, db=db, limit=_CANDIDATE_POOL)

    fused_ids = reciprocal_rank_fusion([vector_ids, keyword_ids])[:top_k]
    if not fused_ids:
        return []

    stmt = (
        select(LegalChunk, LegalDocument)
        .join(LegalDocument, LegalChunk.document_id == LegalDocument.id)
        .where(LegalChunk.id.in_(fused_ids))
    )
    rows = (await db.execute(stmt)).all()
    by_id = {chunk.id: (chunk, document) for chunk, document in rows}

    results: list[RetrievedChunk] = []
    for chunk_id in fused_ids:
        pair = by_id.get(chunk_id)
        if pair is None:  # pragma: no cover - defensive, shouldn't happen
            continue
        chunk, document = pair
        results.append(
            RetrievedChunk(
                chunk_id=chunk.id,
                document_id=document.id,
                document_title=document.title,
                source_url=document.source_url,
                section=chunk.section,
                article=chunk.article,
                content=chunk.content,
                metadata=citation_metadata(document),
            )
        )
    return results


_CITATION_KEYS = ("court", "date", "citation", "case_name")


def citation_metadata(document: LegalDocument) -> dict[str, object]:
    """The citation fields a dataset actually provided, plus the dataset name."""
    meta = document.doc_metadata or {}
    out: dict[str, object] = {k: meta[k] for k in _CITATION_KEYS if meta.get(k)}
    if document.source_dataset:
        out["dataset"] = document.source_dataset
    return out
