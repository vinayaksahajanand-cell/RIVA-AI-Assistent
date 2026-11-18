"use client";

import { Server } from "lucide-react";

import { QueryError } from "@/components/common/query-error";
import { StatusPill } from "@/components/common/status-pill";
import { useSystemInfo } from "@/components/providers/system-provider";
import { Skeleton } from "@/components/ui/skeleton";
import type { ReactNode } from "react";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2 text-[13px]">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right font-medium break-words">{children}</dd>
    </div>
  );
}

function Flag({ on, onLabel = "Enabled", offLabel = "Disabled" }: { on: boolean; onLabel?: string; offLabel?: string }) {
  return <StatusPill tone={on ? "success" : "neutral"}>{on ? onLabel : offLabel}</StatusPill>;
}

/** Read-only backend configuration from GET /api/system. */
export function SystemInfoCard() {
  const { system, error, refresh } = useSystemInfo();
  return (
    <section className="rounded-xl border bg-background" aria-labelledby="system-info-heading">
      <header className="flex items-center gap-2 border-b px-4 py-3">
        <Server className="size-4 text-primary" aria-hidden />
        <h2 id="system-info-heading" className="text-[14px] font-semibold">
          System information
        </h2>
      </header>
      <div className="px-4 py-1">
        {error !== undefined && !system && <QueryError error={error} onRetry={refresh} className="my-3" />}
        {!system && error === undefined && (
          <div className="space-y-2 py-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-5 w-full" />
            ))}
          </div>
        )}
        {system && (
          <dl className="divide-y">
            <Row label="Application">
              {system.app_name} <span className="text-muted-foreground">v{system.version}</span>
            </Row>
            <Row label="LLM configured">
              <Flag on={system.llm_configured} onLabel="Configured" offLabel="Not configured" />
            </Row>
            <Row label="Default model">{system.default_model}</Row>
            <Row label="Embedding provider">{system.embedding_provider}</Row>
            <Row label="Embedding model">{system.embedding_model}</Row>
            <Row label="Embedding dimensions">{system.embedding_dimensions}</Row>
            <Row label="Reranker">{system.reranker_model ?? <span className="text-muted-foreground">None</span>}</Row>
            <Row label="LangSmith tracing">
              <span className="inline-flex flex-col items-end gap-0.5">
                <Flag on={system.langsmith_enabled} />
                {system.langsmith_enabled && system.langsmith_project && (
                  <span className="text-xs font-normal text-muted-foreground">Project: {system.langsmith_project}</span>
                )}
              </span>
            </Row>
            <Row label="OCR">
              <Flag on={system.ocr_enabled} />
            </Row>
            <Row label="Online evaluation">
              <Flag on={system.online_evaluation_available} onLabel="Available" offLabel="Unavailable" />
            </Row>
            <Row label="Max upload size">{system.max_upload_mb} MB</Row>
            <Row label="Supported formats">
              {system.supported_extensions.length
                ? system.supported_extensions.map((e) => e.replace(/^\./, "").toUpperCase()).join(", ")
                : "—"}
            </Row>
          </dl>
        )}
      </div>
    </section>
  );
}
