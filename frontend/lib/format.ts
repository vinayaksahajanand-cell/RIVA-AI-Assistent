/**
 * Pure formatting helpers. Nothing here fabricates values: missing data is rendered
 * as an explicit placeholder ("—" or "N/A"), never as zero.
 */

import type { MetricOut } from "@/lib/types";

export const EMPTY = "—";

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/* -------------------------------------------------------------- durations */

/** Milliseconds → seconds with fixed decimals, e.g. 2345 → "2.35 s". */
export function formatSeconds(ms: number | null | undefined, digits = 2): string {
  if (!isNum(ms)) return EMPTY;
  return `${(ms / 1000).toFixed(digits)} s`;
}

/** Compact duration for tables: "850 ms", "2.35 s", "3m 12s". */
export function formatDuration(ms: number | null | undefined): string {
  if (!isNum(ms)) return EMPTY;
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(2)} s`;
  const totalSec = Math.round(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (m < 60) return `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

/* ----------------------------------------------------------------- scores */

/** score_100 → "96/100"; null → "N/A" (never 0). */
export function formatScore100(score100: number | null | undefined): string {
  if (!isNum(score100)) return "N/A";
  return `${Math.round(score100)}/100`;
}

/** 0..1 ratio → "96/100"; used for aggregated framework scores. */
export function formatRatioAs100(ratio: number | null | undefined): string {
  if (!isNum(ratio)) return "N/A";
  return `${Math.round(ratio * 100)}/100`;
}

/** Resolve the 0..100 display score of a metric, deriving from `score` when needed. */
export function metricScore100(metric: Pick<MetricOut, "score" | "score_100">): number | null {
  if (isNum(metric.score_100)) return Math.max(0, Math.min(100, metric.score_100));
  if (isNum(metric.score)) return Math.max(0, Math.min(100, Math.round(metric.score * 100)));
  return null;
}

export interface MetricDisplay {
  text: string;
  value: number | null;
  isNA: boolean;
  tooltip: string | null;
}

export function describeMetric(metric: MetricOut): MetricDisplay {
  const value = metric.status === "not_applicable" || metric.status === "failed" ? null : metricScore100(metric);
  if (value === null) {
    const fallback =
      metric.status === "not_applicable"
        ? "Not applicable for this answer."
        : metric.status === "failed"
          ? "The evaluator failed to compute this metric."
          : "Not computed.";
    return { text: "N/A", value: null, isNA: true, tooltip: metric.reason || fallback };
  }
  return { text: formatScore100(value), value, isNA: false, tooltip: metric.reason ?? null };
}

/**
 * Quality tone for a 0..100 score, respecting metric direction.
 * Lower-is-better metrics (e.g. Noise Sensitivity) are inverted.
 */
export type ScoreTone = "good" | "fair" | "poor" | "none";

export function scoreTone(score100: number | null, higherIsBetter = true): ScoreTone {
  if (!isNum(score100)) return "none";
  const effective = higherIsBetter ? score100 : 100 - score100;
  if (effective >= 80) return "good";
  if (effective >= 50) return "fair";
  return "poor";
}

/* ---------------------------------------------------------------- numbers */

export function formatPercent(ratio: number | null | undefined, digits = 0): string {
  if (!isNum(ratio)) return EMPTY;
  return `${(ratio * 100).toFixed(digits)}%`;
}

export function formatNumber(n: number | null | undefined, maxFractionDigits = 0): string {
  if (!isNum(n)) return EMPTY;
  return n.toLocaleString("en-US", { maximumFractionDigits: maxFractionDigits });
}

/** Generic metric value for benchmark summaries: integers as-is, otherwise 3 decimals. */
export function formatMetricValue(v: unknown): string {
  if (v === null || v === undefined) return "N/A";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (isNum(v)) return Number.isInteger(v) ? v.toLocaleString("en-US") : v.toFixed(3);
  if (typeof v === "string") return v;
  return JSON.stringify(v);
}

