"use client";

import { ArrowUpRight, FileText } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { CitationTarget } from "@/lib/citations";
import { formatPages } from "@/lib/format";
import { cn } from "@/lib/utils";

const OPEN_DELAY = 120;
const CLOSE_DELAY = 180;

/**
 * Inline [n] citation chip. Hover (mouse) or click/Enter (touch, keyboard) shows a
 * source preview with document name, page(s), section and snippet.
 */
export function CitationChip({
  index,
  target,
  onSelect,
}: {
  index: number;
  target: CitationTarget | null;
  onSelect?: (target: CitationTarget) => void;
}) {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  if (!target) {
    return (
      <span
        className="mx-0.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-md bg-muted px-1 align-[2px] text-[10.5px] font-semibold text-muted-foreground"
        title="Source details are not available for this marker"
      >
        {index}
      </span>
    );
  }

  const schedule = (next: boolean, delay: number) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(next), delay);
  };
  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
  };

  const pages = formatPages(target.pageNumber, target.pageEnd);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          onPointerEnter={(e) => e.pointerType === "mouse" && schedule(true, OPEN_DELAY)}
          onPointerLeave={(e) => e.pointerType === "mouse" && schedule(false, CLOSE_DELAY)}
          aria-label={`Source ${index}: ${target.documentName}${target.pageNumber ? `, ${pages}` : ""}`}
          className={cn(
            "mx-0.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-md px-1 align-[2px] text-[10.5px] leading-none font-semibold",
            "bg-accent text-accent-foreground ring-1 ring-violet-200/80 ring-inset transition-colors",
            "outline-none hover:bg-violet-100 focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-violet-100",
          )}
        >
          {index}
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        className="w-80 gap-0 p-0"
        onPointerEnter={(e) => e.pointerType === "mouse" && cancel()}
        onPointerLeave={(e) => e.pointerType === "mouse" && schedule(false, CLOSE_DELAY)}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="flex items-start gap-2.5 border-b px-3 py-2.5">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-accent text-accent-foreground">
            <FileText className="size-3.5" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="truncate text-[13px] font-medium" title={target.documentName}>
              {target.documentName}
            </p>
            <p className="truncate text-[11px] text-muted-foreground">
              Source [{index}]
              {target.pageNumber !== null && ` · ${pages}`}
              {target.sectionTitle && ` · ${target.sectionTitle}`}
            </p>
          </div>
        </div>
        <p className="line-clamp-6 px-3 py-2.5 text-[12.5px] leading-relaxed text-foreground/85">
          {target.snippet || "No preview text available."}
        </p>
        {onSelect && (
          <div className="border-t px-2 py-1.5">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onSelect(target);
              }}
              className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium text-primary outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
            >
              View in context panel <ArrowUpRight className="size-3.5" />
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
