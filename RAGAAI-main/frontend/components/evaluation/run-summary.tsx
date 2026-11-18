"use client";

import { JsonView } from "@/components/common/json-view";
import { formatMetricValue, metricLabel, titleCase } from "@/lib/format";
import { isSummaryEmpty, normalizeSummary } from "@/lib/summary";

/** Generic renderer for a benchmark run's `summary` dict (shape differs per framework). */
export function RunSummary({ summary }: { summary: Record<string, unknown> }) {
  const s = normalizeSummary(summary);
  if (isSummaryEmpty(s)) return <p className="text-[13px] text-muted-foreground">No summary metrics were reported for this run.</p>;

  return (
    <div className="space-y-3">
      {s.scalars.length > 0 && (
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {s.scalars.map(({ key, value }) => (
            <div key={key} className="rounded-lg border bg-background px-3 py-2">
              <dt className="truncate text-[11px] text-muted-foreground" title={key}>
                {metricLabel(key)}
              </dt>
              <dd className="tabular text-sm font-semibold">{formatMetricValue(value)}</dd>
            </div>
          ))}
        </dl>
      )}
      {s.matrices.map((m, i) => (
        <div key={`${m.title ?? "matrix"}-${i}`} className="overflow-x-auto rounded-lg border bg-background scrollbar-thin">
          {m.title && <p className="border-b px-3 py-1.5 text-[12px] font-medium">{titleCase(m.title)}</p>}
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="border-b bg-muted/40 text-left text-[11px] text-muted-foreground">
                <th scope="col" className="px-3 py-1.5 font-medium">
                  {m.colKeys.length === 1 && m.colKeys[0] === "value" ? "Metric" : "Mode"}
                </th>
                {m.colKeys.map((c) => (
                  <th key={c} scope="col" className="px-3 py-1.5 text-right font-medium whitespace-nowrap">
                    {c === "value" ? "Value" : metricLabel(c)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {m.rowKeys.map((r) => (
                <tr key={r} className="border-b last:border-0">
                  <th scope="row" className="px-3 py-1.5 text-left font-medium whitespace-nowrap">
                    {metricLabel(r)}
                  </th>
                  {m.colKeys.map((c) => (
                    <td key={c} className="tabular px-3 py-1.5 text-right">
                      {c in m.values[r] ? formatMetricValue(m.values[r][c]) : "—"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      {s.complex.map(({ key, value }) => (
        <div key={key}>
          <p className="mb-1 text-[11px] font-medium text-muted-foreground">{titleCase(key)}</p>
          <JsonView value={value} maxHeight="14rem" />
        </div>
      ))}
    </div>
  );
}
