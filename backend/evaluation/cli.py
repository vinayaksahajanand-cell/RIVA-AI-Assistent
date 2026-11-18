"""RIVA AI evaluation command line.

Run from the ``backend`` directory with the virtual environment active:

    python -m evaluation.cli retrieval [--dataset sample_benchmark] [--baseline] [--reindex]  # no API key needed
    python -m evaluation.cli ragas     [--dataset ...] [--limit N]                  # needs OPENAI_API_KEY
    python -m evaluation.cli deepeval  [--dataset ...] [--limit N]                  # needs OPENAI_API_KEY
    python -m evaluation.cli all       [--dataset ...] [--limit N]                  # retrieval + RAGAS + DeepEval
    python -m evaluation.cli compare   [--framework retrieval]                      # latest run vs baseline
    python -m evaluation.cli list                                                    # recent runs
    python -m evaluation.cli export <run_id> [--format csv]                         # print report path
    python -m evaluation.cli langsmith-sync     [--dataset ...]                     # upload dataset to LangSmith
    python -m evaluation.cli langsmith-experiment [--dataset ...] [--limit N]        # run a LangSmith experiment

Exit code is 1 when a run fails or (with --fail-on-regression) when a regression is detected,
so the commands can gate CI pipelines.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))


def _print_summary(run) -> None:
    summary = dict(run.summary or {})
    regression = summary.pop("regression", None)
    print(f"\nRun {run.id}  framework={run.framework}  status={run.status}  items={run.item_count}  "
          f"duration={((run.duration_ms or 0) / 1000):.1f}s")
    if run.error:
        print(f"ERROR: {run.error}")
    if "retrieval" in summary:
        keys = ["recall@5", "recall@10", "precision@5", "mrr", "ndcg@10", "hit@1", "avg_latency_ms"]
        print("\nRetrieval comparison (higher is better; latency in ms)")
        print(f"{'mode':<15}" + "".join(f"{k:>14}" for k in keys))
        for mode, m in summary["retrieval"].items():
            print(f"{mode:<15}" + "".join(f"{m.get(k) if m.get(k) is not None else 'N/A':>14}" for k in keys))
    for fw in ("ragas", "deepeval"):
        if fw in summary:
            print(f"\n{fw.upper()} metrics (mean over items; N/A = not computable)")
            for key, m in summary[fw].items():
                arrow = "↑" if m.get("higher_is_better", True) else "↓ lower is better"
                mean = "N/A" if m.get("mean") is None else f"{m['mean']:.3f}"
                extra = f"  pass_rate={m['pass_rate']:.2f}" if "pass_rate" in m else ""
                print(f"  {m['display_name']:<24} {mean:>7}  (n={m['count']}, failed={m['failed']}, "
                      f"n/a={m['not_applicable']}) {arrow}{extra}")
    if regression:
        base = regression.get("baseline_run_id") or "none (first run)"
        flagged = [i for i in regression["items"] if i["regressed"]]
        print(f"\nRegression vs baseline {base}: {'REGRESSED' if regression['regressed'] else 'ok'} "
              f"(threshold {regression['threshold']})")
        for i in flagged:
            print(f"  ✗ {i['metric']}: {i['baseline']} → {i['candidate']} (Δ {i['delta']})")
    if run.report_paths:
        print(f"\nReports: {run.report_paths.get('json')}  |  {run.report_paths.get('csv')}")


async def _run(framework: str, args) -> int:
    from app.database.session import dispose_engine
    from app.evaluation.benchmark import create_run, ensure_benchmark_workspace, execute_benchmark_run

    try:
        ws = await ensure_benchmark_workspace(args.dataset)
        run = await create_run(ws, framework, args.dataset, limit=args.limit, label=args.label or "cli",
                               retrieval_modes=["dense", "bm25", "hybrid", "hybrid_rerank"],
                               set_baseline=args.baseline, status="running", reindex=args.reindex)
        done = await execute_benchmark_run(run.id)
        _print_summary(done)
        if done.status != "completed":
            return 1
        if args.fail_on_regression and (done.summary or {}).get("regression", {}).get("regressed"):
            return 1
        return 0
    finally:
        from app.observability.tracing import flush

        flush()
        await dispose_engine()


async def _list(limit: int) -> int:
    from sqlalchemy import select

    from app.database.session import dispose_engine, session_scope
    from app.models import BenchmarkRun

    async with session_scope() as s:
        runs = (await s.execute(select(BenchmarkRun).order_by(BenchmarkRun.created_at.desc()).limit(limit))).scalars()
        for r in runs:
            print(f"{r.created_at:%Y-%m-%d %H:%M}  {r.id}  {r.framework:<9} {r.status:<9} "
                  f"items={r.item_count:<3} baseline={'yes' if r.is_baseline else 'no':<3} {r.label}")
    await dispose_engine()
    return 0


async def _compare(framework: str) -> int:
    from sqlalchemy import select

    from app.database.session import dispose_engine, session_scope
    from app.evaluation.benchmark import compare_runs, find_baseline
    from app.models import BenchmarkRun

    async with session_scope() as s:
        latest = (await s.execute(select(BenchmarkRun).where(BenchmarkRun.framework == framework,
                                                             BenchmarkRun.status == "completed")
                                  .order_by(BenchmarkRun.created_at.desc()).limit(1))).scalar_one_or_none()
    if latest is None:
        print(f"No completed {framework} runs yet.")
        await dispose_engine()
        return 1
    report = compare_runs(await find_baseline(latest), latest)
    print(json.dumps(report, indent=2))
    await dispose_engine()
    return 1 if report["regressed"] else 0


async def _export(run_id: str, fmt: str) -> int:
    import uuid

    from app.database.session import dispose_engine, session_scope
    from app.models import BenchmarkRun

    async with session_scope() as s:
        run = await s.get(BenchmarkRun, uuid.UUID(run_id))
    await dispose_engine()
    if run is None or not (run.report_paths or {}).get(fmt):
        print("Run or report not found.")
        return 1
    print((BACKEND_DIR / run.report_paths[fmt]).resolve())
    return 0


def main() -> int:
    from app.core.config import get_settings
    from app.core.logging import configure_logging
    from app.evaluation.env import configure_evaluation_env
    from app.observability.tracing import configure_tracing

    parser = argparse.ArgumentParser(prog="python -m evaluation.cli", description="RIVA AI evaluation suite")
    sub = parser.add_subparsers(dest="command", required=True)
    for name in ("retrieval", "ragas", "deepeval", "all"):
        p = sub.add_parser(name)
        p.add_argument("--dataset", default="sample_benchmark")
        p.add_argument("--limit", type=int, default=None)
        p.add_argument("--label", default="")
        p.add_argument("--baseline", action="store_true", help="mark this run as the regression baseline")
        p.add_argument("--fail-on-regression", action="store_true")
        p.add_argument("--reindex", action="store_true",
                       help="re-index the benchmark corpus first (after changes to extraction/chunking code)")
    p = sub.add_parser("compare")
    p.add_argument("--framework", default="retrieval", choices=["retrieval", "ragas", "deepeval", "all"])
    p = sub.add_parser("list")
    p.add_argument("--limit", type=int, default=20)
    p = sub.add_parser("export")
    p.add_argument("run_id")
    p.add_argument("--format", default="json", choices=["json", "csv"])
    for name in ("langsmith-sync", "langsmith-experiment"):
        p = sub.add_parser(name)
        p.add_argument("--dataset", default="sample_benchmark")
        p.add_argument("--limit", type=int, default=None)
    args = parser.parse_args()

    settings = get_settings()
    configure_logging(settings.log_level)
    configure_evaluation_env()
    configure_tracing()

    if args.command in ("retrieval", "ragas", "deepeval", "all"):
        return asyncio.run(_run(args.command, args))
    if args.command == "list":
        return asyncio.run(_list(args.limit))
    if args.command == "compare":
        return asyncio.run(_compare(args.framework))
    if args.command == "export":
        return asyncio.run(_export(args.run_id, args.format))
    from evaluation import langsmith_sync

    if args.command == "langsmith-sync":
        return langsmith_sync.sync_dataset(args.dataset)
    return asyncio.run(langsmith_sync.run_experiment(args.dataset, args.limit))


if __name__ == "__main__":
    raise SystemExit(main())
