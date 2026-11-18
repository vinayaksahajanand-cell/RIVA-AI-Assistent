import Link from "next/link";

import { LogoMark } from "@/components/brand/logo";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-riva-glow px-6 text-center">
      <LogoMark className="size-10" />
      <div className="space-y-1">
        <h1 className="text-lg font-semibold">Page not found</h1>
        <p className="text-sm text-muted-foreground">The page you are looking for does not exist or has moved.</p>
      </div>
      <Link href="/" className="text-sm font-medium text-primary underline-offset-4 hover:underline">
        Back to RIVA AI
      </Link>
    </main>
  );
}
