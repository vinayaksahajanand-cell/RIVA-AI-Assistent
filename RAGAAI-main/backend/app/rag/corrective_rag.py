"""Corrective RAG: grade retrieved evidence, rewrite the query and retry when it is insufficient."""

from __future__ import annotations

from typing import Literal

from langchain_core.runnables import RunnableConfig

from app.core.logging import get_logger
from app.rag import chain
from app.rag.context import RAGContext
from app.rag.state import RAGState

log = get_logger(__name__)


async def grade_node(state: RAGState, config: RunnableConfig) -> dict:
    ctx = RAGContext.from_config(config)
    outcome = state["outcome"]
    if not outcome.selected:
        return {"sufficient": False, "grade": {"status": "no_candidates", "relevant": [], "missing": "No passages"}}
    ctx.emit_status("grading", "Checking evidence relevance")
    try:
        async with ctx.timer.astage("relevance_grading"):
            grade = await chain.grade_passages(state["standalone_query"], outcome.selected, config)
    except Exception as exc:  # fail open: grading is an optimisation, never a hard dependency
        log.warning("Relevance grading failed: %s", exc)
        ctx.notes.append("Relevance grading unavailable; all retrieved passages were used.")
        return {"sufficient": True, "grade": {"status": "failed", "error": exc.__class__.__name__}}

    valid = {c.context_index for c in outcome.selected}
    relevant = sorted({i for i in grade.relevant_passages if i in valid})
    for c in outcome.selected:
        c.relevant = c.context_index in relevant
    if relevant:
        # Keep only passages judged relevant, renumbered so the prompt stays contiguous.
        kept = [c for c in outcome.selected if c.relevant]
        for c in outcome.selected:
            if not c.relevant:
                c.selected = False
                c.context_index = None
        for i, c in enumerate(kept, start=1):
            c.context_index = i
        outcome.selected = kept
    sufficient = bool(grade.sufficient and relevant)
    return {"sufficient": sufficient,
            "grade": {"status": "completed", "relevant": relevant, "sufficient": grade.sufficient,
                      "missing": grade.missing_information}}


def route_after_grade(state: RAGState, config: RunnableConfig) -> Literal["generate", "rewrite", "insufficient"]:
    ctx = RAGContext.from_config(config)
    if state.get("sufficient"):
        return "generate"
    if state.get("attempts", 0) < ctx.retrieval.max_corrective_attempts:
        return "rewrite"
    return "insufficient"


async def rewrite_node(state: RAGState, config: RunnableConfig) -> dict:
    ctx = RAGContext.from_config(config)
    ctx.emit_status("rewriting", "Refining the search query")
    queries = list(state.get("search_queries") or [state["standalone_query"]])
    try:
        async with ctx.timer.astage("query_rewriting"):
            new_query = await chain.rewrite_query(state["standalone_query"], queries,
                                                  (state.get("grade") or {}).get("missing", ""), config)
        if new_query and new_query not in queries:
            queries.append(new_query)
    except Exception as exc:
        log.warning("Query rewriting failed: %s", exc)
    return {"search_queries": queries, "attempts": state.get("attempts", 0) + 1}
