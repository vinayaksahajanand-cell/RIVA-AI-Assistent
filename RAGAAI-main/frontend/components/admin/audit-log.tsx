"use client";

import { ChevronDown, ChevronLeft, ChevronRight, RotateCw, ScrollText } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Fragment, useState } from "react";

import { EmptyState } from "@/components/common/empty-state";
import { JsonView } from "@/components/common/json-view";
import { PageContainer, PageHeader } from "@/components/common/page-header";
import { QueryError } from "@/components/common/query-error";
import { StatusPill, type Tone } from "@/components/common/status-pill";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useApiQuery } from "@/hooks/use-api-query";
import { formatDateTime, formatNumber, formatRelativeTime } from "@/lib/format";
import type { AuditSeverity } from "@/lib/types";
import { cn } from "@/lib/utils";
import { getAuditLog } from "@/services/admin";

const PAGE_SIZE = 25;
const ALL = "__all__";

export const AUDIT_EVENT_FILTERS: Array<{ value: string; label: string }> = [
  { value: "guardrail.", label: "Guardrails" },
  { value: "access.", label: "Access denials" },
  { value: "auth.", label: "Sign-ins" },
  { value: "admin.", label: "Admin actions" },
  { value: "document.", label: "Documents" },
];

const SEVERITIES: AuditSeverity[] = ["info", "warning", "critical"];
const SEVERITY_TONE: Record<string, Tone> = { info: "info", warning: "warning", critical: "danger" };

function SeverityBadge({ severity }: { severity: string }) {
  return (
    <StatusPill tone={SEVERITY_TONE[severity] ?? "neutral"} className="capitalize">
      {severity}
    </StatusPill>
  );
}

