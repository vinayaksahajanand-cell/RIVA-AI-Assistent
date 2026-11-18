import type { Metadata } from "next";
import type { ReactNode } from "react";

import { AdminPortalShell } from "@/components/layout/portal-shells";
import { SessionProvider } from "@/components/providers/session-provider";
import { ShellProvider } from "@/components/providers/shell-provider";
import { SystemProvider } from "@/components/providers/system-provider";

export const metadata: Metadata = { title: { default: "Admin", template: "%s · RIVA AI Admin" } };

/** Admin portal (/admin/*): requires `access.admin_portal`; each page also checks its own permission. */
export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <SystemProvider>
        <ShellProvider>
          <AdminPortalShell>{children}</AdminPortalShell>
        </ShellProvider>
      </SystemProvider>
    </SessionProvider>
  );
}
