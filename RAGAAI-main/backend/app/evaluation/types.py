from __future__ import annotations

import math
from dataclasses import dataclass, field


@dataclass
class MetricOutcome:
    key: str
    display_name: str
    higher_is_better: bool
    requires_reference: bool
    status: str  # completed | not_applicable | failed
    score: float | None = None
    reason: str | None = None
    threshold: float | None = None
    passed: bool | None = None
    raw: dict = field(default_factory=dict)

    @staticmethod
    def clean_score(value) -> float | None:
        try:
            v = float(value)
        except (TypeError, ValueError):
            return None
        if math.isnan(v) or math.isinf(v):
            return None
        return max(0.0, min(1.0, v))
