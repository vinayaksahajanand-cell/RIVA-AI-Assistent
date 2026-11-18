import { describe, expect, it } from "vitest";

import {
  averageTo100,
  describeMetric,
  formatBytes,
  formatCost,
  formatDuration,
  formatPages,
  formatRelativeTime,
  formatScore100,
  formatSeconds,
  metricLabel,
  scoreTone,
  sortStages,
  stageLabel,
  titleCase,
} from "@/lib/format";
import type { MetricOut } from "@/lib/types";

const metric = (over: Partial<MetricOut>): MetricOut => ({
  name: "faithfulness",
  display_name: "Faithfulness",
  score: null,
  score_100: null,
  higher_is_better: true,
  status: "completed",
  reason: null,
  requires_reference: false,
  threshold: null,
  passed: null,
  ...over,
});

describe("latency formatting", () => {
  it("formats milliseconds as seconds with two decimals", () => {
    expect(formatSeconds(2345)).toBe("2.35 s");
    expect(formatSeconds(0)).toBe("0.00 s");
    expect(formatSeconds(999.4)).toBe("1.00 s");
  });

  it("never invents a value for missing timings", () => {
    expect(formatSeconds(null)).toBe("—");
    expect(formatSeconds(undefined)).toBe("—");
    expect(formatSeconds(Number.NaN)).toBe("—");
  });

  it("formats compact durations", () => {
    expect(formatDuration(850)).toBe("850 ms");
    expect(formatDuration(12_340)).toBe("12.34 s");
    expect(formatDuration(192_000)).toBe("3m 12s");
    expect(formatDuration(null)).toBe("—");
  });
});

describe("score formatting", () => {
  it("shows score_100 as N/100 and null as N/A (never 0)", () => {
    expect(formatScore100(96)).toBe("96/100");
    expect(formatScore100(0)).toBe("0/100");
    expect(formatScore100(null)).toBe("N/A");
  });

  it("describes a null metric as N/A with the reason as tooltip", () => {
    const d = describeMetric(metric({ score: null, score_100: null, status: "not_applicable", reason: "Needs a reference answer" }));
    expect(d).toEqual({ text: "N/A", value: null, isNA: true, tooltip: "Needs a reference answer" });
  });

  it("falls back to a default reason and derives score_100 from score when needed", () => {
    expect(describeMetric(metric({ status: "failed" })).tooltip).toMatch(/failed/i);
    expect(describeMetric(metric({ score: 0.874, score_100: null })).text).toBe("87/100");
    expect(describeMetric(metric({ score: 0.9, score_100: 90 })).value).toBe(90);
  });

  it("inverts tone for lower-is-better metrics", () => {
    expect(scoreTone(90, true)).toBe("good");
    expect(scoreTone(90, false)).toBe("poor");
    expect(scoreTone(10, false)).toBe("good");
    expect(scoreTone(null)).toBe("none");
  });

  it("scales averages to 0..100", () => {
    expect(averageTo100(0.914)).toBe(91);
    expect(averageTo100(1)).toBe(100);
    expect(averageTo100(87.4)).toBe(87);
    expect(averageTo100(null)).toBeNull();
  });
});

describe("stage labels", () => {
  it("maps known keys to friendly labels and title-cases unknown keys", () => {
    expect(stageLabel("fusion")).toBe("RRF fusion");
    expect(stageLabel("bm25_retrieval")).toBe("BM25 retrieval");
    expect(stageLabel("cache_lookup")).toBe("Cache Lookup");
    expect(titleCase("llm_judge_call")).toBe("LLM Judge Call");
  });

  it("orders known stages by pipeline order, then unknown keys alphabetically", () => {
    const rows = sortStages({ llm_generation: 900, zeta_step: 1, embedding: 20, alpha_step: 2, query_processing: 5 });
    expect(rows.map((r) => r.key)).toEqual(["query_processing", "embedding", "llm_generation", "alpha_step", "zeta_step"]);
  });

  it("formats metric keys", () => {
    expect(metricLabel("recall@5")).toBe("Recall@5");
    expect(metricLabel("ndcg@10")).toBe("nDCG@10");
    expect(metricLabel("mrr")).toBe("MRR");
  });
});

describe("misc formatting", () => {
  it("formats pages, bytes and cost", () => {
    expect(formatPages(3)).toBe("p. 3");
    expect(formatPages(3, 5)).toBe("pp. 3–5");
    expect(formatPages(null)).toBe("—");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(25 * 1024 * 1024)).toBe("25 MB");
    expect(formatCost(0.00123)).toBe("$0.0012");
    expect(formatCost(1.5)).toBe("$1.50");
    expect(formatCost(null)).toBe("—");
  });

  it("formats relative time against an injected clock", () => {
    const now = Date.parse("2026-11-16T12:00:00Z");
    expect(formatRelativeTime("2026-11-16T11:59:50Z", now)).toBe("just now");
    expect(formatRelativeTime("2026-11-16T11:55:00Z", now)).toBe("5 min ago");
    expect(formatRelativeTime("2026-11-16T09:00:00Z", now)).toBe("3 h ago");
    expect(formatRelativeTime(null, now)).toBe("—");
  });
});
