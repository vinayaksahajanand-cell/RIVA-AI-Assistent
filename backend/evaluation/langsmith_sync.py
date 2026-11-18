"""LangSmith datasets & experiments for the RIVA benchmark.

* ``sync_dataset`` creates/updates a LangSmith dataset ``RIVA-<dataset>`` from the local JSON file.
* ``run_experiment`` runs the full RIVA RAG graph over that dataset with ``langsmith.aevaluate`` and
  records experiment scores (retrieval hit, grounded-answer flag, refusal correctness, latency).
"""

from __future__ import annotations

import uuid

from app.core.config import get_settings


def _client():
    from app.observability.tracing import get_client

    client = get_client()
    if client is None:
        raise SystemExit("LangSmith is not configured: set LANGSMITH_TRACING=true and LANGSMITH_API_KEY.")
    return client


def sync_dataset(name: str) -> int:
    from app.evaluation.benchmark import load_dataset

    data = load_dataset(name)
    client = _client()
    ds_name = f"RIVA-{data['name']}"
    existing = next(iter(client.list_datasets(dataset_name=ds_name)), None)
    dataset = existing or client.create_dataset(ds_name, description=data.get("description", ""))
    current = {ex.metadata.get("item_id") for ex in client.list_examples(dataset_id=dataset.id) if ex.metadata}
    new = [item for item in data["items"] if item["id"] not in current]
    if new:
        client.create_examples(
            inputs=[{"question": i["question"]} for i in new],
            outputs=[{"expected_answer": i.get("expected_answer"), "expected_document": i.get("expected_document")}
                     for i in new],
            metadata=[{"item_id": i["id"], "type": i.get("type", "question")} for i in new],
            dataset_id=dataset.id,
        )
    print(f"LangSmith dataset '{ds_name}': {len(current) + len(new)} examples ({len(new)} added).")
    return 0


async def run_experiment(name: str, limit: int | None) -> int:
    from langsmith import aevaluate

    from app.evaluation.benchmark import ensure_corpus, load_dataset
    from app.evaluation.retrieval_metrics import is_relevant
    from app.rag.context import RAGContext
    from app.rag.graph import run_rag
    from app.rag.prompts import INSUFFICIENT_MESSAGE
    from app.retrieval.types import RetrievalScope
    from app.schemas.settings import WorkspaceSettings

    if not get_settings().llm_configured:
        raise SystemExit("An LLM is required: set OPENAI_API_KEY.")
    data = load_dataset(name)
    sync_dataset(name)
    ws_id, docs = await ensure_corpus(data)
    settings = WorkspaceSettings()
    scope = RetrievalScope(workspace_id=ws_id, document_ids=[d["id"] for d in docs.values()])

    async def target(inputs: dict) -> dict:
        ctx = RAGContext(scope=scope, retrieval=settings.retrieval, generation=settings.generation)
        state = await run_rag(inputs["question"], ctx, run_id=uuid.uuid4(), run_name="riva_experiment")
        outcome = state.get("outcome")
        return {"answer": state.get("answer", ""), "status": state.get("status"),
                "documents": [c.document_name for c in (outcome.selected if outcome else [])],
                "contexts": outcome.contexts if outcome else [],
                "latency_s": round(ctx.timer.elapsed(), 3),
                "grounded": (state.get("verification") or {}).get("grounded")}

    def retrieval_hit(run, example) -> dict:
        expected = (example.outputs or {}).get("expected_document")
        if not expected:
            return {"key": "retrieval_hit", "score": None}
        docs_out = (run.outputs or {}).get("documents", [])
        hit = any(is_relevant(d, d, "", expected, None) for d in docs_out)
        return {"key": "retrieval_hit", "score": 1.0 if hit else 0.0}

    def correct_refusal(run, example) -> dict:
        unanswerable = (example.metadata or {}).get("type") == "unanswerable"
        refused = (run.outputs or {}).get("answer", "").startswith(INSUFFICIENT_MESSAGE[:40])
        return {"key": "correct_refusal", "score": 1.0 if refused == unanswerable else 0.0}

    def grounded(run, example) -> dict:
        g = (run.outputs or {}).get("grounded")
        return {"key": "grounded", "score": None if g is None else float(bool(g))}

    def latency(run, example) -> dict:
        return {"key": "latency_s", "score": (run.outputs or {}).get("latency_s")}

    client = _client()
    examples = list(client.list_examples(dataset_name=f"RIVA-{data['name']}"))
    if limit:
        examples = examples[:limit]
    results = await aevaluate(target, data=examples, evaluators=[retrieval_hit, correct_refusal, grounded, latency],
                              experiment_prefix=f"riva-{settings.generation.model}", client=client,
                              metadata={"retrieval": settings.retrieval.model_dump(),
                                        "model": settings.generation.model}, max_concurrency=2)
    print(f"LangSmith experiment created: {getattr(results, 'experiment_name', 'see LangSmith UI')}")
    return 0
