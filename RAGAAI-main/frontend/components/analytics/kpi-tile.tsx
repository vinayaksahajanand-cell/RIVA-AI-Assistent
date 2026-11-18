import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export function KpiTile({
  icon: Icon,
  label,
  value,
  hint,
  muted = false,
}: {
  icon: LucideIcon;
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  /** Value is a placeholder (no data / not configured) — render in muted ink. */
  muted?: boolean;
}) {
  return (
    <div className="min-w-0 rounded-xl border bg-background px-4 py-3">
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="size-3.5 text-primary/80" aria-hidden />
        <span className="truncate">{label}</span>
      </p>
      <p className={cn("mt-1 truncate text-xl font-semibold tracking-tight tabular", muted && "text-base font-medium text-muted-foreground")}>
        {value}
      </p>
      {hint && <p className="mt-0.5 truncate text-[11.5px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function KpiTileSkeleton() {
  return (
    <div className="rounded-xl border px-4 py-3">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="mt-2 h-6 w-16" />
      <Skeleton className="mt-1.5 h-3 w-28" />
    </div>
  );
}
