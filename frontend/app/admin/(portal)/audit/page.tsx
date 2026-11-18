import type { Metadata } from "next";
import { Suspense } from "react";

import { RequirePermission } from "@/components/access/require-permission";
import { AuditLog } from "@/components/admin/audit-log";

export const metadata: Metadata = { title: "Audit log" };

export default function AdminAuditPage() {
  return (
    <RequirePermission permission="audit.view">
      {/* Filters live in the URL (useSearchParams), which needs a Suspense boundary. */}
      <Suspense fallback={null}>
        <AuditLog />
      </Suspense>
    </RequirePermission>
  );
}
