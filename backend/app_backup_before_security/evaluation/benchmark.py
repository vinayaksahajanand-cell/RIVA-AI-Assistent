"""Offline benchmark runs: retrieval IR metrics, RAGAS and DeepEval over a reference dataset.

Datasets live in ``backend/evaluation/datasets/<name>.json``::

    {"name": ..., "description": ..., "corpus_dir": "corpus",
     "items": [{"id", "question", "expected_answer", "expected_document", "expected_context", "type"}]}

The corpus is ingested once into a dedicated benchmark workspace (isolated from user data) and
re-indexed automatically if the embedding model changes. Every run writes JSON + CSV reports to
``backend/evaluation/results/`` and records a regression comparison against the baseline run.
"""

from __future__ import annotations

import csv
import json
import os
import secrets
import statistics
import subprocess
import time
import uuid
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.core.config import BACKEND_DIR, get_settings
from app.core.logging import get_logger
from app.core.security import hash_password
from app.core.timing import StageTimer
from app.database.session import session_scope
from app.embeddings.provider import embedding_model_id
from app.evaluation.metrics import SPECS
from app.evaluation.retrieval_metrics import is_relevant, score_ranking
from app.evaluation.types import MetricOutcome
from app.ingestion.pipeline import run_ingestion
from app.ingestion.validators import validate_upload
from app.models import (
    BenchmarkDataset,
    BenchmarkRun,
    Document,
    DocumentChunk,
    DocumentVersion,
    EvaluationMetricResult,
    EvaluationResult,
    IngestionJob,
    User,
    Workspace,
    WorkspaceMember,
)
from app.rag.context import RAGContext
from app.rag.graph import run_rag
from app.retrieval.hybrid import HybridRetriever
from app.retrieval.types import RetrievalScope
from app.schemas.settings import RetrievalSettings, WorkspaceSettings
from app.services.storage import get_storage

log = get_logger(__name__)

DATASETS_DIR = BACKEND_DIR / "evaluation" / "datasets"
RESULTS_DIR = Path(os.environ.get("EVALUATION_RESULTS_DIR") or BACKEND_DIR / "evaluation" / "results")
BENCHMARK_EMAIL = "benchmark@riva.local"
REGRESSION_THRESHOLD = 0.05
MODES = {
    "dense": {"mode": "dense", "reranker_enabled": False},
    "bm25": {"mode": "bm25", "reranker_enabled": False},
    "hybrid": {"mode": "hybrid", "reranker_enabled": False},
    "hybrid_rerank": {"mode": "hybrid", "reranker_enabled": True},
}
RETRIEVAL_KEYS = ["recall@5", "recall@10", "precision@5", "mrr", "ndcg@10", "hit@1", "hit@5"]


def list_datasets() -> list[str]:
    return sorted(p.stem for p in DATASETS_DIR.glob("*.json"))


def load_dataset(name: str) -> dict:
    safe = Path(name).name.removesuffix(".json")
    path = DATASETS_DIR / f"{safe}.json"
    if not path.exists():
        raise FileNotFoundError(f"Dataset '{safe}' not found in {DATASETS_DIR}")
    data = json.loads(path.read_text(encoding="utf-8"))
    data.setdefault("name", safe)
    for i, item in enumerate(data.get("items", [])):
        item.setdefault("id", f"q{i + 1}")
    return data


def _git_sha() -> str | None:
    try:
        return subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=BACKEND_DIR, capture_output=True,
                              text=True, timeout=5).stdout.strip() or None
    except Exception:
        return None


# ── Benchmark workspace & corpus ────────────────────────────────────────────

async def ensure_benchmark_workspace(dataset_name: str) -> uuid.UUID:
    name = f"Benchmark · {dataset_name}"
    async with session_scope() as s:
        user = (await s.execute(select(User).where(User.email == BENCHMARK_EMAIL))).scalar_one_or_none()
        if user is None:
            user = User(email=BENCHMARK_EMAIL, full_name="RIVA Benchmark", is_active=False, role="member",
                        password_hash=hash_password(secrets.token_urlsafe(32)))
            s.add(user)
            await s.flush()
        ws = (await s.execute(select(Workspace).where(Workspace.owner_id == user.id, Workspace.name == name))
              ).scalar_one_or_none()
        if ws is None:
            ws = Workspace(name=name, owner_id=user.id, settings={})
            s.add(ws)
            await s.flush()
            s.add(WorkspaceMember(workspace_id=ws.id, user_id=user.id, role="owner"))
        return ws.id


