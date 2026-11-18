"use client";

import { Loader2 } from "lucide-react";

import { LogoMark } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";

export function FullPageSplash({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-riva-glow" role="status" aria-live="polite">
      <LogoMark className="size-10 animate-pulse" />
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden />
        {label}
      </p>
    </div>
  );
}

export function FullPageMessage({
  title,
  description,
  actionLabel,
  onAction,
}: {
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-riva-glow px-6 text-center">
      <LogoMark className="size-10" />
      <div className="max-w-md space-y-1.5">
        <h1 className="text-lg font-semibold">{title}</h1>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      {actionLabel && onAction && (
        <Button onClick={onAction} variant="outline">
          {actionLabel}
        </Button>
      )}
    </div>
  );
}
