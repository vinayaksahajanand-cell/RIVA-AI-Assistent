"use client";

import { StatusPill, type Tone } from "@/components/common/status-pill";
import { Progress } from "@/components/ui/progress";
import { IN_PROGRESS_DOCUMENT_STATUSES } from "@/lib/config";
import { titleCase } from "@/lib/format";
import type { DocumentOut } from "@/lib/types";

const STATUS: Record<string, { label: string; tone: Tone }> = {
  uploaded: { label: "Uploaded", tone: "info" },
  processing: { label: "Processing", tone: "primary" },
  indexed: { label: "Indexed", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
  updating: { label: "Updating", tone: "warning" },
};

export const DOCUMENT_STATUS_OPTIONS = Object.entries(STATUS).map(([value, s]) => ({ value, label: s.label }));

export function DocumentStatusBadge({ status }: { status: string }) {
  const s = STATUS[status] ?? { label: titleCase(status), tone: "neutral" as Tone };
  return (
    <StatusPill tone={s.tone} pulse={IN_PROGRESS_DOCUMENT_STATUSES.has(status)}>
      {s.label}
    </StatusPill>
  );
}

/** Status badge plus live job stage/progress, or the failure reason. */
export function DocumentStatusCell({ doc }: { doc: DocumentOut }) {
  const inProgress = IN_PROGRESS_DOCUMENT_STATUSES.has(doc.status);
  const job = doc.job;
  return (
    <div className="min-w-[150px] space-y-1">
      <DocumentStatusBadge status={doc.status} />
      {inProgress && job && (
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
            <span className="truncate">{titleCase(job.stage || job.status)}</span>
            <span className="tabular">{job.progress}%</span>
          </div>
          <Progress value={job.progress} className="h-1" aria-label={`Indexing progress for ${doc.title}`} />
        </div>
      )}
      {doc.status === "failed" && (doc.error_message || job?.last_error) && (
        <p className="line-clamp-2 max-w-[260px] text-[11px] text-red-700" title={doc.error_message ?? job?.last_error ?? undefined}>
          {doc.error_message ?? job?.last_error}
        </p>
      )}
    </div>
  );
}
