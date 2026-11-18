import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
  compact = false,
}: {
  icon?: LucideIcon;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-xl border border-dashed bg-muted/30 text-center",
        compact ? "gap-1.5 px-4 py-6" : "gap-2.5 px-6 py-12",
        className,
      )}
    >
      {Icon && (
        <span className="flex size-10 items-center justify-center rounded-full bg-accent text-accent-foreground">
          <Icon className="size-5" aria-hidden />
        </span>
      )}
      <p className="text-sm font-medium">{title}</p>
      {description && <div className="max-w-md text-sm text-muted-foreground">{description}</div>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