/** /admin/audit — security and admin events, filterable by type prefix and severity. Requires audit.view. */
export function AuditLog() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const eventType = params.get("event_type") ?? "";
  const severityParam = params.get("severity");
  const severity = SEVERITIES.includes(severityParam as AuditSeverity) ? (severityParam as AuditSeverity) : undefined;
  const page = Math.max(0, Number.parseInt(params.get("page") ?? "0", 10) || 0);
  const [expanded, setExpanded] = useState<string | null>(null);

  const setParams = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    setExpanded(null);
  };

  const key = `admin:audit:${eventType}:${severity ?? ""}:${page}`;
  const audit = useApiQuery(
    key,
    (signal) => getAuditLog({ event_type: eventType || undefined, severity, offset: page * PAGE_SIZE, limit: PAGE_SIZE }, signal),
    { keepPreviousData: true },
  );
  const data = audit.data;
  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const filtered = Boolean(eventType || severity);
  const knownFilter = AUDIT_EVENT_FILTERS.some((f) => f.value === eventType);

  return (
    <PageContainer>
      <PageHeader
        title="Audit log"
        description="Guardrail blocks and redactions, access denials, sign-ins and admin changes in this workspace."
        actions={
          <Button variant="outline" onClick={audit.refresh}>
            <RotateCw /> Refresh
          </Button>
        }
      />

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Select value={eventType || ALL} onValueChange={(v) => setParams({ event_type: v === ALL ? null : v, page: null })}>
          <SelectTrigger className="h-9 w-full sm:w-52" aria-label="Filter by event type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All events</SelectItem>
            {AUDIT_EVENT_FILTERS.map((f) => (
              <SelectItem key={f.value} value={f.value}>
                {f.label}
              </SelectItem>
            ))}
            {eventType && !knownFilter && <SelectItem value={eventType}>{eventType}</SelectItem>}
          </SelectContent>
        </Select>
        <Select value={severity ?? ALL} onValueChange={(v) => setParams({ severity: v === ALL ? null : v, page: null })}>
          <SelectTrigger className="h-9 w-full sm:w-40" aria-label="Filter by severity">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All severities</SelectItem>
            {SEVERITIES.map((s) => (
              <SelectItem key={s} value={s} className="capitalize">
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {filtered && (
          <Button variant="ghost" size="sm" onClick={() => setParams({ event_type: null, severity: null, page: null })}>
            Clear filters
          </Button>
        )}
        <p className="text-xs text-muted-foreground sm:ml-auto" aria-live="polite">
          {data ? `${formatNumber(total)} event${total === 1 ? "" : "s"}` : ""}
        </p>
      </div>

      {audit.error !== undefined && !data && <QueryError error={audit.error} onRetry={audit.refresh} />}
      {!data && audit.error === undefined && (
        <div className="space-y-2 rounded-xl border p-4" aria-busy="true">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      )}
      {data && data.items.length === 0 && (
        <EmptyState
          icon={ScrollText}
          title={filtered ? "No events match these filters" : "No audit events yet"}
          description={filtered ? "Try a different event type or severity." : "Security and admin activity will appear here."}
        />
      )}
      {data && data.items.length > 0 && (
        <div className={cn("overflow-x-auto rounded-xl border bg-background scrollbar-thin", audit.isLoading && "opacity-70")}>
          <Table className="min-w-[860px]">
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="w-10 pl-3">
                  <span className="sr-only">Details</span>
                </TableHead>
                <TableHead>Time</TableHead>
                <TableHead>Severity</TableHead>
                <TableHead>Event</TableHead>
                <TableHead>Summary</TableHead>
                <TableHead className="pr-4">Actor</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.items.map((e) => {
                const open = expanded === e.id;
                const detailsId = `audit-details-${e.id}`;
                return (
                  <Fragment key={e.id}>
                    <TableRow
                      className={cn("cursor-pointer", open && "bg-accent/40 hover:bg-accent/40")}
                      onClick={() => setExpanded(open ? null : e.id)}
                    >
                      <TableCell className="pl-3">
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          aria-expanded={open}
                          aria-controls={detailsId}
                          aria-label={open ? "Hide details" : "Show details"}
                          onClick={(ev) => {
                            ev.stopPropagation();
                            setExpanded(open ? null : e.id);
                          }}
                        >
                          <ChevronDown className={cn("transition-transform", open && "rotate-180")} />
                        </Button>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground" title={formatDateTime(e.created_at)}>
                        {formatRelativeTime(e.created_at)}
                      </TableCell>
                      <TableCell>
                        <SeverityBadge severity={e.severity} />
                      </TableCell>
                      <TableCell>
                        <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11.5px]">{e.event_type}</code>
                      </TableCell>
                      <TableCell className="max-w-[420px]">
                        <span className="line-clamp-2 whitespace-normal">{e.summary}</span>
                      </TableCell>
                      <TableCell className="max-w-[220px] truncate pr-4 text-muted-foreground">{e.actor_email ?? "—"}</TableCell>
                    </TableRow>
                    {open && (
                      <TableRow id={detailsId} className="hover:bg-transparent">
                        <TableCell colSpan={6} className="bg-muted/20 px-4 py-3 whitespace-normal">
                          <dl className="mb-2 grid gap-x-6 gap-y-1 text-[12px] sm:grid-cols-3">
                            <div>
                              <dt className="text-muted-foreground">Recorded</dt>
                              <dd className="tabular">{formatDateTime(e.created_at)}</dd>
                            </div>
                            <div className="min-w-0">
                              <dt className="text-muted-foreground">User ID</dt>
                              <dd className="truncate font-mono text-[11.5px]">{e.user_id ?? "—"}</dd>
                            </div>
                            <div className="min-w-0">
                              <dt className="text-muted-foreground">Message ID</dt>
                              <dd className="truncate font-mono text-[11.5px]">{e.message_id ?? "—"}</dd>
                            </div>
                          </dl>
                          <JsonView value={e.details} maxHeight="18rem" />
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {data && total > PAGE_SIZE && (
        <nav aria-label="Audit log pages" className="flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground tabular">
            {formatNumber(page * PAGE_SIZE + 1)}–{formatNumber(Math.min(total, (page + 1) * PAGE_SIZE))} of {formatNumber(total)}
          </p>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setParams({ page: page - 1 > 0 ? String(page - 1) : null })}>
              <ChevronLeft /> Previous
            </Button>
            <span className="px-2 text-xs text-muted-foreground tabular">
              Page {page + 1} of {pages}
            </span>
            <Button variant="outline" size="sm" disabled={page + 1 >= pages} onClick={() => setParams({ page: String(page + 1) })}>
              Next <ChevronRight />
            </Button>
          </div>
        </nav>
      )}
    </PageContainer>
  );
}
