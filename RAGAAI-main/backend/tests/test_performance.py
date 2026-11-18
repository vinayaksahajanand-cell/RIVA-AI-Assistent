"""Concurrency and latency behaviour of the full chat pipeline (scripted LLM, everything else real).

Reports p50/p95 end-to-end latency, time-to-first-token and retrieval latency for concurrent
streaming requests, and checks that every request completes and is persisted correctly.
LLM latency is excluded by design (the scripted model answers instantly), so these numbers show
RIVA's own overhead: retrieval, reranking, persistence and streaming.
"""

from __future__ import annotations

import asyncio
import statistics
import time

from tests.conftest import parse_sse, register, upload

DOC = b"""# Facilities Guide

## Parking
Visitor parking is available on level P2. Employees park on levels P3 and P4.

## Meeting rooms
Rooms on the fifth floor can be booked for up to four hours through the room planner.

## Canteen
The canteen serves lunch from 11:30 to 14:00 and offers a vegetarian menu daily.
"""

QUESTIONS = ["Which level has visitor parking?", "How long can meeting rooms be booked?", "When does the canteen serve lunch?",
             "Which levels do employees park on?"]


def pct(values: list[float], p: float) -> float:
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, int(round(p * (len(ordered) - 1))))]


async def test_concurrent_streaming_chats(client_factory):
    from app.core.config import get_settings

    c = await client_factory()
    await register(c, "load")
    await upload(c, {"facilities.md": DOC})
    concurrency = 16

    async def one(i: int) -> dict:
        t0 = time.perf_counter()
        r = await c.post("/api/chat/stream", json={"message": QUESTIONS[i % len(QUESTIONS)]})
        wall = (time.perf_counter() - t0) * 1000
        events = parse_sse(r.text)
        done = next(d for e, d in events if e == "done")["message"]
        return {"wall_ms": wall, "status": done["status"], "perf": done["performance"]}

    await one(0)  # warm-up (model load)
    single = [await one(i) for i in range(4)]
    s_tot = [r["perf"]["total_ms"] for r in single]
    print(f"\nsequential: total p50={statistics.median(s_tot):.0f}ms; breakdown of last request: "
          f"{ {k: round(v) for k, v in single[-1]['perf']['stages_ms'].items()} }")

    t0 = time.perf_counter()
    results = await asyncio.gather(*(one(i) for i in range(concurrency)))
    total_s = time.perf_counter() - t0

    assert all(r["status"] == "completed" for r in results), [r["status"] for r in results]
    totals = [r["perf"]["total_ms"] for r in results]
    ttfts = [r["perf"]["time_to_first_token_ms"] for r in results]
    retrieval = [r["perf"]["stages_ms"].get("dense_retrieval", 0) + r["perf"]["stages_ms"].get("bm25_retrieval", 0)
                 for r in results]
    rerank = [r["perf"]["stages_ms"].get("reranking", 0) for r in results]
    report = (f"\n{concurrency} concurrent chats in {total_s:.2f}s (pool size {get_settings().db_pool_size})\n"
              f"  server total  p50={statistics.median(totals):.0f}ms p95={pct(totals, .95):.0f}ms\n"
              f"  TTFT          p50={statistics.median(ttfts):.0f}ms p95={pct(ttfts, .95):.0f}ms\n"
              f"  retrieval     p50={statistics.median(retrieval):.0f}ms p95={pct(retrieval, .95):.0f}ms\n"
              f"  reranking     p50={statistics.median(rerank):.0f}ms p95={pct(rerank, .95):.0f}ms")
    print(report)
    assert all(t <= tot for t, tot in zip(ttfts, totals, strict=True))

    convs = (await c.get("/api/conversations?limit=100")).json()
    assert len(convs) == concurrency + 5 and all(cv["message_count"] == 2 for cv in convs)
