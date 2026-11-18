"use client";

import { ShieldOff } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { PageContainer } from "@/components/common/page-header";
import { useSession } from "@/components/providers/session-provider";
import { Button } from "@/components/ui/button";
import { roleLabel } from "@/lib/permissions";
import type { Permission } from "@/lib/types";

/** Friendly "not permitted" state for a page the current role cannot open. */
export function NotPermitted({ title = "You don't have access to this page", description }: {
  title?: string;
  description?: ReactNode;
}) {
  const { access } = useSession();
  return (
    <PageContainer>
      <div className="mx-auto flex max-w-md flex-col items-center gap-3 rounded-2xl border border-dashed bg-muted/40 px-6 py-14 text-center">
        <span className="flex size-11 items-center justify-center rounded-full bg-accent text-accent-foreground">
          <ShieldOff className="size-5" aria-hidden />
        </span>
        <h1 className="text-base font-semibold">{title}</h1>
        <p className="text-sm text-muted-foreground">
          {description ?? (
            <>
              Your role (<span className="font-medium text-foreground">{roleLabel(access.role)}</span>) is not permitted to
              view this section. Ask a workspace admin if you need access.
            </>
          )}
        </p>
        <Button asChild variant="outline" size="sm" className="mt-1">
          <Link href={access.admin_portal ? "/admin" : "/"}>{access.admin_portal ? "Back to dashboard" : "Back to chat"}</Link>
        </Button>
      </div>
    </PageContainer>
  );
}

/** Render children only when the session holds `permission`; otherwise show <NotPermitted />. */
export function RequirePermission({ permission, children }: { permission: Permission; children: ReactNode }) {
  const { can } = useSession();
  if (!can(permission)) return <NotPermitted />;
  return <>{children}</>;
}
