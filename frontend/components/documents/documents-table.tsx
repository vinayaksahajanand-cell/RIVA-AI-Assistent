"use client";

import { Eye, ExternalLink, FileText, FileUp, MoreHorizontal, Pencil, RefreshCcw, Trash2 } from "lucide-react";

import { ClassificationBadge } from "@/components/access/access-badges";
import { DocumentStatusCell } from "@/components/documents/document-status";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { IN_PROGRESS_DOCUMENT_STATUSES } from "@/lib/config";
import { formatBytes, formatDate, formatDateTime, formatNumber } from "@/lib/format";
import type { Classification, CollectionOut, DocumentOut } from "@/lib/types";
import { documentFileUrl } from "@/services/documents";

const NONE = "__none__";

export interface DocumentActions {
  onPreview: (doc: DocumentOut) => void;
  onReindex: (doc: DocumentOut) => void;
  onNewVersion: (doc: DocumentOut) => void;
  onRename: (doc: DocumentOut) => void;
  onDelete: (doc: DocumentOut) => void;
  onAssignCollection: (doc: DocumentOut, collectionId: string | null) => void;
  onClassify: (doc: DocumentOut, classification: Classification) => void;
}

export interface DocumentCapabilities {
  /** documents.read_content: chunk preview. */
  preview: boolean;
  /** documents.download: open the original file. */
  download: boolean;
  /** Classifications the caller may assign (at or below their clearance). */
  classifications: readonly Classification[];
}

export function DocumentsTable({
  documents,
  collections,
  actions,
  capabilities,
}: {
  documents: readonly DocumentOut[];
  collections: readonly CollectionOut[];
  actions: DocumentActions;
  capabilities: DocumentCapabilities;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border bg-background scrollbar-thin">
      <Table className="min-w-[900px]">
        <TableHeader>
          <TableRow className="bg-muted/40 hover:bg-muted/40">
            <TableHead className="pl-4">Document</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Classification</TableHead>
            <TableHead>Collection</TableHead>
            <TableHead className="text-right">Size</TableHead>
            <TableHead className="text-right">Pages</TableHead>
            <TableHead className="text-right">Chunks</TableHead>
            <TableHead>Uploaded</TableHead>
            <TableHead className="w-12 pr-4">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {documents.map((d) => {
            const busy = IN_PROGRESS_DOCUMENT_STATUSES.has(d.status);
            return (
              <TableRow key={d.id} className="align-top">
                <TableCell className="max-w-[320px] pl-4">
                  <button
                    type="button"
                    onClick={() => capabilities.preview && actions.onPreview(d)}
                    disabled={!capabilities.preview}
                    className="group flex max-w-full items-start gap-2.5 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
                  >
                    <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                      <FileText className="size-4" aria-hidden />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate font-medium group-hover:text-primary" title={d.title}>
                        {d.title || d.filename}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground" title={d.filename}>
                        {d.filename} · {d.file_ext.replace(/^\./, "").toUpperCase()}
                        {d.current_version > 1 && ` · v${d.current_version}`}
                      </span>
                    </span>
                  </button>
                </TableCell>
                <TableCell>
                  <DocumentStatusCell doc={d} />
                </TableCell>
                <TableCell>
                  {capabilities.classifications.includes(d.classification as Classification) ? (
                    <Select
                      value={d.classification}
                      onValueChange={(v) => v !== d.classification && actions.onClassify(d, v as Classification)}
                    >
                      <SelectTrigger size="sm" className="h-7 w-36 text-xs" aria-label={`Classification for ${d.title}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {capabilities.classifications.map((c) => (
                          <SelectItem key={c} value={c}>
                            <ClassificationBadge value={c} />
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <ClassificationBadge value={d.classification} />
                  )}
                </TableCell>
                <TableCell>
                  <Select
                    value={d.collection_id ?? NONE}
                    onValueChange={(v) => actions.onAssignCollection(d, v === NONE ? null : v)}
                  >
                    <SelectTrigger size="sm" className="h-7 w-40 text-xs" aria-label={`Collection for ${d.title}`}>
                      <SelectValue placeholder="No collection" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>No collection</SelectItem>
                      {collections.length > 0 && <SelectSeparator />}
                      {collections.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                        </SelectItem>
                      ))}
                      {d.collection_id && !collections.some((c) => c.id === d.collection_id) && (
                        <SelectItem value={d.collection_id}>{d.collection_name ?? "Unknown collection"}</SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell className="text-right tabular">{formatBytes(d.size_bytes)}</TableCell>
                <TableCell className="text-right tabular">{formatNumber(d.page_count)}</TableCell>
                <TableCell className="text-right tabular">{formatNumber(d.chunk_count)}</TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground" title={formatDateTime(d.created_at)}>
                  {formatDate(d.created_at)}
                </TableCell>
                <TableCell className="pr-4">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${d.title}`}>
                        <MoreHorizontal />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-52">
                      {capabilities.preview && (
                        <DropdownMenuItem onSelect={() => actions.onPreview(d)}>
                          <Eye /> Preview chunks
                        </DropdownMenuItem>
                      )}
                      {capabilities.download && (
                        <DropdownMenuItem asChild>
                          <a href={documentFileUrl(d.id)} target="_blank" rel="noopener noreferrer">
                            <ExternalLink /> Open original file
                          </a>
                        </DropdownMenuItem>
                      )}
                      {(capabilities.preview || capabilities.download) && <DropdownMenuSeparator />}
                      <DropdownMenuItem onSelect={() => actions.onRename(d)}>
                        <Pencil /> Rename
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => actions.onReindex(d)} disabled={busy}>
                        <RefreshCcw /> Re-index
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => actions.onNewVersion(d)} disabled={busy}>
                        <FileUp /> Upload new version
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem variant="destructive" onSelect={() => actions.onDelete(d)}>
                        <Trash2 /> Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
