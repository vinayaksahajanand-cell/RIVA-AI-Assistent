"""RAGAS evaluation (ragas ≥ 0.4 ``metrics.collections`` API, LLM-as-judge).

Metric availability is decided per interaction:

* always (question + answer + contexts): Faithfulness, Answer Relevancy, Context Precision
  (reference-free variant judged against the generated answer)
* only with a reference answer: Context Recall, Answer Correctness, Context Entity Recall,
  Noise Sensitivity, and the reference-based Context Precision

Unavailable metrics are reported as ``not_applicable`` with a reason — never as zero.
"""

from __future__ import annotations

import asyncio
import time

from app.core.config import get_settings
from app.core.logging import get_logger
from app.evaluation.env import configure_evaluation_env
from app.evaluation.metrics import RAGAS_METRICS, MetricSpec
from app.evaluation.types import MetricOutcome

log = get_logger(__name__)


def ragas_version() -> str | None:
    try:
        import ragas

        return ragas.__version__
    except Exception:
        return None


class RagasEvaluator:
    def __init__(self, model: str | None = None, embedding_model: str | None = None) -> None:
        configure_evaluation_env()
        settings = get_settings()
        if not settings.llm_configured:
            raise RuntimeError("Evaluator LLM is not configured (set OPENAI_API_KEY).")
        from openai import AsyncOpenAI
        from ragas.embeddings import OpenAIEmbeddings
        from ragas.llms import llm_factory

        self.model = model or settings.evaluation_llm_model
        client = AsyncOpenAI(
            api_key=settings.openai_api_key.get_secret_value() if settings.openai_api_key else "not-needed",
            base_url=settings.openai_base_url,
            timeout=settings.llm_timeout_seconds,
            max_retries=settings.llm_max_retries,
        )
        self.llm = llm_factory(self.model, client=client)
        self.embeddings = OpenAIEmbeddings(client=client,
                                           model=embedding_model or settings.evaluation_embedding_model)
        self.timeout = settings.evaluation_timeout_seconds

    def _metric(self, key: str, with_reference: bool):
        from ragas.metrics import collections as m

        if key == "faithfulness":
            return m.Faithfulness(llm=self.llm)
        if key == "answer_relevancy":
            return m.AnswerRelevancy(llm=self.llm, embeddings=self.embeddings)
        if key == "context_precision":
            return m.ContextPrecisionWithReference(llm=self.llm) if with_reference \
                else m.ContextPrecisionWithoutReference(llm=self.llm)
        if key == "context_recall":
            return m.ContextRecall(llm=self.llm)
        if key == "answer_correctness":
            return m.AnswerCorrectness(llm=self.llm, embeddings=self.embeddings)
        if key == "context_entity_recall":
            return m.ContextEntityRecall(llm=self.llm)
        if key == "noise_sensitivity":
            return m.NoiseSensitivity(llm=self.llm)
        raise KeyError(key)

    @staticmethod
    def _kwargs(key: str, question: str, answer: str, contexts: list[str], reference: str | None) -> dict:
        if key == "faithfulness":
            return {"user_input": question, "response": answer, "retrieved_contexts": contexts}
        if key == "answer_relevancy":
            return {"user_input": question, "response": answer}
        if key == "context_precision":
            if reference:
                return {"user_input": question, "reference": reference, "retrieved_contexts": contexts}
            return {"user_input": question, "response": answer, "retrieved_contexts": contexts}
        if key == "context_recall":
            return {"user_input": question, "retrieved_contexts": contexts, "reference": reference}
        if key == "answer_correctness":
            return {"user_input": question, "response": answer, "reference": reference}
        if key == "context_entity_recall":
            return {"reference": reference, "retrieved_contexts": contexts}
        if key == "noise_sensitivity":
            return {"user_input": question, "response": answer, "reference": reference,
                    "retrieved_contexts": contexts}
        raise KeyError(key)

    async def _score(self, spec: MetricSpec, question: str, answer: str, contexts: list[str],
                     reference: str | None) -> MetricOutcome:
        base = dict(key=spec.key, display_name=spec.display_name, higher_is_better=spec.higher_is_better,
                    requires_reference=spec.requires_reference)
        if spec.requires_reference and not reference:
            return MetricOutcome(**base, status="not_applicable",
                                 reason="Requires a reference answer (add one to compute this metric).")
        if not contexts and spec.key != "answer_relevancy":
            return MetricOutcome(**base, status="not_applicable", reason="No retrieved context to evaluate.")
        t0 = time.perf_counter()
        try:
            metric = self._metric(spec.key, with_reference=bool(reference))
            result = await asyncio.wait_for(
                metric.ascore(**self._kwargs(spec.key, question, answer, contexts, reference)), timeout=self.timeout)
            score = MetricOutcome.clean_score(getattr(result, "value", result))
            reason = getattr(result, "reason", None)
            variant = (" (reference-based)" if reference else " (reference-free, judged against the answer)") \
                if spec.key == "context_precision" else ""
            if score is None:
                return MetricOutcome(**base, status="failed",
                                     reason="The evaluator returned no valid score (NaN).",
                                     raw={"value": str(getattr(result, "value", result))})
            return MetricOutcome(**base, status="completed", score=score,
                                 reason=(reason or "") + variant or None,
                                 raw={"value": score, "reason": reason, "seconds": round(time.perf_counter() - t0, 3),
                                      "metric_class": metric.__class__.__name__})
        except TimeoutError:
            return MetricOutcome(**base, status="failed", reason=f"Timed out after {self.timeout:.0f}s.")
        except Exception as exc:
            log.warning("RAGAS metric %s failed: %s", spec.key, exc)
            return MetricOutcome(**base, status="failed", reason=f"{exc.__class__.__name__}: {str(exc)[:300]}")

    async def evaluate(self, question: str, answer: str, contexts: list[str],
                       reference: str | None = None) -> list[MetricOutcome]:
        return list(await asyncio.gather(*(self._score(spec, question, answer, contexts, reference)
                                           for spec in RAGAS_METRICS)))
