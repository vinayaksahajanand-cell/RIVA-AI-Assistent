"use client";

import { AlertCircle, CheckCircle2, Copy as DuplicateIcon, FileText, Loader2, X } from "lucide-react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Attachment } from "@/hooks/use-attachments";
import { formatBytes, titleCase } from "@/lib/format";
import { cn } from "@/lib/utils";

function describe(a: Attachment): string {
  switch (a.state) {
    case "uploading":
      return "Uploading…";
    case "processing": {
      const stage = a.stage ? titleCase(a.stage) : "Indexing";
      return a.progress !== null ? `${stage} · ${a.progress}%` : `${stage}…`;
    }
    case "indexed":
      return "Indexed";
    case "duplicate":
      return a.message ?? "Already uploaded";
    case "rejected":
      return a.message ?? "Rejected";
    case "failed":
      return a.message ?? "Failed";
  }
}

/** Uploaded-from-composer files with live indexing progress. */
export function AttachmentTray({ attachments, onRemove }: { attachments: Attachment[]; onRemove: (key: string) => void }) {
  if (attachments.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-1.5 px-3 pt-3" aria-label="Attached files">
      {attachments.map((a) => {
        const bad = a.state === "failed" || a.state === "rejected";
        const busy = a.state === "uploading" || a.state === "processing";
        const Icon = busy ? Loader2 : bad ? AlertCircle : a.state === "duplicate" ? DuplicateIcon : a.state === "indexed" ? CheckCircle2 : FileText;
        const text = describe(a);
        return (
          <li
            key={a.key}
            className={cn(
              "relative flex max-w-[260px] items-center gap-2 overflow-hidden rounded-lg border bg-muted/40 py-1.5 pr-1 pl-2 text-xs",
              bad && "border-red-200 bg-red-50/60",
            )}
          >
            <Icon
              className={cn(
                "size-3.5 shrink-0",
                busy && "animate-spin text-primary",
                bad && "text-red-600",
                a.state === "indexed" && "text-emerald-600",
                a.state === "duplicate" && "text-violet-600",
              )}
              aria-hidden
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium" title={a.name}>
                {a.name}
              </span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className={cn("block truncate text-[11px]", bad ? "text-red-700" : "text-muted-foreground")} tabIndex={0}>
                    {text} · {formatBytes(a.size)}
                  </span>
                </TooltipTrigger>
                <TooltipContent>{text}</TooltipContent>
              </Tooltip>
            </span>
            <button
              type="button"
              onClick={() => onRemove(a.key)}
              className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground outline-none hover:bg-background hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={`Remove ${a.name} from this list`}
            >
              <X className="size-3" />
            </button>
            {a.state === "processing" && a.progress !== null && (
              <span
                className="absolute bottom-0 left-0 h-0.5 bg-primary/70 transition-[width] duration-500"
                style={{ width: `${Math.max(3, Math.min(100, a.progress))}%` }}
                aria-hidden
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}
