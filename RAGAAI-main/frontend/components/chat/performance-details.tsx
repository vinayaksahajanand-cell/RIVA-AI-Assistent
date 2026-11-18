"use client";

import { Loader2 } from "lucide-react";

import { Stat } from "@/components/chat/answer-section";
import { InfoHint } from "@/components/common/info-hint";
import { evaluationDurationMs, isEvaluationActive } from "@/lib/evaluation";
import { formatCost, formatNumber, formatSeconds, sortStages } from "@/lib/format";
import type { EvaluationOut, PerformanceOut } from "@/lib/types";

export function performanceSummary(performance: PerformanceOut | null, streaming: boolean): string {
  if (performance) return `Response time: ${formatSeconds(performance.total_ms)}`;
  return streaming ? "Measuring…" : "Not recorded";
}

/** Response timing, per-stage breakdown and token usage. Evaluation time is reported separately. */
export function PerformanceDetails({
  performance,
  evaluations,
  streaming,
}: {
  performance: PerformanceOut | null;
  evaluations: readonly EvaluationOut[];
  streaming: boolean;
}) {
  if (!performance) {
    return (
      <p className="text-[13px] text-muted-foreground">
        {streaming
          ? "Timings are recorded when the answer completes."
          : "Performance data was not recorded for this answer."}
      </p>
    );
  }

  const stages = sortStages(performance.stages_ms);
  const maxStage = Math.max(1, ...stages.map((s) => s.ms));
  const evalMs = evaluationDurationMs(evaluations);
  const evalRunning = evaluations.some(isEvaluationActive);

  const evaluationValue =
    evalMs !== null ? (
      formatSeconds(evalMs)
    ) : evalRunning ? (
      <span className="inline-flex items-center gap-1.5 text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" aria-hidden /> Running…
      </span>
    ) : (
      <span className="text-muted-foreground">Not evaluated</span>
    );

  const tokenStats: Array<[string, string]> = [];
  if (performance.prompt_tokens !== null) tokenStats.push(["Prompt tokens", formatNumber(performance.prompt_tokens)]);
  if (performance.completion_tokens !== null) tokenStats.push(["Completion tokens", formatNumber(performance.completion_tokens)]);
  if (performance.total_tokens !== null) tokenStats.push(["Total tokens", formatNumber(performance.total_tokens)]);
  if (performance.estimated_cost_usd !== null) tokenStats.push(["Estimated cost", formatCost(performance.estimated_cost_usd)]);
  tokenStats.push(["LLM calls", formatNumber(performance.llm_calls)]);
  if (performance.model) tokenStats.push(["Model", performance.model]);

  return (
    <div className="space-y-4">
      <p className="text-sm font-semibold tracking-tight">
        Response time: <span className="tabular">{formatSeconds(performance.total_ms)}</span>
      </p>
      <div className="grid gap-2 sm:grid-cols-3">
        <Stat
          emphasis
          label="Response time"
          value={formatSeconds(performance.total_ms)}
          hint="End-to-end, request to final answer"
        />
        <Stat label="Time to first token" value={formatSeconds(performance.time_to_first_token_ms)} />
        <Stat
          label={
            <>
              Evaluation completed in
              <InfoHint label="About evaluation time">
                Quality evaluation runs after the answer is delivered. Its duration is measured separately and is
                not part of the response time.
              </InfoHint>
            </>
          }
          value={evaluationValue}
        />
      </div>

      {stages.length > 0 && (
        <div className="overflow-hidden rounded-lg border bg-background">
          <table className="w-full text-[13px]">
            <caption className="sr-only">Pipeline stage timings</caption>
            <thead>
              <tr className="border-b bg-muted/40 text-left text-[11px] text-muted-foreground">
                <th scope="col" className="px-3 py-1.5 font-medium">Stage</th>
                <th scope="col" className="w-20 px-3 py-1.5 text-right font-medium">Time</th>
                <th scope="col" className="hidden w-[38%] px-3 py-1.5 font-medium sm:table-cell">
                  <span className="sr-only">Relative duration</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {stages.map((s) => (
                <tr key={s.key} className="border-b last:border-0">
                  <td className="px-3 py-1.5">{s.label}</td>
                  <td className="tabular px-3 py-1.5 text-right font-medium">{formatSeconds(s.ms)}</td>
                  <td className="hidden px-3 py-1.5 sm:table-cell">
                    <div className="h-1.5 rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary/60"
                        style={{ width: `${Math.max(2, (s.ms / maxStage) * 100)}%` }}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[12.5px] sm:grid-cols-3">
        {tokenStats.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-[11px] text-muted-foreground">{label}</dt>
            <dd className="tabular truncate font-medium" title={value}>
              {value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
