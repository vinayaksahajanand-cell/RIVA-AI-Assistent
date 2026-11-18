"use client";

import {
  AlertOctagon,
  CircleDollarSign,
  Coins,
  FileCheck2,
  Gauge,
  MessageSquareText,
  MessagesSquare,
  Radar,
  ScanSearch,
  ShieldAlert,
  ShieldCheck,
  Target,
  Timer,
} from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";

import { AnalyticsFilters, filtersAreValid } from "@/components/analytics/analytics-filters";
import { LatencyTrendChart, MetricTrendsChart, ModelUsageChart, StageAveragesChart, TtftTrendChart } from "@/components/analytics/charts";
import { KpiTile, KpiTileSkeleton } from "@/components/analytics/kpi-tile";
import { PageContainer, PageHeader } from "@/components/common/page-header";
import { QueryError } from "@/components/common/query-error";
import { useSystemInfo } from "@/components/providers/system-provider";
import { Skeleton } from "@/components/ui/skeleton";
import { useApiQuery } from "@/hooks/use-api-query";
import { formatCost, formatNumber, formatPercent, formatRatioAs100, formatSeconds, titleCase } from "@/lib/format";
import type { AnalyticsFilters as Filters } from "@/lib/types";
import { getAnalyticsOverview, getEvaluationAnalytics, getPerformanceAnalytics } from "@/services/analytics";
import { listCollections } from "@/services/collections";

