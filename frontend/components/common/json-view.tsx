"use client";

import { Check, Copy } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useCopy } from "@/hooks/use-copy";
import { cn } from "@/lib/utils";

export function JsonView({ value, className, maxHeight = "28rem" }: {
  value: unknown;
  className?: string;
  maxHeight?: string;
}) {
  const text = JSON.stringify(value, null, 2) ?? "null";
  const { copied, copy } = useCopy();
  return (
    <div className={cn("relative rounded-lg border bg-muted/40", className)}>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="absolute top-1.5 right-1.5 bg-background/80"
        onClick={() => copy(text)}
        aria-label={copied ? "Copied" : "Copy JSON"}
      >
        {copied ? <Check className="text-emerald-600" /> : <Copy />}
      </Button>
      <pre
        className="overflow-auto p-3 pr-10 font-mono text-xs leading-relaxed scrollbar-thin"
        style={{ maxHeight }}
      >
        {text}
      </pre>
    </div>
  );
}
