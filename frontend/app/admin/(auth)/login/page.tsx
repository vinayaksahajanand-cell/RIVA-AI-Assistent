import type { Metadata } from "next";
import { Suspense } from "react";

import { AuthForm } from "@/components/auth/auth-form";

export const metadata: Metadata = { title: "Admin sign in" };

export default function AdminLoginPage() {
  return (
    <Suspense fallback={null}>
      <AuthForm mode="login" portal="admin" />
    </Suspense>
  );
}
