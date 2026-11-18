"use client";

import { FileText, Library, Search, X } from "lucide-react";
import { useState } from "react";

import { ClassificationBadge } from "@/components/access/access-badges";
import { EmptyState } from "@/components/common/empty-state";
import { PageContainer, PageHeader } from "@/components/common/page-header";
import { QueryError } from "@/components/common/query-error";
import { useSession } from "@/components/providers/session-provider";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useApiQuery } from "@/hooks/use-api-query";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { formatDate, formatDateTime } from "@/lib/format";
import { accessibleClassifications, formatClassificationList } from "@/lib/permissions";
import { listCollections } from "@/services/collections";
import { listDocuments } from "@/services/documents";

const ALL = "__all__";

/**
 * /library — read-only list of the indexed documents this account can ask about. The backend only
 * returns documents within the caller's clearance; no preview, download or upload here.
 */
export function LibraryView() {
  const { access } = useSession();
  const allowed = accessibleClassifications(access);
  const [query, setQuery] = useState("");
  const q = useDebouncedValue(query.trim(), 300);
  const [collectionId, setCollectionId] = useState<string | null>(null);
  const [classification, setClassification] = useState<string>(ALL);

  const docs = useApiQuery(
    `library:${q}:${collectionId ?? ""}`,
    (signal) => listDocuments({ q: q || undefined, status: "indexed", collection_id: collectionId ?? undefined }, signal),
    { keepPreviousData: true },
  );
  const cols = useApiQuery("library:collections", (signal) => listCollections(signal));
  const collections = cols.data ?? [];
  const list = docs.data && classification !== ALL ? docs.data.filter((d) => d.classification === classification) : docs.data;
  const filtered = Boolean(q) || collectionId !== null || classification !== ALL;

  return (
    <PageContainer>
      <PageHeader
        title="Library"
        description={
          <>
            The documents RIVA AI can use to answer you. Your clearance lets you access{" "}
            <span className="font-medium text-foreground">{formatClassificationList(allowed)}</span> documents.
          </>
        }
      />

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search documents by title or file name"
            className="h-9 pr-8 pl-8"
            aria-label="Search documents"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="absolute top-1/2 right-2 flex size-5 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              aria-label="Clear search"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
        <Select value={classification} onValueChange={setClassification}>
          <SelectTrigger className="h-9 w-full sm:w-44" aria-label="Filter by classification">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All classifications</SelectItem>
            {allowed.map((c) => (
              <SelectItem key={c} value={c}>
                <ClassificationBadge value={c} />
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {collections.length > 0 && (
          <Select value={collectionId ?? ALL} onValueChange={(v) => setCollectionId(v === ALL ? null : v)}>
            <SelectTrigger className="h-9 w-full sm:w-44" aria-label="Filter by collection">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All collections</SelectItem>
              {collections.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {docs.error !== undefined && !list && <QueryError error={docs.error} onRetry={docs.refresh} />}
      {!list && docs.error === undefined && (
        <div className="space-y-2 rounded-xl border p-4" aria-busy="true">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      )}
      {list && list.length === 0 && (
        <EmptyState
          icon={Library}
          title={filtered ? "No documents match these filters" : "No documents available yet"}
          description={
            filtered
              ? "Adjust the search, classification or collection filters."
              : "Documents your workspace admins add (within your clearance) will appear here."
          }
        />
      )}
      {list && list.length > 0 && (
        <div className="overflow-x-auto rounded-xl border bg-background scrollbar-thin">
          <Table className="min-w-[620px]">
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="pl-4">Document</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Classification</TableHead>
                <TableHead>Collection</TableHead>
                <TableHead className="pr-4">Indexed</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.map((d) => (
                <TableRow key={d.id}>
                  <TableCell className="max-w-[360px] pl-4">
                    <div className="flex items-center gap-2.5">
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                        <FileText className="size-4" aria-hidden />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate font-medium" title={d.title}>
                          {d.title || d.filename}
                        </span>
                        {d.page_count !== null && (
                          <span className="block text-xs text-muted-foreground">
                            {d.page_count} page{d.page_count === 1 ? "" : "s"}
                          </span>
                        )}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{d.file_ext.replace(/^\./, "").toUpperCase()}</TableCell>
                  <TableCell>
                    <ClassificationBadge value={d.classification} />
                  </TableCell>
                  <TableCell className="max-w-[180px] truncate text-muted-foreground">{d.collection_name ?? "—"}</TableCell>
                  <TableCell className="pr-4 whitespace-nowrap text-muted-foreground" title={formatDateTime(d.indexed_at)}>
                    {d.indexed_at ? formatDate(d.indexed_at) : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </PageContainer>
  );
}
