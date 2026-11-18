import type { ReactNode } from "react";

import { APP_FULL_NAME } from "@/lib/config";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="relative flex min-h-dvh flex-col items-center justify-center bg-riva-glow px-4 py-10">
      <div className="w-full max-w-[400px]">{children}</div>
      <p className="mt-8 text-center text-xs text-muted-foreground">{APP_FULL_NAME}</p>
    </main>
  );
}
