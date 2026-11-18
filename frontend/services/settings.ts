import { apiFetch } from "@/services/http";
import type { WorkspaceSettings } from "@/lib/types";

export function getSettings(signal?: AbortSignal): Promise<WorkspaceSettings> {
  return apiFetch<WorkspaceSettings>("/api/settings", { signal });
}

export function updateSettings(body: WorkspaceSettings): Promise<WorkspaceSettings> {
  return apiFetch<WorkspaceSettings>("/api/settings", { method: "PUT", json: body });
}
