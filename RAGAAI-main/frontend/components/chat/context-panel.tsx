"use client";

import { FileText, FlaskConical, FolderClosed, Gauge, Layers, Library, X } from "lucide-react";
import type { ReactNode } from "react";

import { EvaluationStatusPill } from "@/components/chat/evaluation-block";
import { orderSources } from "@/components/chat/sources-details";
import { ScoreBar } from "@/components/common/score-bar";
import { StatusPill } from "@/components/common/status-pill";
import { Button } from "@/components/ui/button";
import { isScopeEmpty, type ChatItem, type ChatScope } from "@/lib/chat";
import { groupEvaluations, isEvaluationActive } from "@/lib/evaluation";
import { describeMetric, formatBytes, formatDate, formatPages, formatSeconds, sortStages } from "@/lib/format";
import type { CollectionOut, DocumentOut } from "@/lib/types";
import { cn } from "@/lib/utils";

function Section({ icon: Icon, title, children }: { icon: typeof Layers; title: string; children: ReactNode }) {
  return (
    <section className="space-y-2 px-4 py-4">
      <h3 className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
        <Icon className="size-3.5" aria-hidden />
        {title}
      </h3>
      {children}
    </section>
  );
}

function DocMeta({ doc }: { doc: DocumentOut }) {
  const parts = [
    doc.page_count !== null ? `${doc.page_count} pages` : null,
    `${doc.chunk_count} chunks`,
    formatBytes(doc.size_bytes),
    doc.indexed_at ? `indexed ${formatDate(doc.indexed_at)}` : null,
  ].filter(Boolean);
  return <p className="truncate text-[11px] text-muted-foreground">{parts.join(" · ")}</p>;
}