async def ensure_corpus(dataset: dict, force_reindex: bool = False) -> tuple[uuid.UUID, dict[str, dict]]:
    """Ingest (or re-use) the dataset corpus. Returns (workspace_id, {filename: {id,title,status}}).

    Documents are re-indexed when the embedding model or chunking configuration changed, or when
    ``force_reindex`` is set (use after code changes to extraction/chunking)."""
    corpus_dir = DATASETS_DIR / dataset.get("corpus_dir", "corpus")
    if not corpus_dir.is_dir():
        raise FileNotFoundError(f"Corpus directory not found: {corpus_dir}")
    ws_id = await ensure_benchmark_workspace(dataset["name"])
    storage = get_storage()
    model_id = embedding_model_id()
    chunking = WorkspaceSettings().chunking.model_dump()  # benchmark workspaces use server defaults
    docs: dict[str, dict] = {}
    for path in sorted(p for p in corpus_dir.iterdir() if p.is_file() and not p.name.startswith(".")):
        data = path.read_bytes()
        vf = validate_upload(path.name, data)
        job_id = None
        async with session_scope() as s:
            doc = (await s.execute(select(Document).where(Document.workspace_id == ws_id,
                                                          Document.sha256 == vf.sha256))).scalar_one_or_none()
            if doc is None:
                doc = Document(workspace_id=ws_id, filename=vf.filename, title=path.stem, file_ext=vf.ext,
                               mime_type=vf.mime_type, size_bytes=vf.size_bytes, sha256=vf.sha256,
                               status="uploaded", doc_metadata={"benchmark": True})
                s.add(doc)
                await s.flush()
                rel = storage.save(ws_id, doc.id, 1, vf.filename, data)
                s.add(DocumentVersion(document_id=doc.id, version=1, sha256=vf.sha256, size_bytes=vf.size_bytes,
                                      storage_path=rel, original_filename=vf.filename))
            meta = doc.doc_metadata or {}
            needs_index = (force_reindex or doc.status != "indexed" or meta.get("embedding_model") != model_id
                           or meta.get("chunking") != chunking)
            if needs_index:
                job = IngestionJob(workspace_id=ws_id, document_id=doc.id, job_type="ingest", status="running",
                                   attempts=1, started_at=datetime.now(UTC))
                s.add(job)
                await s.flush()
                job_id = job.id
            doc_id, title = doc.id, doc.title
        if job_id is not None:
            log.info("Benchmark: indexing %s", path.name)
            stats = await run_ingestion(job_id)
            async with session_scope() as s:
                job = await s.get(IngestionJob, job_id)
                job.status, job.stage, job.progress, job.stats = "completed", "completed", 100, stats
                job.finished_at = datetime.now(UTC)
        docs[path.name] = {"id": doc_id, "title": title}
    return ws_id, docs


async def _relevant_chunk_counts(ws_id: uuid.UUID, items: list[dict]) -> dict[str, int]:
    async with session_scope() as s:
        rows = (await s.execute(select(DocumentChunk.content, Document.title, Document.filename)
                                .join(Document, Document.id == DocumentChunk.document_id)
                                .where(DocumentChunk.workspace_id == ws_id, DocumentChunk.chunk_type != "parent"))).all()
    return {item["id"]: sum(is_relevant(r.title, r.filename, r.content, item.get("expected_document"),
                                        item.get("expected_context")) for r in rows) for item in items}


# ── Retrieval benchmark (no LLM required) ───────────────────────────────────

