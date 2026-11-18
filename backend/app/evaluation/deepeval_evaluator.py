"""DeepEval evaluation for regression testing and quality assurance (LLM-as-judge)."""

from __future__ import annotations

import asyncio
import time

from app.core.config import get_settings
from app.core.logging import get_logger
from app.evaluation.env import configure_evaluation_env
from app.evaluation.metrics import DEEPEVAL_METRICS, MetricSpec
from app.evaluation.types import MetricOutcome

log = get_logger(__name__)


def deepeval_version() -> str | None:
    try:
        import deepeval

        return deepeval.__version__
    except Exception:
        return None


class DeepEvalEvaluator:
    def __init__(self, model: str | None = None, threshold: float | None = None) -> None:
        configure_evaluation_env()
        settings = get_settings()
        if not settings.llm_configured:
            raise RuntimeError("Evaluator LLM is not configured (set OPENAI_API_KEY).")
        from deepeval.models import GPTModel

        self.model_name = model or settings.evaluation_llm_model
        self.threshold = settings.deepeval_threshold if threshold is None else threshold
        self.model = GPTModel(
            model=self.model_name,
            api_key=settings.openai_api_key.get_secret_value() if settings.openai_api_key else None,
            base_url=settings.openai_base_url,
            temperature=0,
        )
        self.timeout = settings.evaluation_timeout_seconds

    def _metric(self, key: str):
        from deepeval import metrics as dm

        common = {"threshold": self.threshold, "model": self.model, "include_reason": True, "async_mode": True}
        return {
            "answer_relevancy": dm.AnswerRelevancyMetric,
            "faithfulness": dm.FaithfulnessMetric,
            "contextual_relevancy": dm.ContextualRelevancyMetric,
            "contextual_precision": dm.ContextualPrecisionMetric,
            "contextual_recall": dm.ContextualRecallMetric,
            "hallucination": dm.HallucinationMetric,
            "summarization": dm.SummarizationMetric,
        }[key](**common)

    async def _score(self, spec: MetricSpec, *, question: str, answer: str, contexts: list[str],
                     expected_output: str | None, expected_context: list[str] | None,
                     source_text: str | None) -> MetricOutcome:
        from deepeval.test_case import LLMTestCase

        base = dict(key=spec.key, display_name=spec.display_name, higher_is_better=spec.higher_is_better,
                    requires_reference=spec.requires_reference, threshold=self.threshold)
        if spec.key in ("contextual_precision", "contextual_recall") and not expected_output:
            return MetricOutcome(**base, status="not_applicable", reason="Requires an expected answer.")
        if spec.key == "hallucination" and not expected_context:
            return MetricOutcome(**base, status="not_applicable", reason="Requires expected (ground-truth) context.")
        if spec.key == "summarization" and not source_text:
            return MetricOutcome(**base, status="not_applicable", reason="Only for summarization items with source text.")
        if spec.key in ("faithfulness", "contextual_relevancy", "contextual_precision", "contextual_recall") \
                and not contexts:
            return MetricOutcome(**base, status="not_applicable", reason="No retrieval context.")

        if spec.key == "summarization":
            case = LLMTestCase(input=source_text, actual_output=answer)
        else:
            case = LLMTestCase(input=question, actual_output=answer, expected_output=expected_output,
                               retrieval_context=contexts or None, context=expected_context or None)
        t0 = time.perf_counter()
        try:
            metric = self._metric(spec.key)
            await asyncio.wait_for(metric.a_measure(case, _show_indicator=False), timeout=self.timeout)
            score = MetricOutcome.clean_score(metric.score)
            if score is None:
                return MetricOutcome(**base, status="failed", reason="DeepEval returned no valid score.")
            # For lower-is-better metrics DeepEval's success already means score <= threshold.
            return MetricOutcome(**base, status="completed", score=score, reason=metric.reason,
                                 passed=bool(metric.success),
                                 raw={"score": score, "reason": metric.reason, "success": bool(metric.success),
                                      "seconds": round(time.perf_counter() - t0, 3)})
        except TimeoutError:
            return MetricOutcome(**base, status="failed", reason=f"Timed out after {self.timeout:.0f}s.")
        except Exception as exc:
            log.warning("DeepEval metric %s failed: %s", spec.key, exc)
            return MetricOutcome(**base, status="failed", reason=f"{exc.__class__.__name__}: {str(exc)[:300]}")

    async def evaluate(self, *, question: str, answer: str, contexts: list[str], expected_output: str | None = None,
                       expected_context: list[str] | None = None, source_text: str | None = None) -> list[MetricOutcome]:
        return list(await asyncio.gather(*(
            self._score(spec, question=question, answer=answer, contexts=contexts, expected_output=expected_output,
                        expected_context=expected_context, source_text=source_text)
            for spec in DEEPEVAL_METRICS)))
