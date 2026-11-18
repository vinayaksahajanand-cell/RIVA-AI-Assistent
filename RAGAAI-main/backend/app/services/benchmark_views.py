from __future__ import annotations

from app.models import BenchmarkRun
from app.schemas.evaluation import BenchmarkRunOut


def run_to_out(r: BenchmarkRun) -> BenchmarkRunOut:
    return BenchmarkRunOut(id=r.id, framework=r.framework, status=r.status, label=r.label, config=r.config or {},
                           summary=r.summary or {}, item_count=r.item_count, duration_ms=r.duration_ms, error=r.error,
                           report_paths=r.report_paths or {}, is_baseline=r.is_baseline, created_at=r.created_at,
                           completed_at=r.completed_at)
