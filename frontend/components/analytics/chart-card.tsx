"use client";

import { BarChart3, Table2 } from "lucide-react";
import { useState, type ReactNode } from "react";

import { EmptyState } from "@/components/common/empty-state";
import { cn } from "@/lib/utils";

/** Card wrapper with a Chart / Table toggle (table view = accessible, colour-independent reading). */
export function ChartCard({
  title,
  description,
  isEmpty,
  emptyText,
  chart,
  table,
  legend,
  className,
}: {
  title: string;
  description?: string;
  isEmpty: boolean;
  emptyText: string;
  chart: ReactNode;
  table: ReactNode;
  legend?: ReactNode;
  className?: string;
}) {
  const [view, setView] = useState<"chart" | "table">("chart");
  return (
    <section className={cn("flex min-w-0 flex-col rounded-xl border bg-background", className)} aria-label={title}>
      <header className="flex items-start justify-between gap-3 px-4 pt-3.5">
        <div className="min-w-0">
          <h3 className="text-[13.5px] font-semibold">{title}</h3>
          {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
        </div>
        {!isEmpty && (
          <div className="flex shrink-0 rounded-lg bg-muted p-0.5" role="group" aria-label="View">
            {(["chart", "table"] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                aria-pressed={view === v}
                aria-label={v === "chart" ? "Chart view" : "Table view"}
                className={cn(
                  "flex h-6 w-7 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                  view === v && "bg-background text-foreground shadow-sm",
                )}
              >
                {v === "chart" ? <BarChart3 className="size-3.5" /> : <Table2 className="size-3.5" />}
              </button>
            ))}
          </div>
        )}
      </header>
      <div className="min-h-0 flex-1 px-2 pt-2 pb-3">
        {isEmpty ? (
          <EmptyState compact title="No data yet" description={emptyText} className="mx-2 min-h-[200px]" />
        ) : view === "chart" ? (
          <>
            {legend && <div className="px-2 pb-1">{legend}</div>}
            {chart}
          </>
        ) : (
          <div className="max-h-[280px] overflow-auto px-2 scrollbar-thin">{table}</div>
        )}
      </div>
    </section>
  );
}

export function Legend({ items }: { items: ReadonlyArray<{ label: string; color: string; dashed?: boolean }> }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label="Legend">
      {items.map((it) => (
        <li key={it.label} className="inline-flex items-center gap-1.5">
          <span
            className="inline-block h-0.5 w-4 rounded-full"
            style={
              it.dashed
                ? { backgroundImage: `linear-gradient(to right, ${it.color} 60%, transparent 0)`, backgroundSize: "6px 2px" }
                : { backgroundColor: it.color }
            }
            aria-hidden
          />
          {it.label}
        </li>
      ))}
    </ul>
  );
}

/** Simple accessible data table used by every chart's table view. */
export function DataTable({
  columns,
  rows,
}: {
  columns: ReadonlyArray<{ key: string; label: string; align?: "left" | "right" }>;
  rows: ReadonlyArray<Record<string, ReactNode>>;
}) {
  return (
    <table className="w-full text-[12.5px]">
      <thead className="sticky top-0 bg-background">
        <tr className="border-b text-left text-[11px] text-muted-foreground">
          {columns.map((c) => (
            <th key={c.key} scope="col" className={cn("px-2 py-1.5 font-medium", c.align === "right" && "text-right")}>
              {c.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className="border-b last:border-0">
            {columns.map((c) => (
              <td key={c.key} className={cn("px-2 py-1.5", c.align === "right" && "tabular text-right")}>
                {r[c.key] ?? "—"}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
