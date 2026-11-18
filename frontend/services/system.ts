import { apiFetch } from "@/services/http";
import type { HealthResponse, SystemInfo } from "@/lib/types";

export function getSystemInfo(signal?: AbortSignal): Promise<SystemInfo> {
  return apiFetch<SystemInfo>("/api/system", { signal });
}

export function getHealth(signal?: AbortSignal): Promise<HealthResponse> {
  return apiFetch<HealthResponse>("/api/health", { signal, skipAuthRedirect: true });
}
