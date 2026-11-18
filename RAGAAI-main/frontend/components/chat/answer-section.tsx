"use client";

import { ChevronDown, type LucideIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

/** One expandable row inside the answer's details card. */
export function AnswerSection({
  icon: Icon,
  title,
  summary,
  children,
  defaultOpen = false,
}: {
  icon: LucideIcon;
  title: string;
  summary?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-[13px] outline-none transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        >
          <Icon className="size-4 shrink-0 text-primary/80" aria-hidden />
          <span className="font-medium">{title}</span>
          <span className="ml-auto flex min-w-0 items-center gap-2 truncate text-xs text-muted-foreground">{summary}</span>
          <ChevronDown
            className={cn("size-4 shrink-0 text-muted-foreground transition-transform duration-200", open && "rotate-180")}
            aria-hidden
          />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="data-closed:animate-out data-closed:fade-out-0 data-open:animate-in data-open:fade-in-0">
        <div className="border-t bg-muted/15 px-3 py-3">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}

/** Small label/value pair used in section bodies. */
export function Stat({ label, value, hint, emphasis = false }: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  emphasis?: boolean;
}) {
  return (
    <div className="min-w-0 rounded-lg border bg-background px-3 py-2">
      <div className="flex items-center gap-1 text-[11px] text-muted-foreground">{label}</div>
      <div className={cn("tabular truncate", emphasis ? "text-lg font-semibold tracking-tight" : "text-sm font-medium")}>
        {value}
      </div>
      {hint && <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  );
}
