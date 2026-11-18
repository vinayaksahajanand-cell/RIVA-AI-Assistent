"use client";

import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";

import { StatusPill } from "@/components/common/status-pill";
import { formatDelta, frameworkLabel, regressionTone, type DeltaTone } from "@/lib/evaluation";
import { formatMetricValue, metricLabel } from "@/lib/format";
import type { BenchmarkRunOut, RegressionReport } from "@/lib/types";
import { cn } from "@/lib/utils";

const TONE_CLASS: Record<DeltaTone, string> = {
  improved: "text-emerald-700",
  worse: "text-red-600",
  regressed: "font-semibold text-red-700",
  neutral: "text-muted-foreground",
};

function runName(runs: readonly BenchmarkRunOut[], id: string | null): string {
  if (!id) return "No baseline";
  const r = runs.find((x) => x.id === id);
  return r ? r.label || `Run ${r.id.slice(0, 8)}` : `Run ${id.slice(0, 8)}`;
}

export function RegressionReports({ reports, runs }: { reports: readonly RegressionReport[]; runs: readonly BenchmarkRunOut[] }) {
  return (
    <div className="space-y-3">
      {reports.map((rep) => (
        <article key={`${rep.framework}-${rep.candidate_run_id}`} className="overflow-hidden rounded-xl border bg-background">
          <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-2.5">
            <h3 className="text-[13px] font-semibold">{frameworkLabel(rep.framework)}</h3>
            <p className="text-xs text-muted-foreground">
              {runName(runs, rep.candidate_run_id)} vs baseline {runName(runs, rep.baseline_run_id)} · threshold{" "}
              {formatMetricValue(rep.threshold)}
            </p>
            <span className="ml-auto">
              <StatusPill tone={rep.regressed ? "danger" : "success"}>{rep.regressed ? "Regression detected" : "No regression"}</StatusPill>
            </span>
          </header>
          {rep.items.length === 0 ? (
            <p className="px-4 py-3 text-[13px] text-muted-foreground">No comparable metrics.</p>
          ) : (
            <div className="overflow-x-auto scrollbar-thin">
              <table className="w-full min-w-[520px] text-[13px]">
                <thead>
                  <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                    <th scope="col" className="px-4 py-1.5 font-medium">Metric</th>
                    <th scope="col" className="px-4 py-1.5 text-right font-medium">Baseline</th>
                    <th scope="col" className="px-4 py-1.5 text-right font-medium">Candidate</th>
                    <th scope="col" className="px-4 py-1.5 text-right font-medium">Δ</th>
                    <th scope="col" className="px-4 py-1.5 font-medium">Direction</th>
                  </tr>
                </thead>
                <tbody>
                  {rep.items.map((it) => {
                    const tone = regressionTone(it);
                    const Icon = tone === "improved" ? ArrowUpRight : tone === "neutral" ? Minus : ArrowDownRight;
                    return (
                      <tr key={it.metric} className={cn("border-b last:border-0", it.regressed && "bg-red-50/50")}>
                        <td className="px-4 py-1.5 font-medium">{metricLabel(it.metric)}</td>
                        <td className="tabular px-4 py-1.5 text-right">{formatMetricValue(it.baseline)}</td>
                        <td className="tabular px-4 py-1.5 text-right">{formatMetricValue(it.candidate)}</td>
                        <td className={cn("tabular px-4 py-1.5 text-right", TONE_CLASS[tone])}>
                          <span className="inline-flex items-center gap-0.5">
                            <Icon className="size-3.5" aria-hidden />
                            {formatDelta(it.delta)}
                          </span>
                          <span className="sr-only">
                            {tone === "improved" ? " (improved)" : tone === "neutral" ? " (unchanged)" : " (worse)"}
                          </span>
                        </td>
                        <td className="px-4 py-1.5 text-xs text-muted-foreground">
                          {it.higher_is_better ? "Higher is better ↑" : "Lower is better ↓"}
                          {it.regressed && <span className="ml-1.5 font-semibold text-red-700">Regressed</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </article>
      ))}
    </div>
  );
}
