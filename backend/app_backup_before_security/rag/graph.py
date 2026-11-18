"""LangGraph workflow for RIVA's corrective, self-verifying RAG.

    START → analyze ─┬─(small talk)──────────────→ respond_directly ─────────────→ finalize → END
                     └→ retrieve → grade ─┬─ sufficient ──→ generate → verify ───→ finalize
                            ↑             ├─ retry left ──→ rewrite ─┐
                            └─────────────┼──────────────────────────┘
                                          └─ exhausted ───→ insufficient ────────→ finalize
"""

from __future__ import annotations

import time
from functools import lru_cache
from typing import Literal

from langchain_core.runnables import RunnableConfig
from langgraph.graph import END, START, StateGraph

from app.core.logging import get_logger
from app.rag import chain
from app.rag.citations import build_citations, sanitize_citations
from app.rag.context import RAGContext
from app.rag.corrective_rag import grade_node, rewrite_node, route_after_grade
from app.rag.prompts import DIRECT_SYSTEM, INSUFFICIENT_MESSAGE
from app.rag.state import RAGState
from app.retrieval.serialize import retrieval_payload

log = get_logger(__name__)


async def analyze_node(state: RAGState, config: RunnableConfig) -> dict:
    ctx = RAGContext.from_config(config)
    ctx.emit_status("analyzing", "Analyzing your question")
    question = " ".join(state["question"].split())
    async with ctx.timer.astage("query_processing"):
        try:
            analysis = await chain.analyze_query(question, ctx.history, config)
            standalone = analysis.standalone_query.strip() or question
            result = {"standalone_query": standalone, "query_type": analysis.query_type,
                      "needs_retrieval": analysis.needs_retrieval or analysis.query_type != "chitchat",
                      "is_ambiguous": analysis.is_ambiguous}
        except Exception as exc:
            log.warning("Query analysis failed, using the raw question: %s", exc)
            ctx.notes.append("Query analysis unavailable; the original question was used for search.")
            result = {"standalone_query": question, "query_type": "question", "needs_retrieval": True,
                      "is_ambiguous": False}
    queries = [result["standalone_query"]]
    if result["standalone_query"].lower() != question.lower():
        queries.append(question)  # search both the rewritten and the literal wording
    return {**result, "search_queries": queries, "attempts": 0}


def route_after_analyze(state: RAGState, config: RunnableConfig) -> Literal["retrieve", "respond_directly", "insufficient"]:
    ctx = RAGContext.from_config(config)
    if not state.get("needs_retrieval", True):
        return "respond_directly"
    if not ctx.has_documents:
        return "insufficient"
    return "retrieve"


async def retrieve_node(state: RAGState, config: RunnableConfig) -> dict:
    ctx = RAGContext.from_config(config)
    attempt = state.get("attempts", 0)
    ctx.emit_status("retrieving", "Searching your documents" if attempt == 0 else "Searching again with a refined query")
    outcome = await ctx.retriever.retrieve(query=state["standalone_query"], search_queries=state["search_queries"],
                                           scope=ctx.scope, cfg=ctx.retrieval, timer=ctx.timer)
    if outcome.config.get("reranker_applied"):
        ctx.emit_status("reranked", "Reranked results with cross-encoder")
    return {"outcome": outcome}


def _emit_retrieval(ctx: RAGContext, state: RAGState, success: bool) -> None:
    outcome = state.get("outcome")
    if outcome is None:
        return
    ctx.emit_event("retrieval", retrieval_payload(outcome, query=state.get("standalone_query", state["question"]),
                                                  attempts=state.get("attempts", 0) + 1, success=success,
                                                  grade=state.get("grade") or {}))


async def _stream(ctx: RAGContext, messages, config: RunnableConfig) -> str:
    def on_token(delta: str) -> None:
        ctx.timer.mark("first_token")
        ctx.emit_event("token", {"delta": delta})

    return await chain.stream_answer(messages, model=ctx.generation.model, temperature=ctx.generation.temperature,
                                     max_tokens=ctx.generation.max_tokens, config=config, on_token=on_token)


async def generate_node(state: RAGState, config: RunnableConfig) -> dict:
    ctx = RAGContext.from_config(config)
    _emit_retrieval(ctx, state, success=True)
    ctx.emit_status("generating", "Generating answer")
    messages = chain.build_generation_messages(state["question"], state["outcome"].selected, ctx.history,
                                               ctx.generation.grounded_only, state.get("query_type", "question"),
                                               standalone=state.get("standalone_query"))
    async with ctx.timer.astage("llm_generation"):
        answer = await _stream(ctx, messages, config)
    status = "insufficient_context" if answer.strip().startswith(INSUFFICIENT_MESSAGE[:40]) else "completed"
    return {"answer": answer, "status": status}


