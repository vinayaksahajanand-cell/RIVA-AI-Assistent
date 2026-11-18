import type { Metadata } from "next";
import Link from "next/link";

import { RequirePermission } from "@/components/access/require-permission";
import { PageContainer, PageHeader } from "@/components/common/page-header";
import { SettingsForm } from "@/components/settings/settings-form";
import { SystemInfoCard } from "@/components/settings/system-info-card";

export const metadata: Metadata = { title: "Settings" };

export default function AdminSettingsPage() {
  return (
    <RequirePermission permission="settings.manage">
      <PageContainer>
        <PageHeader
          title="Settings"
          description={
            <>
              Workspace configuration for chunking, retrieval, generation and evaluation. Role clearance and guardrails
              live on the{" "}
              <Link href="/admin/security" className="font-medium text-primary underline-offset-4 hover:underline">
                Security
              </Link>{" "}
              page.
            </>
          }
        />
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
          <SettingsForm />
          <aside className="xl:sticky xl:top-6 xl:self-start">
            <SystemInfoCard />
          </aside>
        </div>
      </PageContainer>
    </RequirePermission>
  );
}
