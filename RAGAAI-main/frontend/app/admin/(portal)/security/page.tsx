import type { Metadata } from "next";

import { RequirePermission } from "@/components/access/require-permission";
import { SecurityPage } from "@/components/admin/security-page";

export const metadata: Metadata = { title: "Security" };

export default function AdminSecurityPage() {
  return (
    <RequirePermission permission="audit.view">
      <SecurityPage />
    </RequirePermission>
  );
}
