"""Deterministic test doubles for the chat model.

``ScriptedChatModel`` behaves like a real LangChain chat model (streaming, structured output,
usage metadata) but derives its outputs from the prompt with simple, inspectable rules, so the
real retrieval stack, LangGraph workflow, persistence and SSE streaming can be tested offline.
It is only ever installed by the test-suite (``set_chat_model_override``).
"""

from __future__ import annotations

import re
from collections.abc import AsyncIterator, Iterator
from typing import Any

from langchain_core.callbacks import AsyncCallbackManagerForLLMRun, CallbackManagerForLLMRun
from langchain_core.language_models import BaseChatModel
from langchain_core.messages import AIMessage, AIMessageChunk, BaseMessage
from langchain_core.outputs import ChatGeneration, ChatGenerationChunk, ChatResult
from langchain_core.runnables import RunnableLambda

from app.rag import prompts

_WORD = re.compile(r"[a-z0-9]+")
_STOP = {"the", "a", "an", "of", "and", "or", "to", "in", "on", "for", "is", "are", "what", "how", "many", "does",
         "do", "which", "who", "when", "be", "by", "with", "it", "its", "can", "per", "much", "there", "this", "that"}
_PASSAGE = re.compile(r'<passage id="(\d+)"[^>]*>\n(.*?)\n</passage>', re.DOTALL)


def words(text: str) -> set[str]:
    return {w for w in _WORD.findall(text.lower()) if w not in _STOP and len(w) > 2}


def _last_human(messages: list[BaseMessage]) -> str:
    for m in reversed(messages):
        if m.type == "human":
            return str(m.content)
    return ""


def _question(text: str) -> str:
    match = re.search(r"(?:Question|Latest user request):\s*\n?(.*?)(?:\n\n|$)", text, re.DOTALL)
    return (match.group(1) if match else text).strip()


def _passages(text: str) -> dict[int, str]:
    return {int(i): body for i, body in _PASSAGE.findall(text)}


class ScriptedChatModel(BaseChatModel):
    purpose: str = "generation"
    model_name: str = "scripted-test-model"

    @property
    def _llm_type(self) -> str:
        return "scripted"

    # ── structured output ────────────────────────────────────────────────
    def with_structured_output(self, schema, **kwargs):  # type: ignore[override]
        def run(messages):
            messages = list(messages.to_messages()) if hasattr(messages, "to_messages") else list(messages)
            text = _last_human(messages)
            return self._structured(schema, text)

        return RunnableLambda(run, afunc=None)

    def _structured(self, schema, text: str):
        if schema is prompts.QueryAnalysis:
            request = text.split("Latest user request:", 1)[-1].strip()
            history = text.split("Latest user request:", 1)[0]
            small_talk = request.lower().strip(" !.?") in {"hello", "hi", "thanks", "thank you"}
            standalone = request
            # Resolve a pronoun follow-up using the previous user turn (mirrors the real prompt's intent).
            if re.search(r"\b(it|that|they|this)\b", request.lower()):
                users = re.findall(r"USER: (.*)", history)
                if users:
                    standalone = f"{request} ({users[-1]})"
            # Stand-in for the LLM security judgement: flags role-play attacks the regex rules do not cover.
            attack = "pretend" in request.lower()
            return prompts.QueryAnalysis(query_type="chitchat" if small_talk else "question",
                                         standalone_query=standalone, needs_retrieval=not small_talk,
                                         is_ambiguous=False, is_prompt_attack=attack,
                                         attack_reason="role-play to bypass access rules" if attack else "")
        if schema is prompts.RetrievalGrade:
            q = words(_question(text))
            passages = _passages(text)
            relevant = [i for i, body in passages.items() if len(q & words(body)) >= min(2, len(q))]
            return prompts.RetrievalGrade(relevant_passages=relevant, sufficient=bool(relevant),
                                          missing_information="" if relevant else "no passage matches the question")
        if schema is prompts.QueryRewrite:
            q = re.search(r"Original question: (.*)", text)
            return prompts.QueryRewrite(query=f"{q.group(1) if q else 'information'} details")
        if schema is prompts.VerificationResult:
            answer = text.split("Answer to audit:", 1)[-1]
            corpus = words(" ".join(_passages(text).values()))
            claims = []
            for sentence in re.split(r"(?<=[.!?])\s+", re.sub(r"\[\d+\]", "", answer).strip()):
                if len(words(sentence)) >= 3:
                    w = words(sentence)
                    claims.append(prompts.ClaimCheck(claim=sentence, supported=len(w & corpus) / len(w) >= 0.6,
                                                     passages=[1]))
            return prompts.VerificationResult(claims=claims, contradictions=[])
        raise TypeError(f"Unsupported schema {schema}")

    # ── free-text generation ─────────────────────────────────────────────
    def _answer(self, messages: list[BaseMessage]) -> str:
        text = _last_human(messages)
        passages = _passages(text)
        if not passages:
            return "Hello! Ask me anything about your uploaded documents."
        q = words(_question(text))
        scored = sorted(passages.items(), key=lambda kv: -len(q & words(kv[1])))
        best = [(i, body) for i, body in scored if q & words(body)][:2]
        if not best:
            return prompts.INSUFFICIENT_MESSAGE
        parts = []
        for i, body in best:
            sentences = re.split(r"(?<=[.!?])\s+", " ".join(body.split()))
            sentence = max(sentences, key=lambda s: len(q & words(s)))
            parts.append(f"{sentence.rstrip('.')} [{i}].")
        return " ".join(parts)

    def _generate(self, messages: list[BaseMessage], stop=None, run_manager: CallbackManagerForLLMRun | None = None,
                  **kwargs: Any) -> ChatResult:
        content = self._answer(messages)
        msg = AIMessage(content=content, usage_metadata={"input_tokens": 100, "output_tokens": len(content.split()),
                                                         "total_tokens": 100 + len(content.split())},
                        response_metadata={"model_name": self.model_name})
        return ChatResult(generations=[ChatGeneration(message=msg)])

    def _stream(self, messages, stop=None, run_manager=None, **kwargs) -> Iterator[ChatGenerationChunk]:
        raise NotImplementedError

    async def _astream(self, messages: list[BaseMessage], stop=None,
                       run_manager: AsyncCallbackManagerForLLMRun | None = None,
                       **kwargs: Any) -> AsyncIterator[ChatGenerationChunk]:
        content = self._answer(messages)
        tokens = re.findall(r"\S+\s*", content)
        for tok in tokens:
            yield ChatGenerationChunk(message=AIMessageChunk(content=tok))
        yield ChatGenerationChunk(message=AIMessageChunk(
            content="", usage_metadata={"input_tokens": 120, "output_tokens": len(tokens),
                                        "total_tokens": 120 + len(tokens)},
            response_metadata={"model_name": self.model_name}))


def scripted_factory(**kwargs) -> ScriptedChatModel:
    return ScriptedChatModel(purpose=kwargs.get("purpose", "generation"))
