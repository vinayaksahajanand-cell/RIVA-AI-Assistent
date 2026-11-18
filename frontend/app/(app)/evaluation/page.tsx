import type { Metadata } from "next";

import { EvaluationDashboard } from "@/components/evaluation/evaluation-dashboard";

export const metadata: Metadata = { title: "Evaluation Dashboard" };

export default function EvaluationPage() {
  return <EvaluationDashboard />;
}
