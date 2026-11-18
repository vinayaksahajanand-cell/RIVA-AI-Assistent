"use client";

import { BookCheck, Database, FlaskConical, Info, Radio, RefreshCw, Scale, type LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/common/empty-state";
import { PageContainer, PageHeader } from "@/components/common/page-header";
import { QueryError } from "@/components/common/query-error";
import { RegressionReports } from "@/components/evaluation/regression-reports";
import { BENCHMARK_KINDS, RunBenchmarkDialog } from "@/components/evaluation/run-benchmark-dialog";
import { RunsTable } from "@/components/evaluation/runs-table";
import { SessionAverages } from "@/components/evaluation/session-averages";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useApiQuery } from "@/hooks/use-api-query";
import { ACTIVE_RUN_STATUSES, RUN_POLL_MS } from "@/lib/config";
import { notifyError } from "@/lib/notify";
import type { BenchmarkKind, BenchmarkRunOut } from "@/lib/types";
import { getEvaluationAnalytics } from "@/services/analytics";
import { exportBenchmarkRun, getBenchmarkRun, getEvaluationReports, setBaselineRun } from "@/services/evaluations";

const MODES: Array<{ icon: LucideIcon; title: string; text: string }> = [
  {
    icon: Radio,
    title: "Online",
    text: "Runs automatically after an answer is delivered (when enabled in Settings). Reference-free metrics computed from the question, retrieved contexts and answer.",
  },
  {
    icon: BookCheck,
    title: "Reference-based",
    text: "Runs when you attach a reference (ground-truth) answer to a response, adding metrics that compare the answer and contexts against it.",
  },
  {
    icon: Database,
    title: "Offline benchmark",
    text: "Runs a labelled dataset on demand. Use it to compare configurations, set a baseline and catch regressions.",
  },
];

const KIND_ICONS: Record<BenchmarkKind, LucideIcon> = { retrieval: Database, ragas: FlaskConical, deepeval: Scale };

function SectionTitle({ title, description }: { title: string; description?: string }) {
  return (
    <div className="space-y-0.5">
      <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
      {description && <p className="text-[13px] text-muted-foreground">{description}</p>}
    </div>
  );
}

