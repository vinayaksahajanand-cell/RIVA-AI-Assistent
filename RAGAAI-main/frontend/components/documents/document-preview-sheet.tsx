"use client";

import { ExternalLink, Loader2, Search } from "lucide-react";
import { useState } from "react";

import { EmptyState } from "@/components/common/empty-state";
import { JsonView } from "@/components/common/json-view";
import { QueryError } from "@/components/common/query-error";
import { DocumentStatusBadge } from "@/components/documents/document-status";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useApiQuery } from "@/hooks/use-api-query";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { formatBytes, formatDateTime, formatNumber, formatPages, titleCase } from "@/lib/format";
import { notifyError } from "@/lib/notify";
import type { ChunkOut, DocumentDetail } from "@/lib/types";
import { documentFileUrl, getDocument, getDocumentChunks } from "@/services/documents";

const PAGE = 20;

function ChunkCard({ chunk }: { chunk: ChunkOut }) {
  return (
    <article className="rounded-lg border bg-background">
      <header className="flex flex-wrap items-center gap-x-2 gap-y-0.5 border-b bg-muted/30 px-3 py-1.5 text-[11px] text-muted-foreground">
        <span className="font-semibold text-foreground">#{chunk.chunk_index}</span>
        <span>{formatPages(chunk.page_number, chunk.page_end)}</span>
        {chunk.section_title && <span className="max-w-[240px] truncate">· {chunk.section_title}</span>}
        <span>· {titleCase(chunk.chunk_type)}</span>
        <span className="ml-auto tabular">
          {chunk.token_count} tokens · v{chunk.document_version}
        </span>
      </header>
      <p className="px-3 py-2 text-[12.5px] leading-relaxed whitespace-pre-wrap">{chunk.content}</p>
    </article>
  );
}

