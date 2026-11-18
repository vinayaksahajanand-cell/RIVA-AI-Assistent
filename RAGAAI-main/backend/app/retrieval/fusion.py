"""Reciprocal Rank Fusion (Cormack et al., 2009).

    RRF(d) = Σ_i  w_i / (k + rank_i(d))

Only ranks are combined, so cosine similarities and BM25 scores (which live on
incomparable scales) are never added together.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field

from app.retrieval.types import Hit


@dataclass
class FusedHit:
    chunk_id: uuid.UUID
    rrf_score: float
    fused_rank: int = 0
    ranks: dict[str, int] = field(default_factory=dict)
    scores: dict[str, float] = field(default_factory=dict)


def reciprocal_rank_fusion(result_lists: dict[str, list[Hit]], k: int = 60,
                           weights: dict[str, float] | None = None) -> list[FusedHit]:
    if k <= 0:
        raise ValueError("RRF constant k must be positive")
    weights = weights or {}
    fused: dict[uuid.UUID, FusedHit] = {}
    for source, hits in result_lists.items():
        w = weights.get(source, 1.0)
        if w == 0:
            continue
        for hit in hits:
            entry = fused.setdefault(hit.chunk_id, FusedHit(chunk_id=hit.chunk_id, rrf_score=0.0))
            # A chunk can appear in several lists of the same source (multi-query); keep its best rank.
            base = source.split("#", 1)[0]
            if base not in entry.ranks or hit.rank < entry.ranks[base]:
                entry.ranks[base] = hit.rank
                entry.scores[base] = hit.score
            entry.rrf_score += w / (k + hit.rank)
    # Exact RRF ties are common with two lists (rank 1+3 vs rank 3+1). Break them deterministically —
    # best single rank, then dense rank, then BM25 rank — never by random IDs, so results are reproducible.
    inf = float("inf")
    ordered = sorted(fused.values(), key=lambda f: (-round(f.rrf_score, 12), min(f.ranks.values()),
                                                    f.ranks.get("dense", inf), f.ranks.get("bm25", inf),
                                                    str(f.chunk_id)))
    for i, item in enumerate(ordered, start=1):
        item.fused_rank = i
    return ordered