export function formatCost(usd: number | null | undefined): string {
  if (!isNum(usd)) return EMPTY;
  if (usd === 0) return "$0.00";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

export function formatBytes(bytes: number | null | undefined): string {
  if (!isNum(bytes) || bytes < 0) return EMPTY;
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

/* ------------------------------------------------------------------ dates */

function toDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatDate(iso: string | null | undefined): string {
  const d = toDate(iso);
  if (!d) return EMPTY;
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

export function formatDateTime(iso: string | null | undefined): string {
  const d = toDate(iso);
  if (!d) return EMPTY;
  return d.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** "just now", "5 min ago", "3 h ago", "2 d ago", else a date. `now` injectable for tests. */
export function formatRelativeTime(iso: string | null | undefined, now: number = Date.now()): string {
  const d = toDate(iso);
  if (!d) return EMPTY;
  const diffSec = Math.round((now - d.getTime()) / 1000);
  if (diffSec < 45) return "just now";
  const min = Math.round(diffSec / 60);
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h ago`;
  const days = Math.round(h / 24);
  if (days < 7) return `${days} d ago`;
  return formatDate(iso);
}

/** YYYY-MM-DD for <input type="date"> and API filters (local calendar date). */
export function toISODateInput(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** "2026-11-16" → "Nov 16" for chart axes. */
export function formatChartDate(date: string): string {
  const d = toDate(date.length === 10 ? `${date}T00:00:00` : date);
  if (!d) return date;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/* ----------------------------------------------------------------- labels */

const SPECIAL_WORDS: Readonly<Record<string, string>> = {
  llm: "LLM",
  rrf: "RRF",
  bm25: "BM25",
  ocr: "OCR",
  mrr: "MRR",
  ndcg: "nDCG",
  ttft: "TTFT",
  api: "API",
  id: "ID",
  ms: "ms",
};

/** "context_precision" → "Context Precision", "bm25_score" → "BM25 Score". */
export function titleCase(key: string): string {
  return key
    .replace(/[_\-.]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => SPECIAL_WORDS[w.toLowerCase()] ?? w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Metric keys such as "recall@5", "ndcg@10", "context_precision" → "Recall@5", "nDCG@10", "Context Precision". */
export function metricLabel(key: string): string {
  const at = key.indexOf("@");
  if (at === -1) return titleCase(key);
  return `${titleCase(key.slice(0, at))}@${key.slice(at + 1)}`;
}

/**
 * Display a framework average on the 0..100 scale. Averages are expected as 0..1 ratios;
 * values above 1 are assumed to already be on a 0..100 scale.
 */
export function averageTo100(avg: number | null | undefined): number | null {
  if (!isNum(avg)) return null;
  const v = avg > 1.0001 ? avg : avg * 100;
  return Math.max(0, Math.min(100, Math.round(v)));
}

export const STAGE_LABELS: Readonly<Record<string, string>> = {
  query_processing: "Query processing",
  embedding: "Embedding",
  dense_retrieval: "Dense retrieval",
  bm25_retrieval: "BM25 retrieval",
  fusion: "RRF fusion",
  deduplication: "Deduplication",
  reranking: "Reranking",
  relevance_grading: "Relevance grading",
  query_rewriting: "Query rewriting",
  context_preparation: "Context preparation",
  llm_generation: "LLM generation",
  answer_verification: "Answer verification",
};

const STAGE_ORDER = Object.keys(STAGE_LABELS);

export function stageLabel(key: string): string {
  return STAGE_LABELS[key] ?? titleCase(key);
}

export interface StageRow {
  key: string;
  label: string;
  ms: number;
}

/** Known pipeline stages in pipeline order first, then unknown keys alphabetically. */
export function sortStages(stagesMs: Record<string, number> | null | undefined): StageRow[] {
  if (!stagesMs) return [];
  const rows = Object.entries(stagesMs)
    .filter(([, ms]) => isNum(ms))
    .map(([key, ms]) => ({ key, label: stageLabel(key), ms }));
  return rows.sort((a, b) => {
    const ia = STAGE_ORDER.indexOf(a.key);
    const ib = STAGE_ORDER.indexOf(b.key);
    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1) return -1;
    if (ib !== -1) return 1;
    return a.key.localeCompare(b.key);
  });
}

/** Page reference: "p. 3", "pp. 3–5", or "—". */
export function formatPages(page: number | null | undefined, pageEnd?: number | null): string {
  if (!isNum(page)) return EMPTY;
  if (isNum(pageEnd) && pageEnd > page) return `pp. ${page}–${pageEnd}`;
  return `p. ${page}`;
}

export function initials(nameOrEmail: string): string {
  const base = nameOrEmail.includes("@") ? nameOrEmail.split("@")[0] : nameOrEmail;
  const parts = base.split(/[\s._-]+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}
