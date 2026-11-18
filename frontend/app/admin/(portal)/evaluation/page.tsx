import type { Metadata } from "next";

import { RequirePermission } from "@/components/access/require-permission";
import { EvaluationDashboard } from "@/components/evaluation/evaluation-dashboard";

export const metadata: Metadata = { title: "Evaluation" };

export default function AdminEvaluationPage() {
  return (
    <RequirePermission permission="evaluation.view">
      <EvaluationDashboard />
    </RequirePermission>
  );
}
