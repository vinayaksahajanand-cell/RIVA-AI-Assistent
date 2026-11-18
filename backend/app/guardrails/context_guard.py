"""Context guardrails: neutralise indirect prompt injection hidden inside retrieved documents.

Chunks are scanned at ingestion (``metadata.injection_suspected``). At query time flagged chunks are
either excluded from the LLM context (default) or have the offending lines replaced, so instructions
planted in a document can never steer the model.
"""

from __future__ import annotations

from app.ingestion.cleaning import detect_prompt_injection
from app.retrieval.types import Candidate


def sanitize_text(text: str) -> tuple[str, int]:
    removed = 0
    kept = []
    for line in text.split("\n"):
        if detect_prompt_injection(line):
            kept.append("[instruction-like text removed by RIVA guardrails]")
            removed += 1
        else:
            kept.append(line)
    return "\n".join(kept), removed


def guard_context(selected: list[Candidate], exclude_flagged: bool) -> tuple[list[Candidate], list[dict]]:
    """Return the passages that may be shown to the LLM, plus a report of what was changed."""
    safe: list[Candidate] = []
    report: list[dict] = []
    for c in selected:
        flagged = bool(c.metadata.get("injection_suspected")) or bool(detect_prompt_injection(c.context_text or c.content))
        if not flagged:
            safe.append(c)
            continue
        if exclude_flagged:
            c.selected = False
            c.context_index = None
            report.append({"chunk_id": str(c.chunk_id), "document": c.document_name, "action": "excluded"})
            continue
        c.context_text, removed = sanitize_text(c.context_text or c.content)
        report.append({"chunk_id": str(c.chunk_id), "document": c.document_name, "action": "sanitized",
                       "lines_removed": removed})
        safe.append(c)
    for i, c in enumerate(safe, start=1):
        c.context_index = i
    return safe, report
