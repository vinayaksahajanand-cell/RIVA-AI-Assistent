"use client";

import { ChevronDown, FileText, FolderClosed, Layers, Loader2, ShieldCheck } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { EMPTY_SCOPE, isScopeEmpty, type ChatScope } from "@/lib/chat";
import type { CollectionOut, DocumentOut } from "@/lib/types";
import { truncate } from "@/lib/format";

export function scopeLabel(scope: ChatScope, documents: readonly DocumentOut[], collections: readonly CollectionOut[]): string {
  if (isScopeEmpty(scope)) return "All documents";
  const collection = scope.collectionId ? collections.find((c) => c.id === scope.collectionId) : null;
  const docCount = scope.documentIds.length;
  const docLabel =
    docCount === 1
      ? truncate(documents.find((d) => d.id === scope.documentIds[0])?.title ?? "1 document", 28)
      : `${docCount} documents`;
  if (collection && docCount > 0) return `${truncate(collection.name, 18)} + ${docLabel}`;
  if (scope.collectionId) return collection ? truncate(collection.name, 28) : "1 collection";
  return docLabel;
}

/** Choose what the next question searches: all indexed docs (default), a collection and/or specific documents. */
export function ScopePicker({
  scope,
  onChange,
  documents,
  collections,
  loading,
  onOpen,
  disabled,
  accessNote,
}: {
  scope: ChatScope;
  onChange: (scope: ChatScope) => void;
  documents: readonly DocumentOut[];
  collections: readonly CollectionOut[];
  loading: boolean;
  onOpen?: () => void;
  disabled?: boolean;
  /** Clearance hint, e.g. "You can access: public, internal documents". */
  accessNote?: string;
}) {
  const [open, setOpen] = useState(false);

  const toggleDoc = (id: string) => {
    const has = scope.documentIds.includes(id);
    onChange({
      ...scope,
      documentIds: has ? scope.documentIds.filter((d) => d !== id) : [...scope.documentIds, id],
    });
  };
  const toggleCollection = (id: string) =>
    onChange({ ...scope, collectionId: scope.collectionId === id ? null : id });

  const label = scopeLabel(scope, documents, collections);

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) onOpen?.();
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled}
          className="h-8 max-w-[220px] gap-1.5 rounded-lg px-2 text-[12.5px] text-muted-foreground hover:text-foreground"
          aria-label={`Document scope: ${label}`}
        >
          <Layers className="size-3.5" aria-hidden />
          <span className="truncate">{label}</span>
          <ChevronDown className="size-3.5 opacity-60" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" side="top" className="w-[min(360px,calc(100vw-2rem))] gap-0 p-0">
        <Command>
          <CommandInput placeholder="Search documents and collections…" />
          <CommandList className="max-h-80">
            <CommandEmpty>{loading ? "Loading documents…" : "No matching documents."}</CommandEmpty>
            <CommandGroup heading="Scope">
              <CommandItem value="__all__ all indexed documents" data-checked={isScopeEmpty(scope)} onSelect={() => onChange(EMPTY_SCOPE)}>
                <Layers className="text-muted-foreground" />
                All indexed documents
              </CommandItem>
            </CommandGroup>
            {collections.length > 0 && (
              <>
                <CommandSeparator />
                <CommandGroup heading="Collection">
                  {collections.map((c) => (
                    <CommandItem
                      key={c.id}
                      value={`collection ${c.name} ${c.id}`}
                      data-checked={scope.collectionId === c.id}
                      onSelect={() => toggleCollection(c.id)}
                    >
                      <FolderClosed className="text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate">{c.name}</span>
                      <span className="text-[11px] text-muted-foreground tabular">{c.document_count}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
            <CommandSeparator />
            <CommandGroup heading="Documents">
              {loading && documents.length === 0 && (
                <div className="flex items-center gap-2 px-2 py-2 text-xs text-muted-foreground">
                  <Loader2 className="size-3.5 animate-spin" /> Loading…
                </div>
              )}
              {!loading && documents.length === 0 && (
                <p className="px-2 py-2 text-xs text-muted-foreground">No documents available yet.</p>
              )}
              {documents.map((d) => {
                const selected = scope.documentIds.includes(d.id);
                const indexed = d.status === "indexed";
                return (
                  <CommandItem
                    key={d.id}
                    value={`${d.title} ${d.filename} ${d.id}`}
                    data-checked={selected}
                    disabled={!indexed && !selected}
                    onSelect={() => toggleDoc(d.id)}
                  >
                    <FileText className="text-muted-foreground" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{d.title || d.filename}</span>
                      {!indexed && <span className="block text-[11px] text-muted-foreground capitalize">{d.status}</span>}
                    </span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
          {accessNote && (
            <p className="flex items-center gap-1.5 border-t bg-accent/40 px-3 py-1.5 text-[11.5px] text-accent-foreground">
              <ShieldCheck className="size-3.5 shrink-0" aria-hidden />
              {accessNote}
            </p>
          )}
          <div className="flex items-center justify-between border-t px-3 py-2 text-[11.5px] text-muted-foreground">
            <span>
              {isScopeEmpty(scope)
                ? "Searching all indexed documents"
                : `${scope.documentIds.length} document${scope.documentIds.length === 1 ? "" : "s"}${scope.collectionId ? " + 1 collection" : ""}`}
            </span>
            {!isScopeEmpty(scope) && (
              <button
                type="button"
                className="rounded px-1 font-medium text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => onChange(EMPTY_SCOPE)}
              >
                Reset
              </button>
            )}
          </div>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
