"""Citation parsing, sanitising and mapping to real retrieved chunks (never fabricated)."""

from __future__ import annotations

import re

from app.retrieval.types import Candidate

CITATION_RE = re.compile(r"\[(\s*\d{1,3}(?:\s*[,;]\s*\d{1,3})*\s*)\]")


def sanitize_citations(answer: str, passage_count: int) -> tuple[str, list[int], list[int]]:
    """Normalise ``[1, 2]`` → ``[1][2]`` and drop markers that reference non-existent passages.

    Returns (clean_answer, used_indices, invalid_indices).
    """
    used: list[int] = []
    invalid: list[int] = []

    def _replace(match: re.Match) -> str:
        numbers = [int(n) for n in re.split(r"[,;]", match.group(1)) if n.strip()]
        valid = []
        for n in numbers:
            if 1 <= n <= passage_count:
                valid.append(n)
                if n not in used:
                    used.append(n)
            elif n not in invalid:
                invalid.append(n)
        return "".join(f"[{n}]" for n in dict.fromkeys(valid))

    clean = CITATION_RE.sub(_replace, answer)
    clean = re.sub(r"(\[\d+\])(?:\s*\1)+", r"\1", clean)  # [2][2] → [2]
    clean = re.sub(r"[ \t]+([.,;:])", r"\1", clean)
    return clean, sorted(used), sorted(invalid)


def strip_citations(text: str) -> str:
    return CITATION_RE.sub("", text)


def build_citations(used: list[int], selected: list[Candidate]) -> list[dict]:
    by_index = {c.context_index: c for c in selected if c.context_index is not None}
    citations = []
    for n in used:
        c = by_index.get(n)
        if c is None:
            continue
        citations.append({
            "index": n,
            "chunk_id": str(c.chunk_id),
            "document_id": str(c.document_id),
            "document_name": c.document_name,
            "page_number": c.page_number,
            "page_end": c.page_end,
            "section_title": c.section_title,
            "snippet": c.snippet(320),
        })
    return citations
