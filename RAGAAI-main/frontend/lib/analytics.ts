/**
 * Pure transforms from analytics API payloads to chart rows. Missing values stay null
 * (rendered as gaps / "—"), never coerced to zero.
 */

import { averageTo100, formatChartDate, metricLabel, sortStages } from "@/lib/format";
import type { LatencyPoint, MetricPoint, ModelUsage } from "@/lib/types";

/** Purple-led categorical order (distinct hues for multi-series charts). Assigned in fixed order, never cycled. */
export const SERIES_COLORS = ["#7c3aed", "#c026d3", "#0f9d76", "#e08a00", "#a78bfa", "#4c1d95", "#e0457b", "#64748b"] as const;

const msToS = (v: number | null | undefined): number | null =>
  typeof v === "number" && Number.isFinite(v) ? Math.round(v) / 1000 : null;

export interface LatencyRow {
  date: string;
  label: string;
  count: number;
  avg_s: number | null;
  p95_s: number | null;
  ttft_s: number | null;
}

export function latencyRows(series: readonly LatencyPoint[]): LatencyRow[] {
  return [...series]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((p) => ({
      date: p.date,
      label: formatChartDate(p.date),
      count: p.count,
      avg_s: msToS(p.avg_total_ms),
      p95_s: msToS(p.p95_total_ms),
      ttft_s: msToS(p.avg_ttft_ms),
    }));
}

export interface StageRow {
  key: string;
  label: string;
  seconds: number;
}

export function stageRows(stageAveragesMs: Record<string, number> | null | undefined): StageRow[] {
  return sortStages(stageAveragesMs).map((s) => ({ key: s.key, label: s.label, seconds: Math.round(s.ms) / 1000 }));
}

const KNOWN_METRIC_ORDER = [
  "faithfulness",
  "answer_relevancy",
  "context_precision",
  "context_recall",
  "answer_correctness",
  "noise_sensitivity",
];

/** Stable metric order so a metric keeps its colour regardless of which others are present. */
export function orderMetrics(metrics: Iterable<string>): string[] {
  const list = Array.from(new Set(metrics));
  return list.sort((a, b) => {
    const ia = KNOWN_METRIC_ORDER.indexOf(a);
    const ib = KNOWN_METRIC_ORDER.indexOf(b);
    if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    return a.localeCompare(b);
  });
}

export interface MetricTrend {
  metrics: Array<{ key: string; label: string; color: string }>;
  rows: Array<Record<string, string | number | null>>;
  /** Metrics beyond the palette are folded out (never given generated colours). */
  omitted: string[];
}

/** Pivot per-day metric averages of one framework into chart rows on a 0..100 scale. */
export function metricTrend(
  series: readonly MetricPoint[],
  framework: string,
  displayNames: Record<string, string> = {},
): MetricTrend {
  const points = series.filter((p) => p.framework === framework);
  const ordered = orderMetrics(points.map((p) => p.metric));
  const kept = ordered.slice(0, SERIES_COLORS.length);
  const byDate = new Map<string, Record<string, string | number | null>>();
  for (const p of points) {
    if (!kept.includes(p.metric)) continue;
    const row = byDate.get(p.date) ?? { date: p.date, label: formatChartDate(p.date) };
    row[p.metric] = averageTo100(p.avg);
    byDate.set(p.date, row);
  }
  const rows = Array.from(byDate.values()).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  for (const row of rows) for (const m of kept) if (!(m in row)) row[m] = null;
  return {
    metrics: kept.map((key, i) => ({ key, label: displayNames[key] || metricLabel(key), color: SERIES_COLORS[i] })),
    rows,
    omitted: ordered.slice(SERIES_COLORS.length),
  };
}

export function modelRows(byModel: readonly ModelUsage[]) {
  return [...byModel]
    .sort((a, b) => b.count - a.count)
    .map((m) => ({ ...m, avg_s: msToS(m.avg_total_ms) }));
}
