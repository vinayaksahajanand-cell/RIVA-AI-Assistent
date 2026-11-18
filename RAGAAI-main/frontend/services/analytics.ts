import { apiFetch } from "@/services/http";
import type { AnalyticsFilters, AnalyticsOverview, EvaluationAnalytics, PerformanceAnalytics } from "@/lib/types";

const toQuery = (f: AnalyticsFilters) => ({
  date_from: f.date_from,
  date_to: f.date_to,
  model: f.model,
  collection_id: f.collection_id,
});

export function getAnalyticsOverview(filters: AnalyticsFilters, signal?: AbortSignal): Promise<AnalyticsOverview> {
  return apiFetch<AnalyticsOverview>("/api/analytics/overview", { query: toQuery(filters), signal });
}

export function getPerformanceAnalytics(filters: AnalyticsFilters, signal?: AbortSignal): Promise<PerformanceAnalytics> {
  return apiFetch<PerformanceAnalytics>("/api/analytics/performance", { query: toQuery(filters), signal });
}

export function getEvaluationAnalytics(filters: AnalyticsFilters, signal?: AbortSignal): Promise<EvaluationAnalytics> {
  return apiFetch<EvaluationAnalytics>("/api/analytics/evaluations", { query: toQuery(filters), signal });
}