async def run_retrieval_benchmark(ws_id: uuid.UUID, items: list[dict], modes: list[str],
                                  base: RetrievalSettings, docs: dict[str, dict]) -> tuple[dict, list[dict]]:
    retriever = HybridRetriever()
    scope = RetrievalScope(workspace_id=ws_id, document_ids=[d["id"] for d in docs.values()])
    totals = await _relevant_chunk_counts(ws_id, items)
    filenames = {d["id"]: name for name, d in docs.items()}
    rows: list[dict] = []
    summary: dict[str, dict] = {}
    for mode in modes:
        cfg = base.model_copy(update={**MODES[mode], "top_k": max(base.top_k, 10)})
        per_item, latencies = [], []
        for item in items:
            if totals.get(item["id"], 0) == 0:
                rows.append({"mode": mode, "item_id": item["id"], "status": "unjudgeable",
                             "reason": "expected context not found in any indexed chunk"})
                continue
            timer = StageTimer()
            outcome = await retriever.retrieve(query=item["question"], search_queries=[item["question"]],
                                               scope=scope, cfg=cfg, timer=timer)
            latencies.append(timer.elapsed() * 1000)
            ranked = sorted((c for c in outcome.candidates if c.final_rank is not None), key=lambda c: c.final_rank)
            rels = [is_relevant(c.document_name, filenames.get(c.document_id, ""), c.content,
                                item.get("expected_document"), item.get("expected_context")) for c in ranked]
            scores = score_ranking(rels, totals[item["id"]])
            per_item.append(scores)
            rows.append({"mode": mode, "item_id": item["id"], "status": "ok", "question": item["question"],
                         "relevant_total": totals[item["id"]], "latency_ms": round(timer.elapsed() * 1000, 1),
                         "stages_ms": timer.as_ms(), **{k: round(v, 4) for k, v in scores.items()},
                         "top_documents": [c.document_name for c in ranked[:5]]})
        summary[mode] = {
            "items": len(per_item),
            **{k: round(statistics.fmean(s[k] for s in per_item), 4) if per_item else None for k in RETRIEVAL_KEYS},
            "avg_latency_ms": round(statistics.fmean(latencies), 1) if latencies else None,
        }
    return summary, rows


# ── RAG + LLM-judge benchmarks ──────────────────────────────────────────────

async def _answer(item: dict, ws_id: uuid.UUID, docs: dict[str, dict], ws_settings: WorkspaceSettings) -> dict:
    ctx = RAGContext(scope=RetrievalScope(workspace_id=ws_id, document_ids=[d["id"] for d in docs.values()]),
                     retrieval=ws_settings.retrieval, generation=ws_settings.generation, has_documents=True)
    run_id = uuid.uuid4()
    state = await run_rag(item["question"], ctx, run_id=run_id, run_name="riva_benchmark",
                          metadata={"benchmark_item": item["id"]})
    outcome = state.get("outcome")
    return {"answer": state.get("answer", ""), "status": state.get("status"),
            "contexts": outcome.contexts if outcome else [], "run_id": str(run_id),
            "latency_ms": round(ctx.timer.elapsed() * 1000, 1),
            "ttft_ms": round(ctx.timer.marks["first_token"] * 1000, 1) if "first_token" in ctx.timer.marks else None,
            "tokens": ctx.usage.total_tokens if ctx.usage.saw_usage else None}


def _expected_context(item: dict) -> list[str] | None:
    ctx = item.get("expected_context")
    if not ctx:
        return None
    return ctx if isinstance(ctx, list) else [ctx]


async def _judge(framework: str, item: dict, generated: dict) -> list[MetricOutcome]:
    if framework == "ragas":
        from app.evaluation.ragas_evaluator import RagasEvaluator

        return await RagasEvaluator().evaluate(item["question"], generated["answer"], generated["contexts"],
                                               item.get("expected_answer"))
    from app.evaluation.deepeval_evaluator import DeepEvalEvaluator

    return await DeepEvalEvaluator().evaluate(
        question=item["question"], answer=generated["answer"], contexts=generated["contexts"],
        expected_output=item.get("expected_answer"), expected_context=_expected_context(item),
        source_text=item.get("source_text") if item.get("type") == "summarization" else None)


