"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";
import { toast } from "sonner";

import { FullPageSplash } from "@/components/common/full-page";
import { useSession } from "@/components/providers/session-provider";

/**
 * Admin portal gate: the session (GET /api/auth/me) must carry `access.admin_portal`.
 * Anyone else is sent back to the user portal with a toast. The backend enforces the same rule
 * on every admin endpoint; this only keeps the UI honest.
 */
export function AdminGuard({ children }: { children: ReactNode }) {
  const { access } = useSession();
  const router = useRouter();
  const notified = useRef(false);
  const allowed = access.admin_portal;

  useEffect(() => {
    if (allowed || notified.current) return;
    notified.current = true;
    toast.error("Your account doesn't have access to the admin portal.");
    router.replace("/");
  }, [allowed, router]);

  if (!allowed) return <FullPageSplash label="Redirecting to RIVA AI…" />;
  return <>{children}</>;
}
