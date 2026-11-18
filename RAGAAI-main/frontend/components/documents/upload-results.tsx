"use client";

import { CheckCircle2, Copy, X, XCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { DuplicateInfo, RejectedFile } from "@/lib/types";

export interface UploadOutcome {
  uploaded: string[];
  duplicates: DuplicateInfo[];
  rejected: RejectedFile[];
}

/** Summary of the last upload: accepted, duplicates (with existing title) and rejections with reasons. */
export function UploadResults({ outcome, onDismiss }: { outcome: UploadOutcome; onDismiss: () => void }) {
  const { uploaded, duplicates, rejected } = outcome;
  return (
    <div className="relative rounded-xl border bg-background p-3 pr-10 text-[13px]" role="status">
      <Button variant="ghost" size="icon-xs" className="absolute top-2 right-2" onClick={onDismiss} aria-label="Dismiss upload summary">
        <X />
      </Button>
      <div className="space-y-2">
        {uploaded.length > 0 && (
          <p className="flex items-start gap-2">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden />
            <span>
              <span className="font-medium">{uploaded.length} file{uploaded.length === 1 ? "" : "s"} uploaded</span>{" "}
              <span className="text-muted-foreground">— indexing has started.</span>
            </span>
          </p>
        )}
        {duplicates.length > 0 && (
          <div className="flex items-start gap-2">
            <Copy className="mt-0.5 size-4 shrink-0 text-violet-600" aria-hidden />
            <div>
              <p className="font-medium">
                {duplicates.length} duplicate{duplicates.length === 1 ? "" : "s"} skipped
              </p>
              <ul className="mt-0.5 space-y-0.5 text-muted-foreground">
                {duplicates.map((d) => (
                  <li key={`${d.filename}-${d.existing_document_id}`}>
                    {d.filename} <span className="text-foreground/70">→ already in your library as “{d.existing_title}”</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
        {rejected.length > 0 && (
          <div className="flex items-start gap-2">
            <XCircle className="mt-0.5 size-4 shrink-0 text-red-600" aria-hidden />
            <div>
              <p className="font-medium">
                {rejected.length} file{rejected.length === 1 ? "" : "s"} rejected
              </p>
              <ul className="mt-0.5 space-y-0.5 text-muted-foreground">
                {rejected.map((r, i) => (
                  <li key={`${r.filename}-${i}`}>
                    {r.filename} <span className="text-red-700/90">— {r.reason}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
        {uploaded.length + duplicates.length + rejected.length === 0 && (
          <p className="text-muted-foreground">The server did not report any processed files.</p>
        )}
      </div>
    </div>
  );
}
