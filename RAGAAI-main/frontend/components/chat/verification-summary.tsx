"use client";

import { ChevronDown, ShieldAlert, ShieldCheck, ShieldQuestion } from "lucide-react";
import { useState } from "react";

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import type { VerificationOut } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Grounding verification: grounded yes/no, claim support, unsupported claims, contradictions. */
export function VerificationSummary({ verification }: { verification: VerificationOut | null }) {
  const [open, setOpen] = useState(false);
  if (!verification || verification.status === "not_run") return null;

  if (verification.status !== "completed") {
    return (
      <p className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
        <ShieldQuestion className="size-3.5" aria-hidden />
        Grounding check {verification.status === "skipped" ? "skipped" : "failed"}
        {verification.notes && <span>— {verification.notes}</span>}
      </p>
    );
  }

  const grounded = verification.grounded === true;
  const unknown = verification.grounded === null;
  const hasClaims = verification.supported_claims !== null && verification.total_claims !== null;
  const issues = verification.unsupported_claims.length + verification.contradictions.length;
  const Icon = unknown ? ShieldQuestion : grounded ? ShieldCheck : ShieldAlert;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div
        className={cn(
          "flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg px-2.5 py-1.5 text-[12px] ring-1 ring-inset",
          unknown
            ? "bg-muted/50 text-muted-foreground ring-border"
            : grounded
              ? "bg-emerald-50/70 text-emerald-800 ring-emerald-200/70"
              : "bg-amber-50/80 text-amber-900 ring-amber-200/70",
        )}
      >
        <span className="inline-flex items-center gap-1.5 font-medium">
          <Icon className="size-3.5" aria-hidden />
          {unknown ? "Grounding undetermined" : grounded ? "Grounded in sources" : "Not fully grounded"}
        </span>
        {hasClaims && (
          <span className="tabular">
            {verification.supported_claims}/{verification.total_claims} claims supported
          </span>
        )}
        {issues > 0 && (
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="ml-auto inline-flex items-center gap-0.5 rounded font-medium underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
            >
              {issues} issue{issues === 1 ? "" : "s"}
              <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} aria-hidden />
            </button>
          </CollapsibleTrigger>
        )}
      </div>
      <CollapsibleContent>
        <div className="mt-1.5 space-y-2 rounded-lg border bg-background px-3 py-2 text-[12.5px]">
          {verification.unsupported_claims.length > 0 && (
            <div>
              <p className="mb-0.5 text-[11px] font-medium text-muted-foreground">Unsupported claims</p>
              <ul className="list-disc space-y-0.5 pl-4">
                {verification.unsupported_claims.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            </div>
          )}
          {verification.contradictions.length > 0 && (
            <div>
              <p className="mb-0.5 text-[11px] font-medium text-muted-foreground">Contradictions</p>
              <ul className="list-disc space-y-0.5 pl-4">
                {verification.contradictions.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            </div>
          )}
          {verification.notes && <p className="text-muted-foreground">{verification.notes}</p>}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
