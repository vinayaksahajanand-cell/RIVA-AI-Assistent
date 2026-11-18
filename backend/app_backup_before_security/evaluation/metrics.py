"""Metric registry: display names, score direction, prerequisites and methodology text."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class MetricSpec:
    key: str
    display_name: str
    framework: str
    higher_is_better: bool
    requires_reference: bool
    description: str


RAGAS_METRICS: list[MetricSpec] = [
    MetricSpec("faithfulness", "Faithfulness", "ragas", True, False,
               "Share of answer claims that can be inferred from the retrieved context."),
    MetricSpec("answer_relevancy", "Answer Relevancy", "ragas", True, False,
               "How well the answer addresses the question (questions regenerated from the answer are "
               "compared with the original by embedding similarity)."),
    MetricSpec("context_precision", "Context Precision", "ragas", True, False,
               "Whether relevant passages are ranked above irrelevant ones. Without a reference answer it is "
               "judged against the generated answer; with one, against the reference."),
    MetricSpec("context_recall", "Context Recall", "ragas", True, True,
               "Share of reference-answer claims that are supported by the retrieved context."),
    MetricSpec("answer_correctness", "Answer Correctness", "ragas", True, True,
               "Factual overlap (F1) with the reference answer, blended with semantic similarity."),
    MetricSpec("context_entity_recall", "Context Entity Recall", "ragas", True, True,
               "Share of entities in the reference answer that appear in the retrieved context."),
    MetricSpec("noise_sensitivity", "Noise Sensitivity", "ragas", False, True,
               "How often the answer contains incorrect claims drawn from retrieved context. Lower is better."),
]

DEEPEVAL_METRICS: list[MetricSpec] = [
    MetricSpec("answer_relevancy", "Answer Relevancy", "deepeval", True, False,
               "Share of answer statements that are relevant to the input."),
    MetricSpec("faithfulness", "Faithfulness", "deepeval", True, False,
               "Share of answer claims that do not contradict the retrieval context."),
    MetricSpec("contextual_relevancy", "Contextual Relevancy", "deepeval", True, False,
               "Share of retrieval-context statements relevant to the input."),
    MetricSpec("contextual_precision", "Contextual Precision", "deepeval", True, True,
               "Whether relevant retrieval-context nodes are ranked higher (needs expected output)."),
    MetricSpec("contextual_recall", "Contextual Recall", "deepeval", True, True,
               "Share of expected-output sentences attributable to the retrieval context."),
    MetricSpec("hallucination", "Hallucination", "deepeval", False, True,
               "Share of ground-truth contexts contradicted by the answer (needs expected context). "
               "Lower is better."),
    MetricSpec("summarization", "Summarization", "deepeval", True, True,
               "Alignment and coverage of a summary versus its source (summarization items only)."),
]

SPECS = {(m.framework, m.key): m for m in RAGAS_METRICS + DEEPEVAL_METRICS}

MODE_LABELS = {
    "online": "Online evaluation (no reference answer)",
    "reference": "Reference-based evaluation",
    "offline": "Offline benchmark evaluation",
}

RAGAS_METHODOLOGY = (
    "RAGAS {version} LLM-as-judge metrics computed with evaluator model '{model}' over the question, the "
    "generated answer and the exact passages given to the generator{ref}. Scores are 0-1 (shown ×100). "
    "Metrics that need a reference answer are N/A until one is provided. These are quality judgements, not "
    "retrieval similarity scores."
)
DEEPEVAL_METHODOLOGY = (
    "DeepEval {version} LLM-as-judge metrics (evaluator '{model}', pass threshold {threshold}). DeepEval and "
    "RAGAS use different prompts and formulas, so similarly named metrics are not interchangeable."
)
