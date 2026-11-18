"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { ChartCard, DataTable, Legend } from "@/components/analytics/chart-card";
import { latencyRows, metricTrend, modelRows, SERIES_COLORS, stageRows } from "@/lib/analytics";
import { formatNumber } from "@/lib/format";
import type { LatencyPoint, MetricPoint, ModelUsage } from "@/lib/types";

const AXIS = { fontSize: 11, fill: "var(--muted-foreground)" };
const GRID = "var(--border)";
const HEIGHT = 240;

const fmtS = (v: unknown) => (typeof v === "number" ? `${v.toFixed(2)} s` : "—");
const fmt100 = (v: unknown) => (typeof v === "number" ? `${Math.round(v)}/100` : "N/A");

/** Hover tooltip: values in text ink, a colour swatch carries series identity. */
interface TooltipEntry {
  dataKey?: unknown;
  name?: unknown;
  value?: unknown;
  color?: string;
}

function ChartTooltip({
  active,
  payload,
  label,
  format,
}: {
  active?: boolean;
  payload?: ReadonlyArray<TooltipEntry>;
  label?: unknown;
  format: (v: unknown) => string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="min-w-36 rounded-lg border bg-popover px-3 py-2 text-xs shadow-md">
      {label !== undefined && label !== null && <p className="mb-1 font-medium text-foreground">{String(label)}</p>}
      <ul className="space-y-0.5">
        {payload.map((p) => (
          <li key={String(p.dataKey)} className="flex items-center justify-between gap-3">
            <span className="inline-flex items-center gap-1.5 text-muted-foreground">
              <span className="size-2 rounded-full" style={{ backgroundColor: p.color }} aria-hidden />
              {String(p.name ?? "")}
            </span>
            <span className="tabular font-medium text-foreground">{format(p.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const lineProps = { type: "monotone" as const, strokeWidth: 2, dot: false, activeDot: { r: 4, strokeWidth: 2, stroke: "#fff" }, connectNulls: false, isAnimationActive: false };

export function LatencyTrendChart({ series }: { series: readonly LatencyPoint[] }) {
  const rows = latencyRows(series);
  const legend = [
    { label: "Average", color: SERIES_COLORS[0] },
    { label: "p95", color: SERIES_COLORS[1] },
  ];
  return (
    <ChartCard
      title="Response latency"
      description="Daily average and 95th percentile end-to-end response time"
      isEmpty={rows.length === 0}
      emptyText="No answered questions in this range."
      legend={<Legend items={legend} />}
      chart={
        <ResponsiveContainer width="100%" height={HEIGHT}>
          <LineChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke={GRID} strokeDasharray="3 3" />
            <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={false} minTickGap={16} />
            <YAxis tick={AXIS} tickLine={false} axisLine={false} width={44} tickFormatter={(v: number) => `${v}s`} />
            <Tooltip cursor={{ stroke: "var(--muted-foreground)", strokeOpacity: 0.3 }} content={(p) => <ChartTooltip active={p.active} payload={p.payload} label={p.label} format={fmtS} />} />
            <Line {...lineProps} dataKey="avg_s" name="Average" stroke={SERIES_COLORS[0]} />
            <Line {...lineProps} dataKey="p95_s" name="p95" stroke={SERIES_COLORS[1]} />
          </LineChart>
        </ResponsiveContainer>
      }
      table={
        <DataTable
          columns={[
            { key: "date", label: "Date" },
            { key: "count", label: "Answers", align: "right" },
            { key: "avg", label: "Average", align: "right" },
            { key: "p95", label: "p95", align: "right" },
          ]}
          rows={rows.map((r) => ({ date: r.date, count: formatNumber(r.count), avg: fmtS(r.avg_s), p95: fmtS(r.p95_s) }))}
        />
      }
    />
  );
}

export function TtftTrendChart({ series }: { series: readonly LatencyPoint[] }) {
  const rows = latencyRows(series);
  const hasData = rows.some((r) => r.ttft_s !== null);
  return (
    <ChartCard
      title="Time to first token"
      description="Daily average delay before the first streamed token"
      isEmpty={!hasData}
      emptyText="No streamed answers with first-token timing in this range."
      chart={
        <ResponsiveContainer width="100%" height={HEIGHT}>
          <LineChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke={GRID} strokeDasharray="3 3" />
            <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={false} minTickGap={16} />
            <YAxis tick={AXIS} tickLine={false} axisLine={false} width={44} tickFormatter={(v: number) => `${v}s`} />
            <Tooltip cursor={{ stroke: "var(--muted-foreground)", strokeOpacity: 0.3 }} content={(p) => <ChartTooltip active={p.active} payload={p.payload} label={p.label} format={fmtS} />} />
            <Line {...lineProps} dataKey="ttft_s" name="Avg TTFT" stroke={SERIES_COLORS[0]} />
          </LineChart>
        </ResponsiveContainer>
      }
      table={
        <DataTable
          columns={[
            { key: "date", label: "Date" },
            { key: "ttft", label: "Avg TTFT", align: "right" },
          ]}
          rows={rows.map((r) => ({ date: r.date, ttft: fmtS(r.ttft_s) }))}
        />
      }
    />
  );
}

export function StageAveragesChart({ stages }: { stages: Record<string, number> }) {
  const rows = stageRows(stages);
  return (
    <ChartCard
      title="Average time per pipeline stage"
      description="Mean duration of each retrieval and generation stage"
      isEmpty={rows.length === 0}
      emptyText="No stage timings recorded in this range."
      chart={
        <ResponsiveContainer width="100%" height={Math.max(HEIGHT, rows.length * 28 + 24)}>
          <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 16, bottom: 0, left: 4 }} barCategoryGap={4}>
            <CartesianGrid horizontal={false} stroke={GRID} strokeDasharray="3 3" />
            <XAxis type="number" tick={AXIS} tickLine={false} axisLine={false} tickFormatter={(v: number) => `${v}s`} />
            <YAxis type="category" dataKey="label" tick={AXIS} tickLine={false} axisLine={false} width={128} />
            <Tooltip cursor={{ fill: "var(--muted)", fillOpacity: 0.6 }} content={(p) => <ChartTooltip active={p.active} payload={p.payload} label={p.label} format={fmtS} />} />
            <Bar dataKey="seconds" name="Average" fill={SERIES_COLORS[0]} radius={[0, 4, 4, 0]} maxBarSize={18} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      }
      table={
        <DataTable
          columns={[
            { key: "stage", label: "Stage" },
            { key: "avg", label: "Average", align: "right" },
          ]}
          rows={rows.map((r) => ({ stage: r.label, avg: fmtS(r.seconds) }))}
        />
      }
    />
  );
}

export function MetricTrendsChart({
  series,
  displayNames,
}: {
  series: readonly MetricPoint[];
  displayNames: Record<string, string>;
}) {
  const trend = metricTrend(series, "ragas", displayNames);
  return (
    <ChartCard
      title="RAGAS metric trends"
      description="Daily average of online RAGAS scores (0–100). Noise sensitivity: lower is better."
      isEmpty={trend.rows.length === 0}
      emptyText="No RAGAS evaluations completed in this range."
      legend={<Legend items={trend.metrics.map((m) => ({ label: m.label, color: m.color }))} />}
      chart={
        <ResponsiveContainer width="100%" height={HEIGHT}>
          <LineChart data={trend.rows} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke={GRID} strokeDasharray="3 3" />
            <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={false} minTickGap={16} />
            <YAxis domain={[0, 100]} tick={AXIS} tickLine={false} axisLine={false} width={36} />
            <Tooltip cursor={{ stroke: "var(--muted-foreground)", strokeOpacity: 0.3 }} content={(p) => <ChartTooltip active={p.active} payload={p.payload} label={p.label} format={fmt100} />} />
            {trend.metrics.map((m) => (
              <Line key={m.key} {...lineProps} dataKey={m.key} name={m.label} stroke={m.color} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      }
      table={
        <DataTable
          columns={[{ key: "date", label: "Date" }, ...trend.metrics.map((m) => ({ key: m.key, label: m.label, align: "right" as const }))]}
          rows={trend.rows.map((r) => ({
            date: String(r.date),
            ...Object.fromEntries(trend.metrics.map((m) => [m.key, fmt100(r[m.key])])),
          }))}
        />
      }
    />
  );
}

export function ModelUsageChart({ byModel }: { byModel: readonly ModelUsage[] }) {
  const rows = modelRows(byModel);
  return (
    <ChartCard
      title="Usage by model"
      description="Answers per model, with average latency and tokens"
      isEmpty={rows.length === 0}
      emptyText="No model usage recorded in this range."
      chart={
        <ResponsiveContainer width="100%" height={Math.max(160, rows.length * 34 + 24)}>
          <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 16, bottom: 0, left: 4 }} barCategoryGap={6}>
            <CartesianGrid horizontal={false} stroke={GRID} strokeDasharray="3 3" />
            <XAxis type="number" allowDecimals={false} tick={AXIS} tickLine={false} axisLine={false} />
            <YAxis type="category" dataKey="model" tick={AXIS} tickLine={false} axisLine={false} width={128} />
            <Tooltip
              cursor={{ fill: "var(--muted)", fillOpacity: 0.6 }}
              content={(p) => <ChartTooltip active={p.active} payload={p.payload} label={p.label} format={(v) => (typeof v === "number" ? `${formatNumber(v)} answers` : "—")} />}
            />
            <Bar dataKey="count" name="Answers" fill={SERIES_COLORS[0]} radius={[0, 4, 4, 0]} maxBarSize={18} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      }
      table={
        <DataTable
          columns={[
            { key: "model", label: "Model" },
            { key: "count", label: "Answers", align: "right" },
            { key: "avg", label: "Avg latency", align: "right" },
            { key: "tokens", label: "Tokens", align: "right" },
          ]}
          rows={rows.map((r) => ({ model: r.model, count: formatNumber(r.count), avg: fmtS(r.avg_s), tokens: formatNumber(r.total_tokens) }))}
        />
      }
    />
  );
}