async def respond_directly_node(state: RAGState, config: RunnableConfig) -> dict:
    from langchain_core.messages import HumanMessage, SystemMessage

    ctx = RAGContext.from_config(config)
    ctx.emit_status("generating", "Replying")
    async with ctx.timer.astage("llm_generation"):
        answer = await _stream(ctx, [SystemMessage(DIRECT_SYSTEM), *chain.history_messages(ctx.history[-4:]),
                                     HumanMessage(state["question"])], config)
    return {"answer": answer, "status": "completed", "verification": {"status": "skipped",
                                                                       "notes": "Conversational reply; no document claims."}}


async def insufficient_node(state: RAGState, config: RunnableConfig) -> dict:
    ctx = RAGContext.from_config(config)
    _emit_retrieval(ctx, state, success=False)
    ctx.timer.mark("first_token")
    ctx.emit_event("token", {"delta": INSUFFICIENT_MESSAGE})
    if not ctx.has_documents:
        ctx.notes.append("No indexed documents are available in the selected scope.")
    return {"answer": INSUFFICIENT_MESSAGE, "status": "insufficient_context",
            "verification": {"status": "skipped", "notes": "No answer was generated from documents."}}


async def verify_node(state: RAGState, config: RunnableConfig) -> dict:
    ctx = RAGContext.from_config(config)
    outcome = state.get("outcome")
    if state.get("status") != "completed" or not ctx.verify_answers or not outcome or not outcome.selected:
        return {"verification": {"status": "skipped"}}
    ctx.emit_status("verifying", "Verifying answer grounding")
    t0 = time.perf_counter()
    try:
        result = await chain.verify_answer(state["question"], state["answer"], outcome.selected, config)
    except Exception as exc:
        log.warning("Answer verification failed: %s", exc)
        return {"verification": {"status": "failed", "notes": f"Verification unavailable ({exc.__class__.__name__})."}}
    finally:
        ctx.timer.add("answer_verification", time.perf_counter() - t0)
    claims = result.claims
    supported = [c for c in claims if c.supported]
    return {"verification": {
        "status": "completed",
        "grounded": (len(supported) == len(claims)) if claims else None,
        "supported_claims": len(supported),
        "total_claims": len(claims),
        "unsupported_claims": [c.claim for c in claims if not c.supported],
        "contradictions": result.contradictions,
    }}


async def finalize_node(state: RAGState, config: RunnableConfig) -> dict:
    ctx = RAGContext.from_config(config)
    outcome = state.get("outcome")
    selected = outcome.selected if outcome else []
    answer, used, invalid = sanitize_citations(state.get("answer", ""), len(selected))
    verification = dict(state.get("verification") or {"status": "not_run"})
    notes = list(ctx.notes)
    if invalid:
        notes.append(f"Removed citation markers that referenced non-existent passages: {invalid}.")
    if notes:
        verification["notes"] = " ".join(filter(None, [verification.get("notes"), *notes]))
    citations = build_citations(used, selected) if state.get("status") == "completed" else []
    return {"answer": answer.strip(), "citations": citations, "verification": verification}


@lru_cache
def build_graph():
    graph = StateGraph(RAGState)
    graph.add_node("analyze", analyze_node)
    graph.add_node("retrieve", retrieve_node)
    graph.add_node("grade", grade_node)
    graph.add_node("rewrite", rewrite_node)
    graph.add_node("generate", generate_node)
    graph.add_node("respond_directly", respond_directly_node)
    graph.add_node("insufficient", insufficient_node)
    graph.add_node("verify", verify_node)
    graph.add_node("finalize", finalize_node)

    graph.add_edge(START, "analyze")
    graph.add_conditional_edges("analyze", route_after_analyze,
                                {"retrieve": "retrieve", "respond_directly": "respond_directly",
                                 "insufficient": "insufficient"})
    graph.add_edge("retrieve", "grade")
    graph.add_conditional_edges("grade", route_after_grade,
                                {"generate": "generate", "rewrite": "rewrite", "insufficient": "insufficient"})
    graph.add_edge("rewrite", "retrieve")
    graph.add_edge("generate", "verify")
    graph.add_edge("verify", "finalize")
    graph.add_edge("respond_directly", "finalize")
    graph.add_edge("insufficient", "finalize")
    graph.add_edge("finalize", END)
    return graph.compile()


async def run_rag(question: str, ctx: RAGContext, *, run_id=None, run_name: str = "riva_rag",
                  metadata: dict | None = None) -> RAGState:
    config: RunnableConfig = {
        "configurable": {RAGContext.KEY: ctx},
        "callbacks": [ctx.usage],
        "run_name": run_name,
        "metadata": metadata or {},
        "recursion_limit": 40,
    }
    if run_id is not None:
        config["run_id"] = run_id
    return await build_graph().ainvoke({"question": question}, config=config)
