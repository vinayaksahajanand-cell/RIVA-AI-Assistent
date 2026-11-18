"""Monotonic stage timer used to build the per-answer performance breakdown."""

from __future__ import annotations

import time
from contextlib import asynccontextmanager, contextmanager
from dataclasses import dataclass, field


@dataclass
class StageTimer:
    """Records stage durations with ``time.perf_counter`` (monotonic, high resolution).

    Durations accumulate, so a stage executed twice (e.g. retrieval during
    corrective RAG) reports its total time.
    """

    started_at: float = field(default_factory=time.perf_counter)
    stages: dict[str, float] = field(default_factory=dict)
    marks: dict[str, float] = field(default_factory=dict)

    @contextmanager
    def stage(self, name: str):
        t0 = time.perf_counter()
        try:
            yield
        finally:
            self.add(name, time.perf_counter() - t0)

    @asynccontextmanager
    async def astage(self, name: str):
        t0 = time.perf_counter()
        try:
            yield
        finally:
            self.add(name, time.perf_counter() - t0)

    def add(self, name: str, seconds: float) -> None:
        self.stages[name] = self.stages.get(name, 0.0) + seconds

    def mark(self, name: str) -> None:
        """Record an absolute point in time (seconds since timer start), first call wins."""
        self.marks.setdefault(name, time.perf_counter() - self.started_at)

    def elapsed(self) -> float:
        return time.perf_counter() - self.started_at

    def as_ms(self) -> dict[str, float]:
        return {k: round(v * 1000, 2) for k, v in self.stages.items()}
