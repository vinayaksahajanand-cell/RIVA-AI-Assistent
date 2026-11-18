"""Sparse lexical retrieval: Okapi BM25 computed inside PostgreSQL.

Chunks carry a ``tsvector`` (English stemming, stop-word removal) and ``bm25_len``
(token count) maintained by a trigger. Candidate chunks are found through the GIN
index, then scored with the real BM25 formula using term frequencies taken from
the tsvector positions and corpus statistics computed over the tenant's scope:

    idf(t)   = ln(1 + (N - df(t) + 0.5) / (df(t) + 0.5))
    score(d) = Σ_t idf(t) · tf(t,d)·(k1+1) / (tf(t,d) + k1·(1 - b + b·|d|/avgdl))
"""

from __future__ import annotations

from sqlalchemy import bindparam, text
from sqlalchemy.dialects.postgresql import ARRAY, UUID
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.types import Text

from app.core.config import get_settings
from app.retrieval.types import Hit, RetrievalScope

FTS_CONFIG = "english"

_TERMS_SQL = text(f"SELECT DISTINCT lexeme FROM unnest(to_tsvector('{FTS_CONFIG}', :q))")

_BM25_SQL = """
WITH scope AS (
    SELECT c.id, c.tsv, c.bm25_len
    FROM document_chunks c
    WHERE c.workspace_id = :ws AND c.chunk_type <> 'parent' {doc_filter}
),
stats AS (
    SELECT count(*)::float8 AS n, greatest(coalesce(avg(bm25_len), 1), 1)::float8 AS avgdl FROM scope
),
matched AS (
    SELECT s.id, s.tsv, s.bm25_len FROM scope s WHERE s.tsv @@ CAST(:tsq AS tsquery)
),
tf AS (
    SELECT m.id, m.bm25_len, u.lexeme AS term,
           coalesce(array_length(u.positions, 1), 1)::float8 AS tf
    FROM matched m CROSS JOIN LATERAL unnest(m.tsv) AS u(lexeme, positions, weights)
    WHERE u.lexeme = ANY(:terms)
),
df AS (
    SELECT term, count(DISTINCT id)::float8 AS df FROM tf GROUP BY term
)
SELECT tf.id,
       sum(ln(1 + (stats.n - df.df + 0.5) / (df.df + 0.5))
           * (tf.tf * (:k1 + 1)) / (tf.tf + :k1 * (1 - :b + :b * tf.bm25_len / stats.avgdl))) AS score
FROM tf JOIN df USING (term) CROSS JOIN stats
GROUP BY tf.id
ORDER BY score DESC, tf.id
LIMIT :k
"""


def _quote_lexeme(lexeme: str) -> str:
    return "'" + lexeme.replace("\\", "\\\\").replace("'", "''") + "'"


async def query_terms(session: AsyncSession, query: str) -> list[str]:
    return [r[0] for r in (await session.execute(_TERMS_SQL, {"q": query})).all()]


async def bm25_search(session: AsyncSession, scope: RetrievalScope, query: str, k: int) -> list[Hit]:
    settings = get_settings()
    terms = await query_terms(session, query)
    if not terms:
        return []
    tsquery = " | ".join(_quote_lexeme(t) for t in terms)
    doc_filter = "AND c.document_id = ANY(:doc_ids)" if scope.document_ids is not None else ""
    if scope.classifications is not None:  # RBAC clearance enforced inside the BM25 query
        doc_filter += " AND c.classification = ANY(:cls)"
    stmt = text(_BM25_SQL.format(doc_filter=doc_filter)).bindparams(bindparam("terms", type_=ARRAY(Text)))
    params = {"ws": scope.workspace_id, "tsq": tsquery, "terms": terms, "k1": settings.bm25_k1,
              "b": settings.bm25_b, "k": k}
    if scope.document_ids is not None:
        stmt = stmt.bindparams(bindparam("doc_ids", type_=ARRAY(UUID(as_uuid=True))))
        params["doc_ids"] = list(scope.document_ids)
    if scope.classifications is not None:
        stmt = stmt.bindparams(bindparam("cls", type_=ARRAY(Text)))
        params["cls"] = list(scope.classifications)
    rows = (await session.execute(stmt, params)).all()
    return [Hit(chunk_id=r.id, score=float(r.score), rank=i) for i, r in enumerate(rows, start=1)]