def _summarize_metrics(framework: str, outcomes_by_item: list[list[MetricOutcome]]) -> dict:
    summary: dict[str, dict] = {}
    for outcomes in outcomes_by_item:
        for o in outcomes:
            entry = summary.setdefault(o.key, {"display_name": o.display_name, "higher_is_better": o.higher_is_better,
                                               "scores": [], "passed": 0, "judged": 0, "failed": 0, "na": 0})
            if o.status == "completed" and o.score is not None:
                entry["scores"].append(o.score)
                if o.passed is not None:
                    entry["judged"] += 1
                    entry["passed"] += int(o.passed)
            elif o.status == "failed":
                entry["failed"] += 1
            else:
                entry["na"] += 1
    out = {}
    for key, e in summary.items():
        out[key] = {"display_name": e["display_name"], "higher_is_better": e["higher_is_better"],
                    "mean": round(statistics.fmean(e["scores"]), 4) if e["scores"] else None,
                    "count": len(e["scores"]), "failed": e["failed"], "not_applicable": e["na"],
                    **({"pass_rate": round(e["passed"] / e["judged"], 4)} if e["judged"] else {})}
    if framework == "deepeval" and "hallucination" in out and "pass_rate" in out["hallucination"]:
        out["hallucination"]["hallucination_rate"] = round(1 - out["hallucination"]["pass_rate"], 4)
    return out


# ── Regression comparison ───────────────────────────────────────────────────

def flatten_summary(framework: str, summary: dict) -> dict[str, tuple[float, bool]]:
    """{metric_key: (value, higher_is_better)} for comparable numeric metrics."""
    flat: dict[str, tuple[float, bool]] = {}
    for fw in ("ragas", "deepeval"):
        for key, m in (summary.get(fw) or {}).items():
            if isinstance(m, dict) and m.get("mean") is not None:
                flat[f"{fw}.{key}"] = (m["mean"], m.get("higher_is_better", True))
    for mode, metrics in (summary.get("retrieval") or {}).items():
        for key in RETRIEVAL_KEYS:
            if isinstance(metrics, dict) and metrics.get(key) is not None:
                flat[f"retrieval.{mode}.{key}"] = (metrics[key], True)
    return flat


def compare_runs(baseline: BenchmarkRun | None, candidate: BenchmarkRun, threshold: float = REGRESSION_THRESHOLD) -> dict:
    cand = flatten_summary(candidate.framework, candidate.summary or {})
    base = flatten_summary(baseline.framework, baseline.summary or {}) if baseline else {}
    items = []
    for key in sorted(set(cand) | set(base)):
        c = cand.get(key)
        b = base.get(key)
        hib = (c or b)[1]
        delta = None if (c is None or b is None) else round(c[0] - b[0], 4)
        regressed = delta is not None and ((delta < -threshold) if hib else (delta > threshold))
        items.append({"metric": key, "baseline": b[0] if b else None, "candidate": c[0] if c else None,
                      "delta": delta, "higher_is_better": hib, "regressed": regressed})
    return {"framework": candidate.framework, "baseline_run_id": str(baseline.id) if baseline else None,
            "candidate_run_id": str(candidate.id), "threshold": threshold,
            "regressed": any(i["regressed"] for i in items), "items": items}


async def find_baseline(run: BenchmarkRun) -> BenchmarkRun | None:
    async with session_scope() as s:
        stmt = (select(BenchmarkRun).where(BenchmarkRun.workspace_id == run.workspace_id, BenchmarkRun.id != run.id,
                                           BenchmarkRun.framework == run.framework,
                                           BenchmarkRun.status == "completed")
                .order_by(BenchmarkRun.is_baseline.desc(), BenchmarkRun.created_at.desc()))
        candidates = (await s.execute(stmt)).scalars().all()
    same_dataset = [r for r in candidates if (r.config or {}).get("dataset") == (run.config or {}).get("dataset")]
    return same_dataset[0] if same_dataset else None


# ── Reports ─────────────────────────────────────────────────────────────────

def write_reports(run: BenchmarkRun, rows: list[dict], regression: dict) -> dict:
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    label = "".join(ch if ch.isalnum() or ch in "-_" else "-" for ch in (run.label or ""))[:40]
    base = RESULTS_DIR / f"{stamp}_{run.framework}{('_' + label) if label else ''}"
    payload = {"run_id": str(run.id), "framework": run.framework, "label": run.label, "config": run.config,
               "summary": run.summary, "regression": regression, "git_sha": run.git_sha,
               "created_at": run.created_at.isoformat() if run.created_at else None, "items": rows}
    json_path = base.with_suffix(".json")
    json_path.write_text(json.dumps(payload, indent=2, default=str), encoding="utf-8")
    csv_path = base.with_suffix(".csv")
    keys: list[str] = []
    for r in rows:
        for k in r:
            if k not in keys and not isinstance(r[k], (dict, list)):
                keys.append(k)
    with csv_path.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=keys, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)
    return {"json": _rel(json_path), "csv": _rel(csv_path)}