export function ContextPanel({
  scope,
  documents,
  collections,
  focused,
  highlightChunkId,
  onClose,
  diagnostics = false,
  accessNote,
}: {
  scope: ChatScope;
  documents: readonly DocumentOut[];
  collections: readonly CollectionOut[];
  focused: ChatItem | null;
  highlightChunkId: string | null;
  onClose?: () => void;
  /** Session may see diagnostics; sources / RAGAS sections also show when the data is present. */
  diagnostics?: boolean;
  /** e.g. "You can access: public, internal documents" */
  accessNote?: string;
}) {
  const docById = new Map(documents.map((d) => [d.id, d]));
  const indexedCount = documents.filter((d) => d.status === "indexed").length;
  const collection = scope.collectionId ? collections.find((c) => c.id === scope.collectionId) : null;
  const message = focused?.message ?? null;
  const showDiagnostics =
    message !== null &&
    message.status !== "blocked" &&
    (diagnostics || message.retrieval !== null || message.evaluations.length > 0);
  const selected = message?.retrieval ? orderSources(message.retrieval.sources).filter((s) => s.selected) : [];
  const answerDocIds = Array.from(new Set(selected.map((s) => s.document_id)));
  const ragas = message ? groupEvaluations(message.evaluations).ragas : [];
  const ragasMain = ragas.find((e) => e.status === "completed") ?? ragas.find(isEvaluationActive) ?? ragas[0] ?? null;
  const topStages = message?.performance
    ? sortStages(message.performance.stages_ms).sort((a, b) => b.ms - a.ms).slice(0, 4)
    : [];

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex h-12 shrink-0 items-center justify-between border-b px-4">
        <h2 className="text-[13px] font-semibold">Context</h2>
        {onClose && (
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close context panel">
            <X />
          </Button>
        )}
      </div>

      <div className="min-h-0 flex-1 divide-y overflow-y-auto scrollbar-thin">
        <Section icon={Layers} title="Document scope">
          {isScopeEmpty(scope) ? (
            <p className="text-[13px]">
              All indexed documents{" "}
              <span className="text-muted-foreground">({indexedCount} indexed)</span>
            </p>
          ) : (
            <ul className="space-y-1.5">
              {scope.collectionId && (
                <li className="flex items-center gap-2 text-[13px]">
                  <FolderClosed className="size-3.5 text-muted-foreground" aria-hidden />
                  <span className="truncate">{collection?.name ?? "Collection"}</span>
                  {collection && <span className="text-[11px] text-muted-foreground">{collection.document_count} docs</span>}
                </li>
              )}
              {scope.documentIds.map((id) => {
                const d = docById.get(id);
                return (
                  <li key={id} className="min-w-0">
                    <p className="flex items-center gap-2 text-[13px]">
                      <FileText className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                      <span className="truncate">{d?.title || d?.filename || "Document"}</span>
                    </p>
                    {d && <div className="pl-5.5"><DocMeta doc={d} /></div>}
                  </li>
                );
              })}
            </ul>
          )}
          {accessNote && <p className="text-[11.5px] text-muted-foreground">{accessNote}</p>}
        </Section>

        {!message ? (
          <div className="px-4 py-8 text-center text-[13px] text-muted-foreground">
            {diagnostics
              ? "Ask a question to see the sources, quality scores and timings for an answer here."
              : "Ask a question to see the timings for an answer here."}
          </div>
        ) : (
          <>
            {showDiagnostics && (
              <Section icon={Library} title="Sources for this answer">
                {!message.retrieval ? (
                  <p className="text-[13px] text-muted-foreground">{focused?.live ? "Retrieving…" : "No retrieval data."}</p>
                ) : selected.length === 0 ? (
                  <p className="text-[13px] text-muted-foreground">No context passages were used.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {selected.map((s) => (
                      <li
                        key={s.chunk_id}
                        className={cn(
                          "rounded-lg border px-2.5 py-2 transition-colors",
                          highlightChunkId === s.chunk_id ? "border-violet-300 bg-accent/60" : "bg-background",
                        )}
                      >
                        <div className="flex items-center gap-1.5">
                          {s.context_index !== null && (
                            <span className="inline-flex h-4 min-w-4 items-center justify-center rounded bg-accent px-1 text-[10px] font-semibold text-accent-foreground">
                              {s.context_index}
                            </span>
                          )}
                          <span className="truncate text-[12.5px] font-medium" title={s.document_name}>
                            {s.document_name}
                          </span>
                        </div>
                        <p className="mt-0.5 text-[11px] text-muted-foreground tabular">
                          {formatPages(s.page_number, s.page_end)}
                          {s.rerank_score !== null && ` · rerank ${s.rerank_score.toFixed(3)}`}
                          {s.rrf_score !== null && ` · RRF ${s.rrf_score.toFixed(4)}`}
                        </p>
                        {highlightChunkId === s.chunk_id && (
                          <p className="mt-1.5 line-clamp-6 text-[12px] leading-relaxed text-foreground/85">{s.content ?? s.snippet}</p>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {answerDocIds.length > 0 && (
                  <div className="space-y-1.5 pt-2">
                    <p className="text-[11px] font-medium text-muted-foreground">Documents</p>
                    {answerDocIds.map((id) => {
                      const d = docById.get(id);
                      const name = d?.title || selected.find((s) => s.document_id === id)?.document_name || "Document";
                      return (
                        <div key={id} className="min-w-0">
                          <p className="truncate text-[12.5px]">{name}</p>
                          {d ? <DocMeta doc={d} /> : <p className="text-[11px] text-muted-foreground">Metadata unavailable</p>}
                        </div>
                      );
                    })}
                  </div>
                )}
              </Section>
            )}

            {showDiagnostics && (
              <Section icon={FlaskConical} title="RAGAS summary">
                {!ragasMain ? (
                  <p className="text-[13px] text-muted-foreground">{focused?.live ? "Runs after the answer completes." : "Not evaluated."}</p>
                ) : (
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <EvaluationStatusPill status={ragasMain.status} />
                      <StatusPill tone="neutral" dot={false}>{ragasMain.mode_label || ragasMain.mode}</StatusPill>
                    </div>
                    {ragasMain.metrics.length > 0 && (
                      <ul className="space-y-1.5">
                        {ragasMain.metrics.map((m) => {
                          const d = describeMetric(m);
                          return (
                            <li key={m.name} className="space-y-0.5">
                              <div className="flex items-center justify-between gap-2 text-[12px]">
                                <span className="truncate">
                                  {m.display_name}
                                  {!m.higher_is_better && <span className="ml-1 text-[10.5px] text-amber-700">↓ lower is better</span>}
                                </span>
                                <span className={cn("tabular font-medium", d.isNA && "text-muted-foreground")} title={d.tooltip ?? undefined}>
                                  {d.text}
                                </span>
                              </div>
                              <ScoreBar value={d.value} higherIsBetter={m.higher_is_better} />
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                )}
              </Section>
            )}

            <Section icon={Gauge} title="Performance">
              {!message.performance ? (
                <p className="text-[13px] text-muted-foreground">{focused?.live ? "Measuring…" : "Not recorded."}</p>
              ) : (
                <div className="space-y-2 text-[12.5px]">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-lg border px-2.5 py-1.5">
                      <p className="text-[11px] text-muted-foreground">Response time</p>
                      <p className="tabular font-semibold">{formatSeconds(message.performance.total_ms)}</p>
                    </div>
                    <div className="rounded-lg border px-2.5 py-1.5">
                      <p className="text-[11px] text-muted-foreground">First token</p>
                      <p className="tabular font-semibold">{formatSeconds(message.performance.time_to_first_token_ms)}</p>
                    </div>
                  </div>
                  {topStages.length > 0 && (
                    <ul className="space-y-1">
                      {topStages.map((s) => (
                        <li key={s.key} className="flex justify-between gap-2">
                          <span className="truncate text-muted-foreground">{s.label}</span>
                          <span className="tabular">{formatSeconds(s.ms)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </Section>
          </>
        )}
      </div>
    </div>
  );
}
