"use client";

import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";

import { FullPageMessage, FullPageSplash } from "@/components/common/full-page";
import { useApiQuery } from "@/hooks/use-api-query";
import { can as canWith, loginPathFor } from "@/lib/permissions";
import type { AccessOut, MeResponse, Permission } from "@/lib/types";
import { getMe, logout as apiLogout } from "@/services/auth";
import { ApiError, errorMessage } from "@/services/http";

interface SessionValue {
  me: MeResponse;
  /** Role, permissions and document clearance of the signed-in user. */
  access: AccessOut;
  /** Shorthand for `can(access, perm)` — UI gating only; the backend enforces everything. */
  can: (perm: Permission) => boolean;
  logout: () => Promise<void>;
  refresh: () => void;
}

const SessionContext = createContext<SessionValue | null>(null);

/**
 * Client-side auth guard for both portals. The session cookie is httpOnly and lives on the API
 * origin, so the only reliable check is GET /api/auth/me; a 401 redirects to the portal's login page.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const { data, error, refresh } = useApiQuery("auth:me", (signal) => getMe({ signal }));

  const logout = useCallback(async () => {
    try {
      await apiLogout();
    } catch {
      /* cookie may already be gone — continue to the login page */
    }
    // Deliberate full navigation so no signed-in state survives logout.
    window.location.assign(loginPathFor(window.location.pathname));
  }, []);

  const value = useMemo<SessionValue | null>(() => {
    if (!data) return null;
    const access = data.access;
    return { me: data, access, can: (perm: Permission) => canWith(access, perm), logout, refresh };
  }, [data, logout, refresh]);

  if (error && !(error instanceof ApiError && error.status === 401)) {
    return (
      <FullPageMessage
        title="Can't load your workspace"
        description={errorMessage(error)}
        actionLabel="Try again"
        onAction={refresh}
      />
    );
  }
  if (!value) return <FullPageSplash label={error ? "Redirecting to sign in…" : "Loading your workspace…"} />;

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used inside <SessionProvider>");
  return ctx;
}