export function AnalyticsDashboard({
  title = "Analytics",
  description = "Usage, latency, retrieval and answer-quality metrics for this workspace.",
  summary,
}: {
  title?: string;
  description?: ReactNode;
  /** Extra content rendered between the header and the filters (e.g. the admin security summary). */
  summary?: ReactNode;
} = {}) {
  const { system } = useSystemInfo();
  const [filters, setFilters] = useState<Filters>({});
  const valid = filtersAreValid(filters);
  const key = valid ? JSON.stringify(filters) : null;

  const overview = useApiQuery(key && `analytics:overview:${key}`, (s) => getAnalyticsOverview(filters, s), { keepPreviousData: true });
  const performance = useApiQuery(key && `analytics:performance:${key}`, (s) => getPerformanceAnalytics(filters, s), { keepPreviousData: true });
  const evaluations = useApiQuery(key && `analytics:evaluations:${key}`, (s) => getEvaluationAnalytics(filters, s), { keepPreviousData: true });
  const cols = useApiQuery("collections", (s) => listCollections(s));

  const models = useMemo(
    () => Array.from(new Set([...(system?.available_models ?? []), ...(overview.data?.models ?? [])])).sort(),
    [system, overview.data],
  );
  const displayNames = useMemo(
    () => Object.fromEntries((evaluations.data?.averages ?? []).map((a) => [a.metric, a.display_name])),
    [evaluations.data],
  );

  const o = overview.data;
  const tiles = o
    ? [
        {
          icon: FileCheck2,
          label: "Documents indexed",
          value: formatNumber(o.totals.documents_indexed),
          hint: `of ${formatNumber(o.totals.documents_total)} · ${formatNumber(o.totals.chunks_indexed)} chunks${o.totals.documents_failed ? ` · ${o.totals.documents_failed} failed` : ""}`,
        },
        { icon: MessagesSquare, label: "Conversations", value: formatNumber(o.totals.conversations) },
        {
          icon: MessageSquareText,
          label: "Questions answered",
          value: formatNumber(o.totals.questions_answered),
          hint: `${formatNumber(o.totals.insufficient_context_answers)} insufficient context · feedback +${o.quality.thumbs_up} / −${o.quality.thumbs_down}`,
        },
        {
          icon: Timer,
          label: "Avg response time",
          value: formatSeconds(o.latency.avg_total_ms),
          muted: o.latency.avg_total_ms === null,
          hint: `p50 ${formatSeconds(o.latency.p50_total_ms)} · p95 ${formatSeconds(o.latency.p95_total_ms)}`,
        },
        {
          icon: Gauge,
          label: "Avg time to first token",
          value: formatSeconds(o.latency.avg_ttft_ms),
          muted: o.latency.avg_ttft_ms === null,
          hint: `retrieval ${formatSeconds(o.latency.avg_retrieval_ms)} · generation ${formatSeconds(o.latency.avg_generation_ms)}`,
        },
        {
          icon: ShieldCheck,
          label: "Avg faithfulness",
          value: formatRatioAs100(o.quality.avg_faithfulness),
          muted: o.quality.avg_faithfulness === null,
          hint: `RAGAS online · ${formatNumber(o.quality.evaluated_answers)} evaluated`,
        },
        {
          icon: Target,
          label: "Avg answer relevancy",
          value: formatRatioAs100(o.quality.avg_answer_relevancy),
          muted: o.quality.avg_answer_relevancy === null,
          hint: "RAGAS online",
        },
        {
          icon: ScanSearch,
          label: "Avg context precision",
          value: formatRatioAs100(o.quality.avg_context_precision),
          muted: o.quality.avg_context_precision === null,
          hint: "RAGAS online",
        },
        {
          icon: ShieldAlert,
          label: "Hallucination rate",
          value: formatPercent(o.quality.hallucination_rate, 1),
          muted: o.quality.hallucination_rate === null,
          hint: o.quality.hallucination_rate_source ? `Source: ${titleCase(o.quality.hallucination_rate_source)}` : "Requires a DeepEval benchmark run",
        },
        {
          icon: Radar,
          label: "Retrieval success rate",
          value: formatPercent(o.retrieval.success_rate, 1),
          muted: o.retrieval.success_rate === null,
          hint: `${formatNumber(o.retrieval.events)} retrievals · avg ${formatNumber(o.retrieval.avg_attempts, 2)} attempts`,
        },
        { icon: AlertOctagon, label: "Failed queries", value: formatNumber(o.totals.failed_queries) },
        {
          icon: Coins,
          label: "Tokens",
          value: formatNumber(o.tokens.total_tokens),
          hint: `prompt ${formatNumber(o.tokens.prompt_tokens)} · completion ${formatNumber(o.tokens.completion_tokens)}`,
        },
        {
          icon: CircleDollarSign,
          label: "Estimated cost",
          value: o.tokens.pricing_configured ? formatCost(o.tokens.estimated_cost_usd) : "Pricing not configured",
          muted: !o.tokens.pricing_configured || o.tokens.estimated_cost_usd === null,
          hint: o.tokens.pricing_configured ? "Based on configured model pricing" : "Set model pricing in the backend to estimate cost",
        },
      ]
    : null;

  const firstError = overview.error ?? performance.error ?? evaluations.error;

  return (
    <PageContainer>
      <PageHeader title={title} description={description} />
      {summary}
      <AnalyticsFilters value={filters} onChange={setFilters} models={models} collections={cols.data ?? []} />

      {firstError !== undefined && (
        <QueryError
          error={firstError}
          onRetry={() => {
            overview.refresh();
            performance.refresh();
            evaluations.refresh();
          }}
        />
      )}

      <section aria-label="Key metrics" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
        {tiles
          ? tiles.map((t) => <KpiTile key={t.label} icon={t.icon} label={t.label} value={t.value} hint={t.hint} muted={t.muted} />)
          : Array.from({ length: 8 }).map((_, i) => <KpiTileSkeleton key={i} />)}
      </section>

      <section aria-label="Charts" className="grid gap-4 lg:grid-cols-2">
        {performance.data ? (
          <>
            <LatencyTrendChart series={performance.data.series} />
            <TtftTrendChart series={performance.data.series} />
            <StageAveragesChart stages={performance.data.stage_averages_ms} />
          </>
        ) : (
          Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-[300px] rounded-xl" />)
        )}
        {evaluations.data ? (
          <MetricTrendsChart series={evaluations.data.series} displayNames={displayNames} />
        ) : (
          <Skeleton className="h-[300px] rounded-xl" />
        )}
        {performance.data && <ModelUsageChart byModel={performance.data.by_model} />}
      </section>
    </PageContainer>
  );
}
