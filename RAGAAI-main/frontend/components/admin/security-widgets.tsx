"use client";

import { ArrowRight, FileLock2, ShieldAlert, Users } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { ClassificationBadge, RoleBadge } from "@/components/access/access-badges";
import { QueryError } from "@/components/common/query-error";
import { useSession } from "@/components/providers/session-provider";
import { Skeleton } from "@/components/ui/skeleton";
import { useApiQuery } from "@/hooks/use-api-query";
import { formatNumber } from "@/lib/format";
import { accessibleClassifications, formatClassificationList, roleLabel } from "@/lib/permissions";
import { CLASSIFICATIONS, type SecurityOverview } from "@/lib/types";
import { cn } from "@/lib/utils";
import { getSecurityOverview } from "@/services/admin";

const BAR_COLORS: Record<string, string> = {
  public: "bg-emerald-500",
  internal: "bg-violet-500",
  confidential: "bg-amber-500",
  restricted: "bg-red-500",
};

/** "guardrail.input_blocked" → "Input blocked" */
export function guardrailEventLabel(eventType: string): string {
  const name = eventType.replace(/^guardrail\./, "").replace(/[._]+/g, " ").trim();
  return name ? name.charAt(0).toUpperCase() + name.slice(1) : eventType;
}

export function SummaryCard({ icon: Icon, title, children, className, action }: {
  icon: typeof Users;
  title: string;
  children: ReactNode;
  className?: string;
  action?: ReactNode;
}) {
  return (
    <section className={cn("min-w-0 rounded-xl border bg-background p-4", className)}>
      <header className="mb-3 flex items-center gap-2">
        <span className="flex size-7 items-center justify-center rounded-lg bg-accent text-accent-foreground">
          <Icon className="size-4" aria-hidden />
        </span>
        <h2 className="text-[13.5px] font-semibold">{title}</h2>
        {action && <div className="ml-auto">{action}</div>}
      </header>
      {children}
    </section>
  );
}

/** Horizontal bars: documents per classification (ascending sensitivity). */
export function ClassificationBars({ counts }: { counts: Record<string, number> }) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return (
    <div className="space-y-2.5">
      {total > 0 && (
        <div className="flex h-2.5 overflow-hidden rounded-full bg-muted" aria-hidden>
          {CLASSIFICATIONS.map((c) =>
            counts[c] ? <span key={c} className={BAR_COLORS[c]} style={{ width: `${(counts[c] / total) * 100}%` }} /> : null,
          )}
        </div>
      )}
      <ul className="space-y-1.5">
        {CLASSIFICATIONS.map((c) => (
          <li key={c} className="flex items-center justify-between gap-2 text-[13px]">
            <ClassificationBadge value={c} />
            <span className="tabular font-medium">{formatNumber(counts[c] ?? 0)}</span>
          </li>
        ))}
      </ul>
      <p className="text-[11.5px] text-muted-foreground">{formatNumber(total)} documents in total</p>
    </div>
  );
}

export function GuardrailEventList({ events }: { events: Record<string, number> }) {
  const entries = Object.entries(events).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((n, [, v]) => n + v, 0);
  if (entries.length === 0) {
    return <p className="text-[13px] text-muted-foreground">No guardrail events in the last 30 days.</p>;
  }
  return (
    <div className="space-y-2">
      <p className="text-2xl font-semibold tracking-tight tabular">{formatNumber(total)}</p>
      <ul className="space-y-1.5">
        {entries.map(([type, count]) => (
          <li key={type} className="flex items-center justify-between gap-2 text-[13px]">
            <span className="truncate" title={type}>
              {guardrailEventLabel(type)}
            </span>
            <span className="tabular font-medium">{formatNumber(count)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function OverviewTiles({ data }: { data: SecurityOverview }) {
  return (
    <div className="grid gap-3 md:grid-cols-3">
      <SummaryCard icon={FileLock2} title="Documents by classification">
        <ClassificationBars counts={data.documents_by_classification} />
      </SummaryCard>
      <SummaryCard icon={ShieldAlert} title="Guardrail events · 30 days">
        <GuardrailEventList events={data.guardrail_events_30d} />
      </SummaryCard>
      <SummaryCard icon={Users} title="Members by role">
        <ul className="space-y-2">
          {data.roles.map((r) => (
            <li key={r.role} className="flex items-center justify-between gap-2 text-[13px]">
              <span className="flex min-w-0 items-center gap-1.5">
                <RoleBadge role={r.role} />
                <span className="truncate text-[11.5px] text-muted-foreground">up to {r.clearance}</span>
              </span>
              <span className="tabular font-medium">{formatNumber(r.members)}</span>
            </li>
          ))}
        </ul>
      </SummaryCard>
    </div>
  );
}

/** Admin dashboard card: security overview (requires audit.view). */
export function SecuritySummary() {
  const overview = useApiQuery("admin:security", (signal) => getSecurityOverview(signal));
  return (
    <section aria-label="Security summary" className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Security</h2>
        <Link
          href="/admin/security"
          className="inline-flex items-center gap-1 text-[12.5px] font-medium text-primary underline-offset-4 hover:underline"
        >
          Security settings <ArrowRight className="size-3.5" aria-hidden />
        </Link>
      </div>
      {overview.error !== undefined && !overview.data ? (
        <QueryError error={overview.error} onRetry={overview.refresh} title="Couldn't load the security overview" />
      ) : overview.data ? (
        <OverviewTiles data={overview.data} />
      ) : (
        <div className="grid gap-3 md:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-44 rounded-xl" />
          ))}
        </div>
      )}
    </section>
  );
}

/** Dashboard card for roles without audit.view (managers): what this account can access. */
export function AccessSummary() {
  const { access } = useSession();
  const allowed = accessibleClassifications(access);
  return (
    <SummaryCard icon={FileLock2} title="Your access">
      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        <RoleBadge role={access.role} />
        <span className="text-muted-foreground">
          {roleLabel(access.role)}s can retrieve {formatClassificationList(allowed)} documents.
        </span>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {allowed.map((c) => (
          <ClassificationBadge key={c} value={c} />
        ))}
      </div>
    </SummaryCard>
  );
}
