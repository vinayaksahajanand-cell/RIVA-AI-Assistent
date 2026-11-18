"use client";

import type { ReactNode } from "react";

import { AdminGuard } from "@/components/admin/admin-guard";
import { AdminSidebar } from "@/components/admin/admin-sidebar";
import { AppShell } from "@/components/layout/app-shell";
import { SidebarContent } from "@/components/layout/app-sidebar";

/** User portal: chat + library with the purple conversation sidebar. */
export function UserPortalShell({ children }: { children: ReactNode }) {
  return <AppShell sidebar={(onNavigate) => <SidebarContent onNavigate={onNavigate} />}>{children}</AppShell>;
}

/** Admin portal: guarded by `access.admin_portal`, deep-purple sidebar. */
export function AdminPortalShell({ children }: { children: ReactNode }) {
  return (
    <AdminGuard>
      <AppShell variant="admin" sidebar={(onNavigate) => <AdminSidebar onNavigate={onNavigate} />}>
        {children}
      </AppShell>
    </AdminGuard>
  );
}
