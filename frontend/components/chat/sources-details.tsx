"use client";

import { Check, ChevronRight, Search, X } from "lucide-react";
import { Fragment, useState, type ReactNode } from "react";

import { StatusPill } from "@/components/common/status-pill";
import { formatMetricValue, formatPages, titleCase } from "@/lib/format";
import type { RetrievalInfo, RetrievedSourceOut } from "@/lib/types";
import { cn } from "@/lib/utils";

export function sourcesSummary(retrieval: RetrievalInfo | null, streaming: boolean): string {
  if (!retrieval) return streaming ? "Searching…" : "No retrieval data";
  const used = retrieval.sources.filter((s) => s.selected).length;
  return `${retrieval.sources.length} retrieved · ${used} used`;
}

/** Selected contexts first (in prompt order), then the remaining candidates by fused rank. */
export function orderSources(sources: readonly RetrievedSourceOut[]): RetrievedSourceOut[] {
  const rank = (s: RetrievedSourceOut) =>
    s.context_index ?? s.final_rank ?? s.fused_rank ?? s.dense_rank ?? s.bm25_rank ?? Number.MAX_SAFE_INTEGER;
  return [...sources].sort((a, b) => {
    if (a.selected !== b.selected) return a.selected ? -1 : 1;
    return rank(a) - rank(b);
  });
}

const fmtScore = (v: number | null, digits = 3) => (v === null ? null : v.toFixed(digits));

function RankCell({ rank, score, scoreLabel }: { rank: number | null; score: number | null; scoreLabel: string }) {
  if (rank === null) return <span className="text-muted-foreground">—</span>;
  const s = fmtScore(score);
  return (
    <span className="tabular whitespace-nowrap">
      #{rank}
      {s !== null && (
        <span className="ml-1 text-[11px] text-muted-foreground" title={scoreLabel}>
          {s}
        </span>
      )}
    </span>
  );
}

const CONFIG_ORDER = ["top_k", "final_k", "rrf_k", "reranker", "reranker_enabled", "reranker_model"];

function configEntries(config: Record<string, unknown>): Array<[string, string]> {
  const keys = Object.keys(config).sort((a, b) => {
    const ia = CONFIG_ORDER.indexOf(a);
    const ib = CONFIG_ORDER.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b);
  });
  return keys
    .filter((k) => {
      const v = config[k];
      return v === null || ["string", "number", "boolean"].includes(typeof v);
    })
    .map((k) => {
      const v = config[k];
      const label = k === "top_k" ? "top_k" : k === "final_k" ? "final_k" : k === "rrf_k" ? "rrf_k" : titleCase(k);
      const value = typeof v === "boolean" ? (v ? "on" : "off") : formatMetricValue(v);
      return [label, value];
    });
}

function Chip({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <span title={title} className="inline-flex items-center gap-1 rounded-md border bg-background px-1.5 py-0.5 text-[11.5px]">
      {children}
    </span>
  );
}