def _rel(path: Path) -> str:
    try:
        return path.resolve().relative_to(BACKEND_DIR).as_posix()
    except ValueError:
        return str(path.resolve())


# ── Orchestration ───────────────────────────────────────────────────────────

async def create_run(workspace_id: uuid.UUID, framework: str, dataset: str, *, limit: int | None, label: str,
                     retrieval_modes: list[str], set_baseline: bool, status: str = "queued",
                     reindex: bool = False) -> BenchmarkRun:
    async with session_scope() as s:
        run = BenchmarkRun(workspace_id=workspace_id, framework=framework, status=status, label=label,
                           config={"dataset": dataset, "limit": limit, "retrieval_modes": retrieval_modes,
                                   "reindex": reindex},
                           is_baseline=set_baseline, git_sha=_git_sha())
        s.add(run)
        await s.flush()
        await s.refresh(run)
        return run


async def execute_benchmark_run(run_id: uuid.UUID) -> BenchmarkRun:
    t0 = time.perf_counter()
    async with session_scope() as s:
        run = await s.get(BenchmarkRun, run_id)
        run.status = "running"
        framework, cfg = run.framework, dict(run.config or {})
    try:
        dataset = load_dataset(cfg.get("dataset", "sample_benchmark"))
        items = dataset.get("items", [])[: cfg.get("limit") or None]
        ws_id, docs = await ensure_corpus(dataset, force_reindex=bool(cfg.get("reindex")))
        ws_settings = WorkspaceSettings()
        summary: dict = {"dataset": dataset["name"], "items": len(items), "embedding_model": embedding_model_id(),
                         "generation_model": ws_settings.generation.model}
        rows: list[dict] = []

        if framework in ("retrieval", "all"):
            modes = cfg.get("retrieval_modes") or list(MODES)
            retrieval_summary, retrieval_rows = await run_retrieval_benchmark(ws_id, items, modes,
                                                                              ws_settings.retrieval, docs)
            summary["retrieval"] = retrieval_summary
            rows += [{"section": "retrieval", **r} for r in retrieval_rows]

        judges = [f for f in ("ragas", "deepeval") if framework in (f, "all")]
        if judges:
            if not get_settings().llm_configured:
                raise RuntimeError("RAGAS/DeepEval benchmarks need an LLM: set OPENAI_API_KEY in backend/.env.")
            outcomes: dict[str, list[list[MetricOutcome]]] = {f: [] for f in judges}
            latencies = []
            for item in items:
                generated = await _answer(item, ws_id, docs, ws_settings)
                latencies.append(generated["latency_ms"])
                row = {"section": "rag", "item_id": item["id"], "question": item["question"],
                       "expected_answer": item.get("expected_answer"), "answer": generated["answer"],
                       "status": generated["status"], "latency_ms": generated["latency_ms"],
                       "ttft_ms": generated["ttft_ms"], "tokens": generated["tokens"],
                       "contexts": generated["contexts"]}
                for fw in judges:
                    result = await _judge(fw, item, generated)
                    outcomes[fw].append(result)
                    for o in result:
                        row[f"{fw}.{o.key}"] = o.score
                    await _store_item_evaluation(run_id, fw, item, generated, result)
                rows.append(row)
            for fw in judges:
                summary[fw] = _summarize_metrics(fw, outcomes[fw])
            summary["rag_latency_ms"] = {"mean": round(statistics.fmean(latencies), 1) if latencies else None,
                                         "p95": round(sorted(latencies)[int(0.95 * (len(latencies) - 1))], 1)
                                         if latencies else None}

        async with session_scope() as s:
            run = await s.get(BenchmarkRun, run_id)
            run.summary = summary
            run.item_count = len(items)
        baseline = await find_baseline(run)
        regression = compare_runs(baseline, run)
        report_paths = write_reports(run, rows, regression)
        async with session_scope() as s:
            run = await s.get(BenchmarkRun, run_id)
            run.status = "completed"
            run.report_paths = report_paths
            run.summary = {**summary, "regression": regression}
            run.duration_ms = round((time.perf_counter() - t0) * 1000, 1)
            run.completed_at = datetime.now(UTC)
            if run.is_baseline:
                await _clear_other_baselines(s, run)
        log.info("Benchmark run %s completed in %.1fs", run_id, (time.perf_counter() - t0))
    except Exception as exc:
        log.exception("Benchmark run %s failed", run_id)
        async with session_scope() as s:
            run = await s.get(BenchmarkRun, run_id)
            run.status = "failed"
            run.error = f"{exc.__class__.__name__}: {str(exc)[:800]}"
            run.duration_ms = round((time.perf_counter() - t0) * 1000, 1)
            run.completed_at = datetime.now(UTC)
    async with session_scope() as s:
        return await s.get(BenchmarkRun, run_id)


