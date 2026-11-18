import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export type Tone = "neutral" | "info" | "primary" | "success" | "warning" | "danger";

const TONES: Record<Tone, { pill: string; dot: string }> = {
  neutral: { pill: "bg-muted text-muted-foreground ring-border", dot: "bg-muted-foreground/60" },
  info: { pill: "bg-violet-50 text-violet-700 ring-violet-200/70", dot: "bg-violet-500" },
  primary: { pill: "bg-purple-50 text-purple-800 ring-purple-200/70", dot: "bg-purple-600" },
  success: { pill: "bg-emerald-50 text-emerald-700 ring-emerald-200/70", dot: "bg-emerald-500" },
  warning: { pill: "bg-amber-50 text-amber-800 ring-amber-200/70", dot: "bg-amber-500" },
  danger: { pill: "bg-red-50 text-red-700 ring-red-200/70", dot: "bg-red-500" },
};

export function StatusPill({
  tone = "neutral",
  children,
  pulse = false,
  dot = true,
  className,
  title,
}: {
  tone?: Tone;
  children: ReactNode;
  pulse?: boolean;
  dot?: boolean;
  className?: string;
  title?: string;
}) {
  const t = TONES[tone];
  return (
    <span
      title={title}
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1.5 rounded-full px-2 text-[11px] font-medium whitespace-nowrap ring-1 ring-inset",
        t.pill,
        className,
      )}
    >
      {dot && (
        <span className="relative flex size-1.5" aria-hidden>
          {pulse && <span className={cn("absolute inline-flex size-full animate-ping rounded-full opacity-60", t.dot)} />}
          <span className={cn("relative inline-flex size-1.5 rounded-full", t.dot)} />
        </span>
      )}
      {children}
    </span>
  );
}
