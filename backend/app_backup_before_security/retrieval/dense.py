"""Dense vector retrieval with pgvector (HNSW, cosine distance)."""

from __future__ import annotations

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models import DocumentChunk
from app.retrieval.types import Hit, RetrievalScope


async def dense_search(session: AsyncSession, scope: RetrievalScope, query_vector: list[float], k: int,
                       embedding_model: str) -> list[Hit]:
    settings = get_settings()
    # Larger ef_search improves recall; iterative scans keep filtered HNSW queries from returning too few rows.
    await session.execute(text(f"SET LOCAL hnsw.ef_search = {int(max(settings.hnsw_ef_search, k * 2))}"))
    await session.execute(text("SET LOCAL hnsw.iterative_scan = 'relaxed_order'"))

    distance = DocumentChunk.embedding.cosine_distance(query_vector)
    stmt = (
        select(DocumentChunk.id, (1 - distance).label("similarity"))
        .where(
            DocumentChunk.workspace_id == scope.workspace_id,
            DocumentChunk.chunk_type != "parent",
            DocumentChunk.embedding.is_not(None),
            DocumentChunk.embedding_model == embedding_model,
        )
        .order_by(distance)
        .limit(k)
    )
    if scope.document_ids is not None:
        stmt = stmt.where(DocumentChunk.document_id.in_(scope.document_ids))
    rows = (await session.execute(stmt)).all()
    # relaxed_order may return slightly out-of-order rows: re-sort by exact similarity.
    rows = sorted(rows, key=lambda r: r.similarity, reverse=True)
    return [Hit(chunk_id=r.id, score=float(r.similarity), rank=i) for i, r in enumerate(rows, start=1)]
