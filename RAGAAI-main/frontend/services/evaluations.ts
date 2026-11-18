import { apiFetch, downloadFile } from "@/services/http";
import type {
  BenchmarkKind,
  BenchmarkRunOut,
  BenchmarkRunRequest,
  EvaluationReports,
  MessageEvaluations,
  RawEvaluation,
  RunExportFormat,
} from "@/lib/types";

const msg = (id: string) => `/api/evaluations/${encodeURIComponent(id)}`;
const run = (id: string) => `/api/evaluation/runs/${encodeURIComponent(id)}`;

/* ---- per-answer (online / reference-based) evaluations ---- */

export function getMessageEvaluations(messageId: string, signal?: AbortSignal): Promise<MessageEvaluations> {
  return apiFetch<MessageEvaluations>(msg(messageId), { signal });
}

export function getRawEvaluations(messageId: string, signal?: AbortSignal): Promise<RawEvaluation[]> {
  return apiFetch<RawEvaluation[]>(`${msg(messageId)}/raw`, { signal });
}

export function submitReferenceAnswer(messageId: string, referenceAnswer: string): Promise<MessageEvaluations> {
  return apiFetch<MessageEvaluations>(`${msg(messageId)}/reference`, {
    method: "POST",
    json: { reference_answer: referenceAnswer },
  });
}

export function rerunEvaluations(messageId: string): Promise<MessageEvaluations> {
  return apiFetch<MessageEvaluations>(`${msg(messageId)}/rerun`, { method: "POST" });
}

/* ---- offline benchmarks ---- */

export function runBenchmark(kind: BenchmarkKind, body: BenchmarkRunRequest): Promise<BenchmarkRunOut> {
  return apiFetch<BenchmarkRunOut>(`/api/evaluation/${kind}/run`, { method: "POST", json: body });
}

export function getEvaluationReports(signal?: AbortSignal): Promise<EvaluationReports> {
  return apiFetch<EvaluationReports>("/api/evaluation/reports", { signal });
}

export function getBenchmarkRun(id: string, signal?: AbortSignal): Promise<BenchmarkRunOut> {
  return apiFetch<BenchmarkRunOut>(run(id), { signal });
}

export function setBaselineRun(id: string): Promise<BenchmarkRunOut> {
  return apiFetch<BenchmarkRunOut>(`${run(id)}/baseline`, { method: "POST" });
}

export function exportBenchmarkRun(id: string, format: RunExportFormat): Promise<void> {
  return downloadFile(`${run(id)}/export`, { format }, `evaluation-run-${id}.${format}`);
}
