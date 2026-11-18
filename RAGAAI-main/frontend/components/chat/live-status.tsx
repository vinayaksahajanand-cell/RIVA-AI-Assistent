"use client";

import { Check } from "lucide-react";

import type { LiveState } from "@/lib/chat";

/** Live pipeline indicator driven by `status` SSE events. */
export function LiveStatus({ live }: { live: LiveState }) {
  const current = live.stage?.label || (live.receivedTokens ? "Generating answer" : "Thinking");
  const done = live.stages.slice(0, -1);

  return (
    <div className="space-y-1.5" aria-live="polite" aria-atomic="false">
      <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
        <span className="relative flex size-2" aria-hidden>
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary/50" />
          <span className="relative inline-flex size-2 rounded-full bg-primary" />
        </span>
        <span className="bg-gradient-to-r from-foreground/80 via-primary to-foreground/80 bg-clip-text font-medium text-transparent">
          {current}…
        </span>
      </div>
      {done.length > 0 && (
        <ol className="flex flex-wrap gap-x-3 gap-y-1 text-[11.5px] text-muted-foreground" aria-label="Completed steps">
          {done.map((s, i) => (
            <li key={`${s.stage}-${i}`} className="inline-flex items-center gap-1">
              <Check className="size-3 text-emerald-600" aria-hidden />
              {s.label}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
