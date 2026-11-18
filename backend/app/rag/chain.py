"""LLM building blocks: structured calls, query analysis, answer generation (streaming) and verification."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import TypeVar

from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage
from langchain_core.runnables import RunnableConfig
from pydantic import BaseModel

from app.core.config import get_settings
from app.llm.provider import get_chat_model
from app.rag import prompts
from app.rag.citations import strip_citations
from app.retrieval.types import Candidate

T = TypeVar("T", bound=BaseModel)
GRADE_MAX_CHARS = 4000  # ≈ 1,000 tokens; chunks default to 800 tokens, so graders see the whole chunk
TokenCallback = Callable[[str], Awaitable[None] | None]


def passages_from(selected: list[Candidate]) -> list[dict]:
    return [{
        "index": c.context_index,
        "document": c.document_name,
        "page": c.page_number,
        "page_end": c.page_end,
        "section": c.section_title,
        "text": c.context_text or c.content,
        "flagged": bool(c.metadata.get("injection_suspected")),
    } for c in selected]


async def structured_call(schema: type[T], system: str, user: str, config: RunnableConfig | None,
                          *, purpose: str, model: str | None = None) -> T:
    settings = get_settings()
    llm = get_chat_model(model or settings.fast_llm_model, temperature=0.0, max_tokens=800, purpose=purpose)
    runnable = llm.with_structured_output(schema).with_config(run_name=purpose)
    return await runnable.ainvoke([SystemMessage(system), HumanMessage(user)], config=config)


async def analyze_query(question: str, history: list[tuple[str, str]], config: RunnableConfig | None) -> prompts.QueryAnalysis:
    user = (f"Conversation history (oldest first):\n{prompts.format_history(history)}\n\n"
            f"Latest user request:\n{question}")
    return await structured_call(prompts.QueryAnalysis, prompts.ANALYZE_SYSTEM, user, config, purpose="query_analysis")


async def grade_passages(question: str, selected: list[Candidate], config: RunnableConfig | None) -> prompts.RetrievalGrade:
    # Grade on (nearly) the whole passage: relevant facts are often deep inside a long chunk.
    user = (f"Question: {question}\n\nPassages:\n"
            f"{prompts.format_passages(passages_from(selected), max_chars=GRADE_MAX_CHARS)}")
    return await structured_call(prompts.RetrievalGrade, prompts.GRADE_SYSTEM, user, config, purpose="relevance_grading")


async def rewrite_query(question: str, previous: list[str], missing: str, config: RunnableConfig | None) -> str:
    user = (f"Original question: {question}\nPrevious search queries: {previous}\n"
            f"Missing information: {missing or 'unknown'}")
    result = await structured_call(prompts.QueryRewrite, prompts.REWRITE_SYSTEM, user, config, purpose="query_rewriting")
    return result.query.strip()


async def verify_answer(question: str, answer: str, selected: list[Candidate],
                        config: RunnableConfig | None) -> prompts.VerificationResult:
    user = (f"Question: {question}\n\nPassages:\n{prompts.format_passages(passages_from(selected))}\n\n"
            f"Answer to audit:\n{answer}")
    return await structured_call(prompts.VerificationResult, prompts.VERIFY_SYSTEM, user, config,
                                 purpose="answer_verification")


def _chunk_text(chunk: BaseMessage) -> str:
    content = chunk.content
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(part.get("text", "") if isinstance(part, dict) else str(part) for part in content)
    return ""


def history_messages(history: list[tuple[str, str]]) -> list[BaseMessage]:
    messages: list[BaseMessage] = []
    for role, content in history:
        if role == "user":
            messages.append(HumanMessage(content[:4000]))
        elif role == "assistant":
            messages.append(AIMessage(strip_citations(content)[:4000]))
    return messages


def build_generation_messages(question: str, selected: list[Candidate], history: list[tuple[str, str]],
                              grounded_only: bool, query_type: str,
                              standalone: str | None = None) -> list[BaseMessage]:
    task_hint = {
        "summarization": "Provide a structured summary.",
        "comparison": "Compare the relevant items explicitly, ideally with a table.",
        "contradiction_check": "Focus on agreements and contradictions between the passages.",
        "extraction": "Extract the requested items precisely, quoting key wording where useful.",
        "report": "Write a well-structured research report with headings.",
    }.get(query_type, "")
    user = (f"Passages:\n{prompts.format_passages(passages_from(selected))}\n\n"
            f"Question: {question}"
            + (f"\n(Interpreted in context as: {standalone})" if standalone and standalone != question else "")
            + (f"\n\nTask guidance: {task_hint}" if task_hint else ""))
    return [SystemMessage(prompts.generation_system_prompt(grounded_only)), *history_messages(history),
            HumanMessage(user)]


async def stream_answer(messages: list[BaseMessage], *, model: str, temperature: float, max_tokens: int,
                        config: RunnableConfig | None, on_token: TokenCallback) -> str:
    llm = get_chat_model(model, temperature=temperature, max_tokens=max_tokens, streaming=True, purpose="generation")
    llm = llm.with_config(run_name="answer_generation")
    parts: list[str] = []
    async for chunk in llm.astream(messages, config=config):
        delta = _chunk_text(chunk)
        if delta:
            parts.append(delta)
            result = on_token(delta)
            if result is not None:
                await result
    return "".join(parts)