export function EvaluationDashboard() {
  const reports = useApiQuery("evaluation:reports", (signal) => getEvaluationReports(signal));
  const session = useApiQuery("evaluation:session", (signal) => getEvaluationAnalytics({}, signal));
  const [dialogKind, setDialogKind] = useState<BenchmarkKind | null>(null);
  const [pollTick, setPollTick] = useState(0);

  const runs = reports.data?.runs ?? [];
  const activeKey = runs
    .filter((r) => ACTIVE_RUN_STATUSES.has(r.status))
    .map((r) => r.id)
    .join(",");

  const { mutate: mutateReports, refresh: refreshReports } = reports;
  const { refresh: refreshSession } = session;

  // Poll each queued/running run; when one finishes, reload reports (regressions) and session averages.
  useEffect(() => {
    if (!activeKey) return;
    const ids = activeKey.split(",");
    let cancelled = false;
    const timer = setTimeout(async () => {
      const results = await Promise.allSettled(ids.map((id) => getBenchmarkRun(id)));
      if (cancelled) return;
      const updated = results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
      mutateReports((prev) =>
        prev ? { ...prev, runs: prev.runs.map((r) => updated.find((u) => u.id === r.id) ?? r) } : prev,
      );
      if (updated.some((u) => !ACTIVE_RUN_STATUSES.has(u.status))) {
        refreshReports();
        refreshSession();
      }
      setPollTick((t) => t + 1);
    }, RUN_POLL_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [activeKey, pollTick, mutateReports, refreshReports, refreshSession]);

  const onStarted = (run: BenchmarkRunOut) => {
    setDialogKind(null);
    reports.mutate((prev) => (prev ? { ...prev, runs: [run, ...prev.runs.filter((r) => r.id !== run.id)] } : prev));
  };

  return (
    <PageContainer>
      <PageHeader
        title="Evaluation Dashboard"
        description="Measure retrieval and answer quality with offline benchmarks, track regressions against a baseline, and review online evaluation averages."
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              reports.refresh();
              session.refresh();
            }}
          >
            <RefreshCw /> Refresh
          </Button>
        }
      />

      <div className="grid gap-3 md:grid-cols-3">
        {MODES.map((m) => (
          <div key={m.title} className="rounded-xl border bg-background p-4">
            <p className="flex items-center gap-2 text-[13px] font-semibold">
              <m.icon className="size-4 text-primary" aria-hidden /> {m.title}
            </p>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted-foreground">{m.text}</p>
          </div>
        ))}
      </div>
      <p className="flex items-start gap-2 rounded-xl bg-accent/60 px-4 py-3 text-[13px] text-accent-foreground ring-1 ring-violet-100 ring-inset">
        <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>
          <span className="font-medium">RAGAS and DeepEval scores are not interchangeable.</span> They use different
          judge prompts, metric definitions and scoring rules. Compare RAGAS with RAGAS and DeepEval with DeepEval —
          never across frameworks.
        </span>
      </p>

      <section className="space-y-3" aria-labelledby="run-heading">
        <h2 id="run-heading" className="sr-only">Run a benchmark</h2>
        <div className="grid gap-3 md:grid-cols-3">
          {(Object.keys(BENCHMARK_KINDS) as BenchmarkKind[]).map((k) => {
            const Icon = KIND_ICONS[k];
            return (
              <div key={k} className="flex flex-col rounded-xl border bg-gradient-to-b from-accent/30 to-background p-4">
                <p className="flex items-center gap-2 text-[13px] font-semibold">
                  <Icon className="size-4 text-primary" aria-hidden /> {BENCHMARK_KINDS[k].title}
                </p>
                <p className="mt-1.5 flex-1 text-[12.5px] leading-relaxed text-muted-foreground">{BENCHMARK_KINDS[k].description}</p>
                <Button className="mt-3 self-start" size="sm" onClick={() => setDialogKind(k)} disabled={!reports.data}>
                  Run {BENCHMARK_KINDS[k].title.split(" ")[0]}
                </Button>
              </div>
            );
          })}
        </div>
      </section>

      <section className="space-y-3">
        <SectionTitle title="Benchmark runs" description="Offline benchmark runs, newest first. Expand a run to see its summary metrics." />
        {reports.error !== undefined && !reports.data && <QueryError error={reports.error} onRetry={reports.refresh} />}
        {!reports.data && reports.error === undefined && <Skeleton className="h-40 w-full rounded-xl" />}
        {reports.data && runs.length === 0 && (
          <EmptyState icon={FlaskConical} title="No benchmark runs yet" description="Start a retrieval, RAGAS or DeepEval benchmark above." />
        )}
        {runs.length > 0 && (
          <RunsTable
            runs={runs}
            onExport={(run, format) =>
              exportBenchmarkRun(run.id, format).then(
                () => toast.success(`Exported ${format.toUpperCase()}`),
                (err: unknown) => notifyError(err),
              )
            }
            onSetBaseline={async (run) => {
              try {
                await setBaselineRun(run.id);
                toast.success("Baseline updated");
                reports.refresh();
              } catch (err) {
                notifyError(err);
              }
            }}
          />
        )}
      </section>

      <section className="space-y-3">
        <SectionTitle
          title="Regression reports"
          description="Each candidate run compared with its framework's baseline. Deltas are colour-coded using each metric's direction."
        />
        {reports.data && reports.data.regressions.length === 0 && (
          <EmptyState compact title="No regression reports" description="Mark a completed run as the baseline, then run the same benchmark again to compare." />
        )}
        {reports.data && reports.data.regressions.length > 0 && <RegressionReports reports={reports.data.regressions} runs={runs} />}
      </section>

      <section className="space-y-3">
        <SectionTitle
          title="Session evaluation averages"
          description="Averages of per-answer evaluations from chat sessions, grouped by framework and mode."
        />
        {session.error !== undefined && !session.data && <QueryError error={session.error} onRetry={session.refresh} />}
        {!session.data && session.error === undefined && <Skeleton className="h-32 w-full rounded-xl" />}
        {session.data && session.data.averages.length === 0 && (
          <EmptyState compact title="No evaluated answers yet" description="Online evaluation results appear here once answers have been evaluated." />
        )}
        {session.data && session.data.averages.length > 0 && (
          <SessionAverages averages={session.data.averages} statusCounts={session.data.status_counts} />
        )}
      </section>

      <RunBenchmarkDialog
        kind={dialogKind}
        datasets={reports.data?.datasets ?? []}
        onOpenChange={(o) => !o && setDialogKind(null)}
        onStarted={onStarted}
      />
    </PageContainer>
  );
}