async def _clear_other_baselines(s, run: BenchmarkRun) -> None:
    others = (await s.execute(select(BenchmarkRun).where(
        BenchmarkRun.workspace_id == run.workspace_id, BenchmarkRun.framework == run.framework,
        BenchmarkRun.id != run.id, BenchmarkRun.is_baseline.is_(True)))).scalars().all()
    for o in others:
        o.is_baseline = False


async def _store_item_evaluation(run_id: uuid.UUID, framework: str, item: dict, generated: dict,
                                 outcomes: list[MetricOutcome]) -> None:
    from app.evaluation.deepeval_evaluator import deepeval_version
    from app.evaluation.ragas_evaluator import ragas_version

    async with session_scope() as s:
        run = await s.get(BenchmarkRun, run_id)
        ev = EvaluationResult(workspace_id=run.workspace_id, benchmark_run_id=run_id, framework=framework,
                              mode="offline", status="completed" if any(o.status == "completed" for o in outcomes)
                              else "failed", reference_available=bool(item.get("expected_answer")),
                              evaluator_model=get_settings().evaluation_llm_model,
                              framework_version=ragas_version() if framework == "ragas" else deepeval_version(),
                              completed_at=datetime.now(UTC),
                              inputs={"item_id": item["id"], "question": item["question"],
                                      "answer": generated["answer"], "contexts": generated["contexts"],
                                      "reference": item.get("expected_answer")},
                              raw={o.key: {"score": o.score, "status": o.status, "reason": o.reason} for o in outcomes})
        s.add(ev)
        await s.flush()
        for i, o in enumerate(outcomes):
            spec = SPECS.get((framework, o.key))
            s.add(EvaluationMetricResult(evaluation_id=ev.id, metric_name=o.key, display_name=o.display_name,
                                         position=i, score=o.score, higher_is_better=o.higher_is_better,
                                         status=o.status, reason=o.reason,
                                         requires_reference=spec.requires_reference if spec else False,
                                         threshold=o.threshold, passed=o.passed))


async def get_or_create_dataset_record(workspace_id: uuid.UUID, name: str) -> BenchmarkDataset:
    data = load_dataset(name)
    async with session_scope() as s:
        rec = (await s.execute(select(BenchmarkDataset).where(BenchmarkDataset.workspace_id == workspace_id,
                                                              BenchmarkDataset.name == data["name"]))).scalar_one_or_none()
        if rec is None:
            rec = BenchmarkDataset(workspace_id=workspace_id, name=data["name"],
                                   description=data.get("description", ""), items=data.get("items", []),
                                   source_path=f"evaluation/datasets/{data['name']}.json")
            s.add(rec)
        else:
            rec.items = data.get("items", [])
        await s.flush()
        await s.refresh(rec)
        return rec


async def load_run_with_evaluations(run_id: uuid.UUID) -> list[EvaluationResult]:
    async with session_scope() as s:
        return list((await s.execute(select(EvaluationResult).options(selectinload(EvaluationResult.metrics))
                                     .where(EvaluationResult.benchmark_run_id == run_id))).scalars().all())
