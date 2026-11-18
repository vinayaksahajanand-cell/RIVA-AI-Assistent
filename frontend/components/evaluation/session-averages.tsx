"use client";

import { ArrowDown } from "lucide-react";

import { ScoreBar } from "@/components/common/score-bar";
import { evaluationModeLabel, frameworkLabel } from "@/lib/evaluation";
import { averageTo100, formatNumber, titleCase } from "@/lib/format";
import type { MetricAverage } from "@/lib/types";

/** Session-level per-metric averages, grouped by framework and mode (never mixed). */
export function SessionAverages({ averages, statusCounts }: { averages: readonly MetricAverage[]; statusCounts: Record<string, number> }) {
  const groups = new Map<string, MetricAverage[]>();
  for (const a of averages) {
    const k = `${a.framework}::${a.mode}`;
    groups.set(k, [...(groups.get(k) ?? []), a]);
  }
  const counts = Object.entries(statusCounts).filter(([, n]) => n > 0);

  return (
    <div className="space-y-3">
      {counts.length > 0 && (
        <div className="flex flex-wrap gap-2 text-xs">
          {counts.map(([status, n]) => (
            <span key={status} className="rounded-md border bg-background px-2 py-1">
              <span className="text-muted-foreground">{titleCase(status)}</span>{" "}
              <span className="font-semibold tabular">{formatNumber(n)}</span>
            </span>
          ))}
        </div>
      )}
      <div className="grid gap-3 md:grid-cols-2">
        {Array.from(groups.entries()).map(([k, list]) => {
          const [framework, mode] = k.split("::");
          return (
            <section key={k} className="rounded-xl border bg-background">
              <header className="flex items-center gap-2 border-b px-3 py-2">
                <h3 className="text-[13px] font-semibold">{frameworkLabel(framework)}</h3>
                <span className="rounded-md bg-secondary px-1.5 py-0.5 text-[11px] font-medium text-secondary-foreground">
                  {evaluationModeLabel(mode)}
                </span>
              </header>
              <ul className="divide-y">
                {list.map((m) => {
                  const v = averageTo100(m.avg);
                  return (
                    <li key={m.metric} className="space-y-1 px-3 py-2">
                      <div className="flex items-center justify-between gap-2 text-[13px]">
                        <span className="flex min-w-0 items-center gap-1.5">
                          <span className="truncate">{m.display_name || titleCase(m.metric)}</span>
                          {!m.higher_is_better && (
                            <span className="inline-flex items-center text-[10.5px] text-amber-700" title="Lower is better">
                              lower is better <ArrowDown className="size-3" aria-hidden />
                            </span>
                          )}
                        </span>
                        <span className="shrink-0 tabular">
                          <span className="font-semibold">{v === null ? "N/A" : `${v}/100`}</span>
                          <span className="ml-1.5 text-[11px] text-muted-foreground">n={formatNumber(m.count)}</span>
                        </span>
                      </div>
                      <ScoreBar value={v} higherIsBetter={m.higher_is_better} />
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
