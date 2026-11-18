"use client";

import { NotPermitted } from "@/components/access/require-permission";
import { AccessSummary, SecuritySummary } from "@/components/admin/security-widgets";
import { AnalyticsDashboard } from "@/components/analytics/analytics-dashboard";
import { useSession } from "@/components/providers/session-provider";

/** /admin — workspace analytics plus a security summary (admins) or the caller's access (managers). */
export function AdminDashboard() {
  const { can } = useSession();
  if (!can("analytics.view")) return <NotPermitted />;
  return (
    <AnalyticsDashboard
      title="Dashboard"
      description="Usage, latency, answer quality and security posture for this workspace."
      summary={can("audit.view") ? <SecuritySummary /> : <AccessSummary />}
    />
  );
}
