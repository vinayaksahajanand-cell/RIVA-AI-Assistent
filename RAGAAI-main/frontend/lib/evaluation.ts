/**
 * Evaluation display & polling rules (pure functions, unit-tested).
 */

import type { EvaluationOut, RegressionItem } from "@/lib/types";

export const EVALUATION_POLL_MS = 2500;
export const ACTIVE_EVALUATION_STATUSES = new Set(["pending", "running"]);
export const TERMINAL_EVALUATION_STATUSES = new Set(["completed", "failed", "not_available"]);

export function isEvaluationActive(e: Pick<EvaluationOut, "status">): boolean {
  return ACTIVE_EVALUATION_STATUSES.has(e.status);
}

/**
 * Keep polling while any evaluation is pending/running. When the list is still empty
 * for an answer produced moments ago, allow a few "grace" polls because the backend may
 * enqueue evaluation rows slightly after emitting `done`.
 */
export function shouldPollEvaluations(
  evaluations: readonly Pick<EvaluationOut, "status">[],
  emptyGraceRemaining = 0,
): boolean {
  if (evaluations.some(isEvaluationActive)) return true;
  return evaluations.length === 0 && emptyGraceRemaining > 0;
}

export const EVALUATION_STATUS_LABELS: Readonly<Record<string, string>> = {
  pending: "Pending",
  running: "Running",
  completed: "Completed",
  failed: "Failed",
  not_available: "N/A",
};

export function evaluationStatusLabel(status: string): string {
  return EVALUATION_STATUS_LABELS[status] ?? status;
}

const MODE_LABELS: Readonly<Record<string, string>> = {
  online: "Online",
  reference: "Reference-based",
  offline: "Offline benchmark",
};

export function evaluationModeLabel(mode: string, modeLabel?: string | null): string {
  return modeLabel?.trim() || MODE_LABELS[mode] || mode;
}

export function frameworkLabel(framework: string): string {
  const f = framework.toLowerCase();
  if (f === "ragas") return "RAGAS";
  if (f === "deepeval") return "DeepEval";
  if (f === "retrieval") return "Retrieval";
  return framework;
}

const MODE_ORDER = ["online", "reference", "offline"];

/** Split a message's evaluations by framework, each ordered online → reference → offline, then by time. */
export function groupEvaluations(evaluations: readonly EvaluationOut[]): {
  ragas: EvaluationOut[];
  deepeval: EvaluationOut[];
  other: EvaluationOut[];
} {
  const sorted = [...evaluations].sort((a, b) => {
    const ma = MODE_ORDER.indexOf(a.mode);
    const mb = MODE_ORDER.indexOf(b.mode);
    if (ma !== mb) return (ma === -1 ? 99 : ma) - (mb === -1 ? 99 : mb);
    return a.created_at.localeCompare(b.created_at);
  });
  return {
    ragas: sorted.filter((e) => e.framework === "ragas"),
    deepeval: sorted.filter((e) => e.framework === "deepeval"),
    other: sorted.filter((e) => e.framework !== "ragas" && e.framework !== "deepeval"),
  };
}

/** Most relevant duration to report as "Evaluation completed in". */
export function evaluationDurationMs(evaluations: readonly EvaluationOut[]): number | null {
  const done = evaluations.filter((e) => e.status === "completed" && typeof e.duration_ms === "number");
  const ragas = done.find((e) => e.framework === "ragas");
  return (ragas ?? done[0])?.duration_ms ?? null;
}

/** improved = green; worse = red (within threshold); regressed = red + flagged; neutral = no change. */
export type DeltaTone = "improved" | "worse" | "regressed" | "neutral";

/**
 * Colour semantics for a regression delta (candidate − baseline).
 * The backend's `regressed` flag wins (it applies the threshold); otherwise the sign of the
 * delta is interpreted through `higher_is_better`.
 */
export function regressionTone(item: Pick<RegressionItem, "delta" | "higher_is_better" | "regressed">): DeltaTone {
  if (item.regressed) return "regressed";
  if (item.delta === null || item.delta === 0 || !Number.isFinite(item.delta)) return "neutral";
  const better = item.higher_is_better ? item.delta > 0 : item.delta < 0;
  return better ? "improved" : "worse";
}

export function formatDelta(delta: number | null): string {
  if (delta === null || !Number.isFinite(delta)) return "—";
  const sign = delta > 0 ? "+" : delta < 0 ? "−" : "±";
  return `${sign}${Math.abs(delta).toFixed(3)}`;
}
