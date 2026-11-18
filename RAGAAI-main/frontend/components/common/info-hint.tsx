"use client";

import { Info } from "lucide-react";
import type { ReactNode } from "react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/** Small (i) icon that reveals an explanation on hover/focus. */
export function InfoHint({ children, className, label = "More information" }: {
  children: ReactNode;
  className?: string;
  label?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className={cn(
            "inline-flex size-4 items-center justify-center rounded-full text-muted-foreground/80 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
            className,
          )}
        >
          <Info className="size-3.5" aria-hidden />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs leading-relaxed">{children}</TooltipContent>
    </Tooltip>
  );
}
