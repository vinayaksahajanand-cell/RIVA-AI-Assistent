"use client";

import { ChevronRight, Download, Flag, MoreHorizontal } from "lucide-react";
import { Fragment, useState } from "react";

import { JsonView } from "@/components/common/json-view";
import { StatusPill, type Tone } from "@/components/common/status-pill";
import { RunSummary } from "@/components/evaluation/run-summary";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ACTIVE_RUN_STATUSES } from "@/lib/config";
import { frameworkLabel } from "@/lib/evaluation";
import { formatDateTime, formatDuration, formatNumber, titleCase } from "@/lib/format";
import type { BenchmarkRunOut, RunExportFormat } from "@/lib/types";
import { cn } from "@/lib/utils";

function runTone(status: string): Tone {
  if (status === "completed") return "success";
  if (status === "failed") return "danger";
  if (status === "running") return "primary";
  if (ACTIVE_RUN_STATUSES.has(status)) return "info";
  return "neutral";
}

export function RunsTable({
  runs,
  onExport,
  onSetBaseline,
}: {
  runs: readonly BenchmarkRunOut[];
  onExport: (run: BenchmarkRunOut, format: RunExportFormat) => void;
  onSetBaseline: (run: BenchmarkRunOut) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);

  return (
    <div className="overflow-x-auto rounded-xl border bg-background scrollbar-thin">
      <table className="w-full min-w-[760px] text-[13px]">
        <caption className="sr-only">Offline benchmark runs</caption>
        <thead>
          <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
            <th scope="col" className="w-9 px-3 py-2"><span className="sr-only">Expand</span></th>
            <th scope="col" className="px-3 py-2 font-medium">Run</th>
            <th scope="col" className="px-3 py-2 font-medium">Framework</th>
            <th scope="col" className="px-3 py-2 font-medium">Status</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">Items</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">Duration</th>
            <th scope="col" className="px-3 py-2 font-medium">Started</th>
            <th scope="col" className="w-10 px-3 py-2"><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => {
            const expanded = open === r.id;
            const active = ACTIVE_RUN_STATUSES.has(r.status);
            return (
              <Fragment key={r.id}>
                <tr className={cn("border-b last:border-0", expanded && "bg-muted/20")}>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() => setOpen(expanded ? null : r.id)}
                      aria-expanded={expanded}
                      aria-label={expanded ? "Hide run details" : "Show run details"}
                      className="flex size-6 items-center justify-center rounded text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <ChevronRight className={cn("size-4 transition-transform", expanded && "rotate-90")} />
                    </button>
                  </td>
                  <td className="max-w-[260px] px-3 py-2">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate font-medium" title={r.label || r.id}>
                        {r.label || `Run ${r.id.slice(0, 8)}`}
                      </span>
                      {r.is_baseline && (
                        <StatusPill tone="primary" dot={false}>
                          <Flag className="size-3" aria-hidden /> Baseline
                        </StatusPill>
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground">Offline benchmark</p>
                  </td>
                  <td className="px-3 py-2">{frameworkLabel(r.framework)}</td>
                  <td className="px-3 py-2">
                    <StatusPill tone={runTone(r.status)} pulse={active}>
                      {titleCase(r.status)}
                    </StatusPill>
                  </td>
                  <td className="tabular px-3 py-2 text-right">{formatNumber(r.item_count)}</td>
                  <td className="tabular px-3 py-2 text-right">{formatDuration(r.duration_ms)}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{formatDateTime(r.created_at)}</td>
                  <td className="px-3 py-2">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-sm" aria-label={`Actions for run ${r.label || r.id}`}>
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-48">
                        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Export</DropdownMenuLabel>
                        <DropdownMenuItem onSelect={() => onExport(r, "json")} disabled={active}>
                          <Download /> JSON
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => onExport(r, "csv")} disabled={active}>
                          <Download /> CSV
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onSelect={() => onSetBaseline(r)} disabled={r.is_baseline || r.status !== "completed"}>
                          <Flag /> Mark as baseline
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
                {expanded && (
                  <tr className="border-b bg-muted/10 last:border-0">
                    <td />
                    <td colSpan={7} className="space-y-3 px-3 pt-1 pb-4">
                      {r.error && (
                        <p className="rounded-lg bg-red-50 px-3 py-2 text-[12.5px] text-red-700 ring-1 ring-red-200/70 ring-inset">{r.error}</p>
                      )}
                      {active ? (
                        <p className="text-[13px] text-muted-foreground">The run is in progress — results appear when it completes.</p>
                      ) : (
                        <RunSummary summary={r.summary} />
                      )}
                      {Object.keys(r.config ?? {}).length > 0 && (
                        <details className="group">
                          <summary className="cursor-pointer text-[12px] font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
                            Run configuration
                          </summary>
                          <JsonView value={r.config} maxHeight="14rem" className="mt-1.5" />
                        </details>
                      )}
                      {Object.keys(r.report_paths ?? {}).length > 0 && (
                        <details>
                          <summary className="cursor-pointer text-[12px] font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
                            Report files (server)
                          </summary>
                          <JsonView value={r.report_paths} maxHeight="10rem" className="mt-1.5" />
                        </details>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
