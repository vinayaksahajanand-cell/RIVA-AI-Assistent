/** Admin portal API (backend/app/api/routes/admin.py): members, audit log, security overview. */

import { apiFetch } from "@/services/http";
import type {
  AuditPage,
  AuditQuery,
  MemberCreate,
  MemberOut,
  MemberUpdate,
  OkResponse,
  SecurityOverview,
} from "@/lib/types";

const user = (id: string) => `/api/admin/users/${encodeURIComponent(id)}`;

/** Requires users.manage. */
export function listMembers(q?: string, signal?: AbortSignal): Promise<MemberOut[]> {
  return apiFetch<MemberOut[]>("/api/admin/users", { query: { q }, signal });
}

export function createMember(body: MemberCreate): Promise<MemberOut> {
  return apiFetch<MemberOut>("/api/admin/users", { method: "POST", json: body });
}

/** 422 when demoting/deactivating yourself or the last active admin. */
export function updateMember(id: string, body: MemberUpdate): Promise<MemberOut> {
  return apiFetch<MemberOut>(user(id), { method: "PATCH", json: body });
}

export function removeMember(id: string): Promise<OkResponse> {
  return apiFetch<OkResponse>(user(id), { method: "DELETE" });
}

/** Requires audit.view. `event_type` is a prefix filter (e.g. "guardrail."). */
export function getAuditLog(params: AuditQuery = {}, signal?: AbortSignal): Promise<AuditPage> {
  return apiFetch<AuditPage>("/api/admin/audit", {
    query: { event_type: params.event_type, severity: params.severity, offset: params.offset, limit: params.limit },
    signal,
  });
}

/** Requires audit.view. */
export function getSecurityOverview(signal?: AbortSignal): Promise<SecurityOverview> {
  return apiFetch<SecurityOverview>("/api/admin/security", { signal });
}
