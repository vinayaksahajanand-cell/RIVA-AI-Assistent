import { describe, expect, it } from "vitest";

import { safeNextPath } from "@/lib/config";
import {
  accessibleClassifications,
  adminRoutesFor,
  allowedClassifications,
  can,
  canAccessClassification,
  canAll,
  canAny,
  canSeeDiagnostics,
  classificationRank,
  formatClassificationList,
  isAdminPath,
  loginPathFor,
  postLoginPath,
  roleLabel,
} from "@/lib/permissions";
import type { AccessOut } from "@/lib/types";

const ALL = [
  "chat",
  "documents.view",
  "documents.read_content",
  "documents.download",
  "documents.manage",
  "users.manage",
  "settings.manage",
  "analytics.view",
  "evaluation.view",
  "evaluation.run",
  "diagnostics.view",
  "audit.view",
  "pii.view",
  "admin_portal",
];

const admin: AccessOut = {
  role: "admin",
  permissions: ALL,
  clearance: "restricted",
  allowed_classifications: ["public", "internal", "confidential", "restricted"],
  admin_portal: true,
};

const manager: AccessOut = {
  role: "manager",
  permissions: [
    "chat",
    "documents.view",
    "documents.read_content",
    "documents.download",
    "documents.manage",
    "analytics.view",
    "evaluation.view",
    "evaluation.run",
    "diagnostics.view",
    "admin_portal",
  ],
  clearance: "confidential",
  allowed_classifications: ["public", "internal", "confidential"],
  admin_portal: true,
};

const user: AccessOut = {
  role: "user",
  permissions: ["chat", "documents.view"],
  clearance: "internal",
  allowed_classifications: ["public", "internal"],
  admin_portal: false,
};

describe("can()", () => {
  it("checks permission strings", () => {
    expect(can(admin, "users.manage")).toBe(true);
    expect(can(manager, "users.manage")).toBe(false);
    expect(can(manager, "documents.manage")).toBe(true);
    expect(can(user, "chat")).toBe(true);
    expect(can(user, "documents.download")).toBe(false);
  });

  it("is false without a session", () => {
    expect(can(null, "chat")).toBe(false);
    expect(can(undefined, "chat")).toBe(false);
  });

  it("supports any / all and diagnostics", () => {
    expect(canAny(user, ["users.manage", "chat"])).toBe(true);
    expect(canAll(user, ["users.manage", "chat"])).toBe(false);
    expect(canSeeDiagnostics(manager)).toBe(true);
    expect(canSeeDiagnostics(user)).toBe(false);
  });
});

describe("classifications", () => {
  it("ranks in ascending sensitivity, unknown above all", () => {
    expect(classificationRank("public")).toBe(0);
    expect(classificationRank("restricted")).toBe(3);
    expect(classificationRank("top-secret")).toBe(4);
  });

  it("derives the allowed list from a clearance", () => {
    expect(allowedClassifications("internal")).toEqual(["public", "internal"]);
    expect(allowedClassifications("restricted")).toHaveLength(4);
    expect(canAccessClassification("confidential", "restricted")).toBe(false);
    expect(canAccessClassification("confidential", "internal")).toBe(true);
  });

  it("prefers the server's allowed list, sorted, ignoring unknown values", () => {
    expect(
      accessibleClassifications({ clearance: "confidential", allowed_classifications: ["internal", "bogus", "public"] }),
    ).toEqual(["public", "internal"]);
    expect(accessibleClassifications({ clearance: "internal", allowed_classifications: [] })).toEqual([
      "public",
      "internal",
    ]);
    expect(accessibleClassifications(null)).toEqual([]);
  });

  it("formats lists for sentences", () => {
    expect(formatClassificationList(["public"])).toBe("public");
    expect(formatClassificationList(["public", "internal"])).toBe("public and internal");
    expect(formatClassificationList(["public", "internal", "confidential"])).toBe("public, internal and confidential");
  });
});

describe("admin portal navigation", () => {
  const hrefs = (a: AccessOut) => adminRoutesFor(a).map((r) => r.href);

  it("shows every section to admins", () => {
    expect(hrefs(admin)).toEqual([
      "/admin",
      "/admin/documents",
      "/admin/users",
      "/admin/security",
      "/admin/audit",
      "/admin/evaluation",
      "/admin/settings",
    ]);
  });

  it("hides users, security, audit and settings from managers", () => {
    expect(hrefs(manager)).toEqual(["/admin", "/admin/documents", "/admin/evaluation"]);
  });

  it("shows nothing to plain users", () => {
    expect(hrefs(user)).toEqual([]);
  });
});

describe("login routing", () => {
  it("recognises admin paths and their login page", () => {
    expect(isAdminPath("/admin")).toBe(true);
    expect(isAdminPath("/admin/users")).toBe(true);
    expect(isAdminPath("/administrator")).toBe(false);
    expect(loginPathFor("/admin/audit")).toBe("/admin/login");
    expect(loginPathFor("/c/123")).toBe("/login");
  });

  it("sends admin-portal sign-ins to /admin unless next is an admin page", () => {
    expect(postLoginPath("admin", admin, null)).toBe("/admin");
    expect(postLoginPath("admin", admin, "/c/abc")).toBe("/admin");
    expect(postLoginPath("admin", admin, "/admin/users")).toBe("/admin/users");
    expect(postLoginPath("admin", admin, "//evil.example")).toBe("/admin");
  });

  it("sends user-portal sign-ins to a safe next path", () => {
    expect(postLoginPath("user", user, null)).toBe("/");
    expect(postLoginPath("user", user, "/c/abc")).toBe("/c/abc");
    expect(postLoginPath("user", user, "/admin/users")).toBe("/");
    expect(postLoginPath("user", admin, "/admin/users")).toBe("/admin/users");
    expect(postLoginPath("user", user, "https://evil.example")).toBe("/");
  });

  it("never bounces back to a login page", () => {
    expect(safeNextPath("/admin/login")).toBe("/");
    expect(safeNextPath("/login?next=/x")).toBe("/");
  });
});

describe("labels", () => {
  it("humanises roles", () => {
    expect(roleLabel("manager")).toBe("Manager");
    expect(roleLabel("auditor")).toBe("Auditor");
  });
});
