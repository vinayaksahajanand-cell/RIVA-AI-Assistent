"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";

import { useApiQuery } from "@/hooks/use-api-query";
import type { SystemInfo } from "@/lib/types";
import { getSystemInfo } from "@/services/system";

interface SystemValue {
  system: SystemInfo | undefined;
  error: unknown;
  isLoading: boolean;
  refresh: () => void;
}

const SystemContext = createContext<SystemValue>({
  system: undefined,
  error: undefined,
  isLoading: true,
  refresh: () => {},
});

/** GET /api/system once per app-shell mount (models, upload limits, feature flags). */
export function SystemProvider({ children }: { children: ReactNode }) {
  const { data, error, isLoading, refresh } = useApiQuery("system", (signal) => getSystemInfo(signal));
  const value = useMemo(() => ({ system: data, error, isLoading, refresh }), [data, error, isLoading, refresh]);
  return <SystemContext.Provider value={value}>{children}</SystemContext.Provider>;
}

export function useSystemInfo(): SystemValue {
  return useContext(SystemContext);
}
