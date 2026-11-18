"""Chat model factory (OpenAI or any OpenAI-compatible endpoint) plus token usage tracking."""

from __future__ import annotations

import re
from collections.abc import Callable
from typing import Any

from langchain_core.callbacks import BaseCallbackHandler
from langchain_core.language_models import BaseChatModel
from langchain_core.outputs import LLMResult

from app.core.config import get_settings
from app.core.errors import ServiceUnavailable

_REASONING_MODEL = re.compile(r"^(o\d|gpt-5)", re.IGNORECASE)

ChatModelFactory = Callable[..., BaseChatModel]
_factory_override: ChatModelFactory | None = None


def set_chat_model_override(factory: ChatModelFactory | None) -> None:
    """Test hook: replace the chat model factory (e.g. with a fake model)."""
    global _factory_override
    _factory_override = factory


def is_reasoning_model(model: str) -> bool:
    return bool(_REASONING_MODEL.match(model))


def get_chat_model(model: str | None = None, *, temperature: float | None = None, max_tokens: int | None = None,
                   streaming: bool = False, purpose: str = "generation") -> BaseChatModel:
    settings = get_settings()
    model = model or settings.llm_model
    if _factory_override is not None:
        return _factory_override(model=model, temperature=temperature, max_tokens=max_tokens,
                                 streaming=streaming, purpose=purpose)
    if not settings.llm_configured:
        raise ServiceUnavailable("The language model is not configured. Set OPENAI_API_KEY in backend/.env.")
    from langchain_openai import ChatOpenAI

    kwargs: dict[str, Any] = {
        "model": model,
        "api_key": settings.openai_api_key.get_secret_value() if settings.openai_api_key else "not-needed",
        "base_url": settings.openai_base_url,
        "timeout": settings.llm_timeout_seconds,
        "max_retries": settings.llm_max_retries,
        "streaming": streaming,
        "stream_usage": True,
        "max_tokens": max_tokens or settings.llm_max_tokens,
        "tags": [f"riva:{purpose}"],
    }
    if is_reasoning_model(model):
        kwargs["reasoning_effort"] = "low"  # reasoning models do not accept temperature
    else:
        kwargs["temperature"] = settings.llm_temperature if temperature is None else temperature
    return ChatOpenAI(**kwargs)


class UsageTracker(BaseCallbackHandler):
    """Aggregates token usage and LLM call counts across every model call in a request."""

    def __init__(self) -> None:
        self.prompt_tokens = 0
        self.completion_tokens = 0
        self.calls = 0
        self.saw_usage = False
        self.by_model: dict[str, dict[str, int]] = {}

    def on_llm_end(self, response: LLMResult, **kwargs: Any) -> None:
        self.calls += 1
        for generations in response.generations:
            for gen in generations:
                message = getattr(gen, "message", None)
                usage = getattr(message, "usage_metadata", None) if message is not None else None
                if usage:
                    self._add(message.response_metadata.get("model_name", "unknown"),
                              usage.get("input_tokens", 0), usage.get("output_tokens", 0))
                    return
        token_usage = (response.llm_output or {}).get("token_usage") or {}
        if token_usage:
            self._add((response.llm_output or {}).get("model_name", "unknown"),
                      token_usage.get("prompt_tokens", 0), token_usage.get("completion_tokens", 0))

    def _add(self, model: str, prompt: int, completion: int) -> None:
        self.saw_usage = True
        self.prompt_tokens += int(prompt or 0)
        self.completion_tokens += int(completion or 0)
        entry = self.by_model.setdefault(model, {"prompt": 0, "completion": 0})
        entry["prompt"] += int(prompt or 0)
        entry["completion"] += int(completion or 0)

    @property
    def total_tokens(self) -> int:
        return self.prompt_tokens + self.completion_tokens

    def estimated_cost(self) -> float | None:
        pricing = get_settings().model_pricing
        if not pricing or not self.saw_usage:
            return None
        cost = 0.0
        for model, usage in self.by_model.items():
            price = pricing.get(model) or next((v for k, v in pricing.items() if model.startswith(k)), None)
            if price is None:
                return None
            cost += usage["prompt"] / 1e6 * price["input"] + usage["completion"] / 1e6 * price["output"]
        return round(cost, 6)
