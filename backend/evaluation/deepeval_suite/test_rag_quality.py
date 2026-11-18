"""DeepEval regression tests for the RIVA RAG pipeline.

Each benchmark item becomes a test case: the real RAG graph answers the question over the sample
corpus and DeepEval's LLM-judge metrics must pass their thresholds. Run with:

    python -m pytest evaluation/deepeval_suite -q          # plain pytest
    deepeval test run evaluation/deepeval_suite/test_rag_quality.py   # DeepEval CLI (same tests)

Skipped automatically when OPENAI_API_KEY is not configured (the judges need an LLM).
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(BACKEND_DIR))

from app.core.config import get_settings  # noqa: E402
from app.evaluation.env import configure_evaluation_env  # noqa: E402

configure_evaluation_env()

pytestmark = pytest.mark.skipif(not get_settings().llm_configured,
                                reason="DeepEval judges need OPENAI_API_KEY (see README → DeepEval).")

DATASET = "sample_benchmark"


def _items():
    from app.evaluation.benchmark import load_dataset

    return [i for i in load_dataset(DATASET)["items"] if i.get("type") != "unanswerable"]


@pytest.fixture(scope="module")
def corpus():
    from app.evaluation.benchmark import ensure_corpus, load_dataset

    return asyncio.run(ensure_corpus(load_dataset(DATASET)))


def _answer(question: str, corpus) -> dict:
    from app.rag.context import RAGContext
    from app.rag.graph import run_rag
    from app.retrieval.types import RetrievalScope
    from app.schemas.settings import WorkspaceSettings

    ws_id, docs = corpus
    settings = WorkspaceSettings()

    async def go():
        ctx = RAGContext(scope=RetrievalScope(workspace_id=ws_id, document_ids=[d["id"] for d in docs.values()]),
                         retrieval=settings.retrieval, generation=settings.generation)
        state = await run_rag(question, ctx)
        outcome = state.get("outcome")
        from app.database.session import dispose_engine

        await dispose_engine()
        return {"answer": state.get("answer", ""), "contexts": outcome.contexts if outcome else []}

    return asyncio.run(go())


@pytest.mark.parametrize("item", _items(), ids=lambda i: i["id"])
def test_rag_answer_quality(item, corpus):
    from deepeval import assert_test
    from deepeval.metrics import AnswerRelevancyMetric, ContextualRecallMetric, FaithfulnessMetric
    from deepeval.models import GPTModel
    from deepeval.test_case import LLMTestCase

    s = get_settings()
    judge = GPTModel(model=s.evaluation_llm_model, api_key=s.openai_api_key.get_secret_value(),
                     base_url=s.openai_base_url, temperature=0)
    generated = _answer(item["question"], corpus)
    case = LLMTestCase(input=item["question"], actual_output=generated["answer"],
                       expected_output=item.get("expected_answer"), retrieval_context=generated["contexts"])
    threshold = s.deepeval_threshold
    assert_test(case, [AnswerRelevancyMetric(threshold=threshold, model=judge),
                       FaithfulnessMetric(threshold=threshold, model=judge),
                       ContextualRecallMetric(threshold=threshold, model=judge)])
