import type { Metadata } from "next";

import { RequirePermission } from "@/components/access/require-permission";
import { UsersManager } from "@/components/admin/users-manager";

export const metadata: Metadata = { title: "Users" };

export default function AdminUsersPage() {
  return (
    <RequirePermission permission="users.manage">
      <UsersManager />
    </RequirePermission>
  );
}