export function SourcesDetails({
  retrieval,
  streaming,
  highlightChunkId,
}: {
  retrieval: RetrievalInfo | null;
  streaming: boolean;
  highlightChunkId?: string | null;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  if (!retrieval) {
    return (
      <p className="text-[13px] text-muted-foreground">
        {streaming ? "Retrieval results will appear here in a moment." : "No retrieval data was recorded for this answer."}
      </p>
    );
  }

  const sources = orderSources(retrieval.sources);
  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const queries = retrieval.search_queries.filter((q) => q.trim());
  const config = configEntries(retrieval.config ?? {});
  const grade = Object.entries(retrieval.grade ?? {}).filter(
    ([, v]) => v === null || ["string", "number", "boolean"].includes(typeof v),
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <Chip title="Retrieval mode">
          Mode <span className="font-medium">{retrieval.mode}</span>
        </Chip>
        <Chip title="Corrective RAG retrieval attempts">
          Attempts <span className="font-medium tabular">{retrieval.attempts}</span>
          {retrieval.attempts > 1 && <span className="text-muted-foreground">(corrective)</span>}
        </Chip>
        <StatusPill tone={retrieval.retrieval_success ? "success" : "warning"}>
          {retrieval.retrieval_success ? "Relevant context found" : "Insufficient context"}
        </StatusPill>
        {config.map(([k, v]) => (
          <Chip key={k}>
            <span className="text-muted-foreground">{k}</span> <span className="font-medium">{v}</span>
          </Chip>
        ))}
      </div>

      {queries.length > 0 && (
        <div>
          <p className="mb-1 text-[11px] font-medium text-muted-foreground">Search queries used</p>
          <ol className="space-y-1">
            {queries.map((q, i) => (
              <li key={`${i}-${q}`} className="flex items-start gap-2 text-[12.5px]">
                <Search className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 break-words">{q}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {grade.length > 0 && (
        <dl className="flex flex-wrap gap-x-4 gap-y-1 text-[12px]">
          {grade.map(([k, v]) => (
            <div key={k} className="flex gap-1">
              <dt className="text-muted-foreground">{titleCase(k)}:</dt>
              <dd className="font-medium">{formatMetricValue(v)}</dd>
            </div>
          ))}
        </dl>
      )}

      {sources.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">No document chunks matched this question.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-background scrollbar-thin">
          <table className="w-full min-w-[720px] text-[12.5px]">
            <caption className="sr-only">Retrieved sources with ranking signals</caption>
            <thead>
              <tr className="border-b bg-muted/40 text-left text-[11px] text-muted-foreground">
                <th scope="col" className="w-8 px-2 py-1.5"><span className="sr-only">Expand</span></th>
                <th scope="col" className="px-2 py-1.5 font-medium">Document</th>
                <th scope="col" className="px-2 py-1.5 font-medium">Pages</th>
                <th scope="col" className="px-2 py-1.5 font-medium" title="Dense (vector) rank · cosine similarity">Dense</th>
                <th scope="col" className="px-2 py-1.5 font-medium" title="BM25 rank · Okapi score">BM25</th>
                <th scope="col" className="px-2 py-1.5 font-medium" title="Fused rank · RRF score">Fused (RRF)</th>
                <th scope="col" className="px-2 py-1.5 font-medium" title="Cross-encoder reranker score">Rerank</th>
                <th scope="col" className="px-2 py-1.5 font-medium">Used</th>
                <th scope="col" className="px-2 py-1.5 font-medium" title="LLM relevance grade">Relevance</th>
              </tr>
            </thead>
            <tbody>
              {sources.map((s) => {
                const open = expanded.has(s.chunk_id);
                const highlighted = highlightChunkId === s.chunk_id;
                return (
                  <Fragment key={s.chunk_id}>
                    <tr
                      className={cn(
                        "border-b align-top last:border-0",
                        s.selected ? "" : "text-muted-foreground",
                        highlighted && "bg-accent/60",
                      )}
                    >
                      <td className="px-2 py-1.5">
                        <button
                          type="button"
                          onClick={() => toggle(s.chunk_id)}
                          aria-expanded={open}
                          aria-label={open ? "Hide passage" : "Show passage"}
                          className="flex size-5 items-center justify-center rounded text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} />
                        </button>
                      </td>
                      <td className="max-w-[220px] px-2 py-1.5">
                        <div className="flex items-center gap-1.5">
                          {s.context_index !== null && (
                            <span className="inline-flex h-4 min-w-4 items-center justify-center rounded bg-accent px-1 text-[10px] font-semibold text-accent-foreground">
                              {s.context_index}
                            </span>
                          )}
                          <span className={cn("truncate", s.selected && "font-medium text-foreground")} title={s.document_name}>
                            {s.document_name}
                          </span>
                        </div>
                        {s.section_title && (
                          <p className="truncate text-[11px] text-muted-foreground" title={s.section_title}>
                            {s.section_title}
                          </p>
                        )}
                      </td>
                      <td className="px-2 py-1.5 whitespace-nowrap">{formatPages(s.page_number, s.page_end)}</td>
                      <td className="px-2 py-1.5"><RankCell rank={s.dense_rank} score={s.dense_score} scoreLabel="Cosine similarity" /></td>
                      <td className="px-2 py-1.5"><RankCell rank={s.bm25_rank} score={s.bm25_score} scoreLabel="BM25 score" /></td>
                      <td className="px-2 py-1.5"><RankCell rank={s.fused_rank} score={s.rrf_score} scoreLabel="RRF score" /></td>
                      <td className="tabular px-2 py-1.5">
                        {s.rerank_score !== null ? s.rerank_score.toFixed(3) : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-2 py-1.5">
                        {s.selected ? (
                          <StatusPill tone="primary" dot={false}>
                            <Check className="size-3" aria-hidden /> Selected
                          </StatusPill>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-2 py-1.5">
                        {s.relevant === null ? (
                          <span className="text-muted-foreground">—</span>
                        ) : s.relevant ? (
                          <span className="inline-flex items-center gap-1 text-emerald-700">
                            <Check className="size-3.5" aria-hidden /> Relevant
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-red-600">
                            <X className="size-3.5" aria-hidden /> Not relevant
                          </span>
                        )}
                      </td>
                    </tr>
                    {open && (
                      <tr className="border-b bg-muted/20 last:border-0">
                        <td />
                        <td colSpan={8} className="px-2 pt-1 pb-3">
                          <p className="max-h-72 overflow-y-auto pr-2 text-[12.5px] leading-relaxed whitespace-pre-wrap text-foreground/90 scrollbar-thin">
                            {s.content ?? s.snippet}
                          </p>
                          {!s.content && (
                            <p className="mt-1 text-[11px] text-muted-foreground">
                              Snippet only — full text is kept for contexts that were given to the model.
                            </p>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