/** Paged chunk list for one (document, query) pair; remounted when either changes. */
function ChunkBrowser({ documentId, query }: { documentId: string; query: string }) {
  const first = useApiQuery(`chunks:${documentId}:${query}`, (signal) =>
    getDocumentChunks(documentId, { offset: 0, limit: PAGE, q: query || undefined }, signal),
  );
  const [more, setMore] = useState<ChunkOut[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);

  if (first.error !== undefined) return <QueryError error={first.error} onRetry={first.refresh} />;
  if (!first.data) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  const items = [...first.data.items, ...more];
  const total = first.data.total;

  async function loadMore() {
    setLoadingMore(true);
    try {
      const page = await getDocumentChunks(documentId, { offset: items.length, limit: PAGE, q: query || undefined });
      setMore((m) => [...m, ...page.items]);
    } catch (err) {
      notifyError(err);
    } finally {
      setLoadingMore(false);
    }
  }

  if (items.length === 0) {
    return (
      <EmptyState
        compact
        title={query ? "No chunks match your search" : "No chunks yet"}
        description={query ? "Try a different term." : "Chunks appear once the document has been indexed."}
      />
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground tabular">
        Showing {items.length} of {formatNumber(total)} chunk{total === 1 ? "" : "s"}
      </p>
      {items.map((c) => (
        <ChunkCard key={c.id} chunk={c} />
      ))}
      {items.length < total && (
        <Button variant="outline" size="sm" className="w-full" onClick={loadMore} disabled={loadingMore}>
          {loadingMore && <Loader2 className="animate-spin" />} Load more
        </Button>
      )}
    </div>
  );
}

function Details({ doc }: { doc: DocumentDetail }) {
  const rows: Array<[string, string]> = [
    ["File name", doc.filename],
    ["Type", `${doc.file_ext.replace(/^\./, "").toUpperCase()} · ${doc.mime_type}`],
    ["Size", formatBytes(doc.size_bytes)],
    ["Pages", formatNumber(doc.page_count)],
    ["Chunks", formatNumber(doc.chunk_count)],
    ["Current version", `v${doc.current_version}`],
    ["Collection", doc.collection_name ?? "—"],
    ["Uploaded", formatDateTime(doc.created_at)],
    ["Updated", formatDateTime(doc.updated_at)],
    ["Indexed", formatDateTime(doc.indexed_at)],
    ["SHA-256", doc.sha256],
  ];
  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-1 gap-x-4 gap-y-2 text-[13px] sm:grid-cols-2">
        {rows.map(([k, v]) => (
          <div key={k} className="min-w-0">
            <dt className="text-[11px] text-muted-foreground">{k}</dt>
            <dd className="truncate font-medium" title={v}>
              {v}
            </dd>
          </div>
        ))}
      </dl>
      {doc.error_message && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-[13px] text-red-700 ring-1 ring-red-200/70 ring-inset">{doc.error_message}</p>
      )}
      {doc.versions.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs font-medium text-muted-foreground">Versions</p>
          <ul className="divide-y rounded-lg border text-[12.5px]">
            {doc.versions.map((v) => (
              <li key={v.version} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-2">
                <span className="font-semibold">v{v.version}</span>
                <span className="min-w-0 flex-1 truncate">{v.original_filename}</span>
                <span className="text-muted-foreground">{formatBytes(v.size_bytes)}</span>
                <span className="text-muted-foreground">{formatDateTime(v.created_at)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {Object.keys(doc.metadata ?? {}).length > 0 && (
        <div>
          <p className="mb-1.5 text-xs font-medium text-muted-foreground">Extracted metadata</p>
          <JsonView value={doc.metadata} maxHeight="16rem" />
        </div>
      )}
    </div>
  );
}

export function DocumentPreviewSheet({
  documentId,
  onOpenChange,
}: {
  documentId: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const open = documentId !== null;
  const detail = useApiQuery(documentId ? `doc:${documentId}` : null, (signal) => getDocument(documentId as string, signal));
  const [query, setQuery] = useState("");
  const [prevId, setPrevId] = useState(documentId);
  if (prevId !== documentId) {
    setPrevId(documentId);
    setQuery("");
  }
  const debounced = useDebouncedValue(query.trim(), 300);
  const doc = detail.data;
  const isPdf = doc ? doc.file_ext.replace(/^\./, "").toLowerCase() === "pdf" || doc.mime_type === "application/pdf" : false;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-2xl">
        <SheetHeader className="border-b px-5 py-4 pr-12">
          <SheetTitle className="truncate">{doc?.title ?? "Document preview"}</SheetTitle>
          <SheetDescription asChild>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {doc && <DocumentStatusBadge status={doc.status} />}
              {doc && <span className="truncate">{doc.filename}</span>}
            </div>
          </SheetDescription>
        </SheetHeader>
        {detail.error !== undefined && (
          <div className="p-5">
            <QueryError error={detail.error} onRetry={detail.refresh} />
          </div>
        )}
        {!doc && detail.error === undefined && (
          <div className="space-y-3 p-5">
            <Skeleton className="h-8 w-1/2" />
            <Skeleton className="h-40 w-full" />
          </div>
        )}
        {doc && documentId && (
          <Tabs defaultValue="chunks" className="min-h-0 flex-1 gap-0">
            <div className="flex items-center justify-between gap-2 border-b px-5 py-2">
              <TabsList>
                <TabsTrigger value="chunks">Chunks</TabsTrigger>
                <TabsTrigger value="original">Original</TabsTrigger>
                <TabsTrigger value="details">Details</TabsTrigger>
              </TabsList>
              <Button asChild size="sm" variant="ghost">
                <a href={documentFileUrl(documentId)} target="_blank" rel="noopener noreferrer">
                  <ExternalLink /> Open file
                </a>
              </Button>
            </div>
            <TabsContent value="chunks" className="min-h-0 flex-1 overflow-y-auto px-5 py-4 scrollbar-thin">
              <div className="relative mb-3">
                <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search within this document's chunks"
                  className="h-8 pl-8 text-[13px]"
                  aria-label="Search chunks"
                />
              </div>
              <ChunkBrowser key={`${documentId}:${debounced}`} documentId={documentId} query={debounced} />
            </TabsContent>
            <TabsContent value="original" className="min-h-0 flex-1 overflow-hidden p-0">
              {isPdf ? (
                <iframe
                  src={documentFileUrl(documentId)}
                  title={`Original file: ${doc.filename}`}
                  className="h-full min-h-[70dvh] w-full border-0"
                />
              ) : (
                <div className="p-5">
                  <EmptyState
                    title="Inline preview is available for PDFs"
                    description="Open the original file in a new tab to view it."
                    action={
                      <Button asChild size="sm" variant="outline">
                        <a href={documentFileUrl(documentId)} target="_blank" rel="noopener noreferrer">
                          <ExternalLink /> Open original
                        </a>
                      </Button>
                    }
                  />
                </div>
              )}
            </TabsContent>
            <TabsContent value="details" className="min-h-0 flex-1 overflow-y-auto px-5 py-4 scrollbar-thin">
              <Details doc={doc} />
            </TabsContent>
          </Tabs>
        )}
      </SheetContent>
    </Sheet>
  );
}
