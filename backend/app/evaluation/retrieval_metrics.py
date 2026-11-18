"""Information-retrieval metrics for comparing dense, BM25, hybrid and hybrid+rerank retrieval.

Relevance is judged per chunk against a benchmark item: the chunk must come from the expected
document and (when an expected supporting context is given) contain most of its content words.
"""

from __future__ import annotations

import math
import re

_WORD = re.compile(r"[a-z0-9]+")
_STOP = {"the", "a", "an", "of", "and", "or", "to", "in", "on", "for", "is", "are", "be", "by", "with", "at",
         "as", "it", "that", "this", "from", "was", "were", "will", "shall", "must", "may", "not"}


def content_words(text: str) -> set[str]:
    return {w for w in _WORD.findall(text.lower()) if w not in _STOP and len(w) > 1}


def _doc_matches(document_name: str, expected: str | list[str]) -> bool:
    names = [expected] if isinstance(expected, str) else expected
    name = document_name.lower()
    for n in names:
        n = n.lower()
        stem = n.rsplit(".", 1)[0]
        if name == n or name == stem or name.startswith(stem):
            return True
    return False


def is_relevant(document_name: str, filename: str, content: str, expected_document: str | list[str] | None,
                expected_context: str | None, min_coverage: float = 0.6) -> bool:
    if expected_document and not (_doc_matches(document_name, expected_document)
                                  or _doc_matches(filename, expected_document)):
        return False
    if expected_context:
        target = content_words(expected_context)
        if not target:
            return True
        return len(target & content_words(content)) / len(target) >= min_coverage
    return bool(expected_document)


def precision_at_k(rels: list[bool], k: int) -> float:
    return sum(rels[:k]) / k if k else 0.0


def recall_at_k(rels: list[bool], total_relevant: int, k: int) -> float:
    if total_relevant <= 0:
        return 0.0
    return min(1.0, sum(rels[:k]) / total_relevant)


def hit_at_k(rels: list[bool], k: int) -> float:
    return 1.0 if any(rels[:k]) else 0.0


def mrr(rels: list[bool]) -> float:
    for i, r in enumerate(rels, start=1):
        if r:
            return 1.0 / i
    return 0.0


def ndcg_at_k(rels: list[bool], total_relevant: int, k: int) -> float:
    dcg = sum(1.0 / math.log2(i + 1) for i, r in enumerate(rels[:k], start=1) if r)
    ideal = sum(1.0 / math.log2(i + 1) for i in range(1, min(total_relevant, k) + 1))
    return dcg / ideal if ideal else 0.0


def score_ranking(rels: list[bool], total_relevant: int, ks: tuple[int, ...] = (1, 3, 5, 10)) -> dict[str, float]:
    out: dict[str, float] = {"mrr": mrr(rels)}
    for k in ks:
        out[f"recall@{k}"] = recall_at_k(rels, total_relevant, k)
        out[f"precision@{k}"] = precision_at_k(rels, k)
        out[f"hit@{k}"] = hit_at_k(rels, k)
        out[f"ndcg@{k}"] = ndcg_at_k(rels, total_relevant, k)
    return out
