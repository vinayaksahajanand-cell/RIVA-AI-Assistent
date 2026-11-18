"""Per-request runtime context passed to graph nodes through ``config['configurable']``."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from langchain_core.runnables import RunnableConfig

from app.core.timing import StageTimer
from app.llm.provider import UsageTracker
from app.retrieval.hybrid import HybridRetriever
from app.retrieval.types import RetrievalScope
from app.schemas.settings import GenerationSettings, RetrievalSettings, SecuritySettings

EventSink = Callable[[str, dict], None]


@dataclass
class RAGContext:
    scope: RetrievalScope
    retrieval: RetrievalSettings
    generation: GenerationSettings
    history: list[tuple[str, str]] = field(default_factory=list)
    timer: StageTimer = field(default_factory=StageTimer)
    usage: UsageTracker = field(default_factory=UsageTracker)
    retriever: HybridRetriever = field(default_factory=HybridRetriever)
    verify_answers: bool = True
    emit: EventSink | None = None
    notes: list[str] = field(default_factory=list)
    has_documents: bool = True
    # Security / RBAC
    security: SecuritySettings = field(default_factory=SecuritySettings)
    role: str = "admin"
    redact_output: bool = False  # mask PII/secrets while streaming (users without pii.view)
    emit_diagnostics: bool = True  # send retrieval details over SSE (admin/manager portals)
    guardrail_events: list[dict] = field(default_factory=list)

    KEY = "riva"

    @classmethod
    def from_config(cls, config: RunnableConfig) -> RAGContext:
        return config["configurable"][cls.KEY]

    def emit_event(self, event: str, data: dict[str, Any]) -> None:
        if self.emit is not None:
            self.emit(event, data)

    def emit_status(self, stage: str, label: str) -> None:
        self.emit_event("status", {"stage": stage, "label": label})
