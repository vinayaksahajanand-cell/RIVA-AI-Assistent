"use client";

import { ArrowDown, ChevronDown, Loader2 } from "lucide-react";
import { useState } from "react";

import { ScoreBar } from "@/components/common/score-bar";
import { StatusPill, type Tone } from "@/components/common/status-pill";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { evaluationModeLabel, evaluationStatusLabel, frameworkLabel, isEvaluationActive } from "@/lib/evaluation";
import { describeMetric, formatDateTime, formatSeconds } from "@/lib/format";
import type { EvaluationOut, MetricOut } from "@/lib/types";
import { cn } from "@/lib/utils";

export function evaluationTone(status: string): Tone {
  switch (status) {
    case "completed":
      return "success";
    case "running":
      return "primary";
    case "pending":
      return "info";
    case "failed":
      return "danger";
    default:
      return "neutral";
  }
}

export function EvaluationStatusPill({ status }: { status: string }) {
  return (
    <StatusPill tone={evaluationTone(status)} pulse={status === "running" || status === "pending"}>
      {evaluationStatusLabel(status)}
    </StatusPill>
  );
}

function MetricScore({ metric, active }: { metric: MetricOut; active: boolean }) {
  const d = describeMetric(metric);
  if (d.isNA && active && metric.status !== "not_applicable" && metric.status !== "failed") {
    return (
      <span className="inline-flex items-center gap-1 text-muted-foreground">
        <Loader2 className="size-3 animate-spin" aria-hidden /> Calculating
      </span>
    );
  }
  if (d.isNA) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="cursor-help rounded font-medium text-muted-foreground underline decoration-dotted underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            N/A
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">{d.tooltip}</TooltipContent>
      </Tooltip>
    );
  }
  return (
    <span className="tabular font-semibold" title={d.tooltip ?? undefined}>
      {d.text}
    </span>
  );
}

/** One evaluation run (e.g. RAGAS online, or RAGAS reference-based) for an answer. */
export function EvaluationBlock({ evaluation }: { evaluation: EvaluationOut }) {
  const [showMethod, setShowMethod] = useState(false);
  const active = isEvaluationActive(evaluation);
  const meta: Array<[string, string]> = [
    ["Mode", evaluationModeLabel(evaluation.mode, evaluation.mode_label)],
    ["Reference answer", evaluation.reference_available ? "Available" : "Not provided"],
    ["Evaluator model", evaluation.evaluator_model ?? "—"],
    ["Evaluated", formatDateTime(evaluation.completed_at ?? evaluation.started_at ?? evaluation.created_at)],
    ["Duration", formatSeconds(evaluation.duration_ms)],
  ];
  if (evaluation.framework_version) meta.push(["Version", `${frameworkLabel(evaluation.framework)} ${evaluation.framework_version}`]);

  return (
    <div className="rounded-lg border bg-background">
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <span className="text-[13px] font-semibold">{frameworkLabel(evaluation.framework)}</span>
        <span className="rounded-md bg-secondary px-1.5 py-0.5 text-[11px] font-medium text-secondary-foreground">
          {evaluationModeLabel(evaluation.mode, evaluation.mode_label)}
        </span>
        <EvaluationStatusPill status={evaluation.status} />
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 px-3 py-2.5 text-[12px] sm:grid-cols-3">
        {meta.map(([k, v]) => (
          <div key={k} className="min-w-0">
            <dt className="text-[11px] text-muted-foreground">{k}</dt>
            <dd className="truncate font-medium" title={v}>
              {v}
            </dd>
          </div>
        ))}
      </dl>

      {evaluation.error && (
        <p className="mx-3 mb-2.5 rounded-md bg-red-50 px-2.5 py-1.5 text-[12px] text-red-700 ring-1 ring-red-200/70 ring-inset">
          {evaluation.error}
        </p>
      )}

      {evaluation.metrics.length > 0 ? (
        <table className="w-full border-t text-[13px]">
          <caption className="sr-only">{frameworkLabel(evaluation.framework)} metrics</caption>
          <thead>
            <tr className="border-b bg-muted/40 text-left text-[11px] text-muted-foreground">
              <th scope="col" className="px-3 py-1.5 font-medium">Metric</th>
              <th scope="col" className="w-24 px-3 py-1.5 text-right font-medium">Score</th>
              <th scope="col" className="hidden w-[30%] px-3 py-1.5 font-medium sm:table-cell">
                <span className="sr-only">Score bar</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {evaluation.metrics.map((m) => {
              const d = describeMetric(m);
              return (
                <tr key={m.name} className="border-b last:border-0">
                  <td className="px-3 py-1.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span>{m.display_name || m.name}</span>
                      {!m.higher_is_better && (
                        <span
                          className="inline-flex items-center gap-0.5 rounded bg-amber-50 px-1 py-px text-[10.5px] font-medium text-amber-800 ring-1 ring-amber-200/70 ring-inset"
                          title="For this metric, a lower score is better"
                        >
                          lower is better <ArrowDown className="size-3" aria-hidden />
                        </span>
                      )}
                      {m.requires_reference && (
                        <span className="text-[10.5px] text-muted-foreground" title="Requires a reference answer">
                          · reference
                        </span>
                      )}
                      {m.passed !== null && (
                        <StatusPill tone={m.passed ? "success" : "danger"} dot={false}>
                          {m.passed ? "Pass" : "Fail"}
                          {m.threshold !== null && ` @ ${m.threshold}`}
                        </StatusPill>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    <MetricScore metric={m} active={active} />
                  </td>
                  <td className="hidden px-3 py-1.5 sm:table-cell">
                    <ScoreBar
                      value={d.value}
                      higherIsBetter={m.higher_is_better}
                      label={`${m.display_name || m.name}: ${d.text}`}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <p className="flex items-center gap-2 border-t px-3 py-2.5 text-[12.5px] text-muted-foreground">
          {active && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
          {active
            ? "Evaluation in progress — scores appear here when ready. The answer stays available meanwhile."
            : evaluation.status === "not_available"
              ? "Evaluation is not available for this answer."
              : "No metrics were reported."}
        </p>
      )}

      {evaluation.methodology && (
        <Collapsible open={showMethod} onOpenChange={setShowMethod} className="border-t">
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex w-full items-center gap-1 px-3 py-1.5 text-left text-[11.5px] font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
            >
              Methodology
              <ChevronDown className={cn("size-3.5 transition-transform", showMethod && "rotate-180")} aria-hidden />
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <p className="px-3 pb-2.5 text-[12px] leading-relaxed whitespace-pre-line text-muted-foreground">
              {evaluation.methodology}
            </p>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}
