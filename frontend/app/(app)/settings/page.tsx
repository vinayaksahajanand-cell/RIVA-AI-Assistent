import type { Metadata } from "next";

import { PageContainer, PageHeader } from "@/components/common/page-header";
import { SettingsForm } from "@/components/settings/settings-form";
import { SystemInfoCard } from "@/components/settings/system-info-card";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <PageContainer>
      <PageHeader
        title="Settings"
        description="Workspace configuration for chunking, retrieval, generation and evaluation."
      />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <SettingsForm />
        <aside className="xl:sticky xl:top-6 xl:self-start">
          <SystemInfoCard />
        </aside>
      </div>
    </PageContainer>
  );
}
