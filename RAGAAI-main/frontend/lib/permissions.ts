/**
 * Client-side RBAC helpers mirroring backend/app/core/rbac.py.
 *
 * These only decide what the UI shows — the backend enforces every permission and clearance check.
 */

import { safeNextPath } from "@/lib/config";
import { CLASSIFICATIONS, type AccessOut, type Classification, type Permission, type Portal } from "@/lib/types";

type MaybeAccess = Pick<AccessOut, "permissions"> | null | undefined;

/** Does this session hold `perm`? */
export function can(access: MaybeAccess, perm: Permission): boolean {
  return Boolean(access?.permissions?.includes(perm));
}

export function canAny(access: MaybeAccess, perms: readonly Permission[]): boolean {
  return perms.some((p) => can(access, p));
}

export function canAll(access: MaybeAccess, perms: readonly Permission[]): boolean {
  return perms.every((p) => can(access, p));
}

/** Diagnostics = retrieved sources + RAGAS panels under answers (and evaluation polling). */
export function canSeeDiagnostics(access: MaybeAccess): boolean {
  return can(access, "diagnostics.view");
}

/* ------------------------------------------------------------ classifications */

export function isClassification(value: unknown): value is Classification {
  return typeof value === "string" && (CLASSIFICATIONS as readonly string[]).includes(value);
}

/** 0 = public … 3 = restricted; unknown values rank above everything (never accessible). */
export function classificationRank(value: string): number {
  const i = (CLASSIFICATIONS as readonly string[]).indexOf(value);
  return i === -1 ? CLASSIFICATIONS.length : i;
}

/** All classifications at or below a clearance level. */
export function allowedClassifications(clearance: string): Classification[] {
  return CLASSIFICATIONS.slice(0, classificationRank(clearance) + 1);
}

export function canAccessClassification(clearance: string, classification: string): boolean {
  return classificationRank(classification) <= classificationRank(clearance);
}

/** Classifications this session may assign / sees, in ascending order (falls back to its clearance). */
export function accessibleClassifications(access: Pick<AccessOut, "clearance" | "allowed_classifications"> | null | undefined): Classification[] {
  if (!access) return [];
  const listed = (access.allowed_classifications ?? []).filter(isClassification);
  const list = listed.length > 0 ? listed : allowedClassifications(access.clearance);
  return [...list].sort((a, b) => classificationRank(a) - classificationRank(b));
}

/** "public, internal" / "public, internal and confidential" */
export function formatClassificationList(list: readonly string[]): string {
  if (list.length === 0) return "no";
  if (list.length === 1) return list[0];
  return `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
}

/* -------------------------------------------------------------------- portals */

export interface AdminRoute {
  href: string;
  label: string;
  permission: Permission;
}

/** Admin portal navigation, each entry gated by the permission its page requires. */
export const ADMIN_ROUTES: readonly AdminRoute[] = [
  { href: "/admin", label: "Dashboard", permission: "analytics.view" },
  { href: "/admin/documents", label: "Documents", permission: "documents.manage" },
  { href: "/admin/users", label: "Users", permission: "users.manage" },
  { href: "/admin/security", label: "Security", permission: "audit.view" },
  { href: "/admin/audit", label: "Audit log", permission: "audit.view" },
  { href: "/admin/evaluation", label: "Evaluation", permission: "evaluation.view" },
  { href: "/admin/settings", label: "Settings", permission: "settings.manage" },
] as const;

export function adminRoutesFor(access: MaybeAccess): AdminRoute[] {
  return ADMIN_ROUTES.filter((r) => can(access, r.permission));
}

/** Is this an admin-portal path (including its login page)? */
export function isAdminPath(pathname: string): boolean {
  return pathname === "/admin" || pathname.startsWith("/admin/");
}

/** Where the login page of the portal that owns `pathname` lives. */
export function loginPathFor(pathname: string): "/admin/login" | "/login" {
  return isAdminPath(pathname) ? "/admin/login" : "/login";
}

/**
 * Destination after a successful sign-in.
 *  - admin portal → a safe `?next=` inside /admin, else /admin
 *  - user portal  → a safe `?next=` (admin paths only when the account may open the admin portal), else /
 */
export function postLoginPath(
  portal: Portal,
  access: Pick<AccessOut, "admin_portal"> | null | undefined,
  rawNext: string | null | undefined,
): string {
  const next = safeNextPath(rawNext);
  if (portal === "admin") return isAdminPath(next) ? next : "/admin";
  if (isAdminPath(next) && !access?.admin_portal) return "/";
  return next;
}

/* ----------------------------------------------------------------- labels */

export const ROLE_LABELS: Record<string, string> = { admin: "Admin", manager: "Manager", user: "User" };

export function roleLabel(role: string): string {
  return ROLE_LABELS[role] ?? (role ? role.charAt(0).toUpperCase() + role.slice(1) : "Member");
}

export function classificationLabel(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : "Unclassified";
}
