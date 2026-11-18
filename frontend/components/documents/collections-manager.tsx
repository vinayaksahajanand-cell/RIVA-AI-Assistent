"use client";

import { FolderClosed, FolderPlus, Loader2, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { notifyError } from "@/lib/notify";
import type { CollectionOut } from "@/lib/types";
import { cn } from "@/lib/utils";
import { createCollection, deleteCollection } from "@/services/collections";

/** Sidebar card listing collections with create / delete and click-to-filter. */
export function CollectionsManager({
  collections,
  loading,
  activeId,
  onSelect,
  onChanged,
}: {
  collections: readonly CollectionOut[] | undefined;
  loading: boolean;
  activeId: string | null;
  onSelect: (id: string | null) => void;
  onChanged: () => void;
}) {
  const [createOpen, setCreateOpen] = useState(false);
  const [deleting, setDeleting] = useState<CollectionOut | null>(null);

  return (
    <section className="rounded-xl border bg-background" aria-labelledby="collections-heading">
      <div className="flex items-center justify-between border-b px-3 py-2.5">
        <h2 id="collections-heading" className="text-[13px] font-semibold">
          Collections
        </h2>
        <Button size="xs" variant="outline" onClick={() => setCreateOpen(true)}>
          <FolderPlus /> New
        </Button>
      </div>
      <div className="p-1.5">
        {loading && !collections && (
          <div className="space-y-1.5 p-1.5">
            <Skeleton className="h-7 w-full" />
            <Skeleton className="h-7 w-3/4" />
          </div>
        )}
        <ul className="space-y-0.5">
          <li>
            <button
              type="button"
              onClick={() => onSelect(null)}
              aria-pressed={activeId === null}
              className={cn(
                "flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring",
                activeId === null && "bg-accent font-medium text-accent-foreground",
              )}
            >
              All documents
            </button>
          </li>
          {collections?.map((c) => (
            <li key={c.id} className="group/col relative">
              <button
                type="button"
                onClick={() => onSelect(c.id)}
                aria-pressed={activeId === c.id}
                title={c.description || c.name}
                className={cn(
                  "flex h-8 w-full items-center gap-2 rounded-md pr-8 pl-2 text-left text-[13px] outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring",
                  activeId === c.id && "bg-accent font-medium text-accent-foreground",
                )}
              >
                <FolderClosed className="size-3.5 shrink-0 opacity-60" aria-hidden />
                <span className="min-w-0 flex-1 truncate">{c.name}</span>
                <span className="text-[11px] text-muted-foreground tabular group-hover/col:hidden group-focus-within/col:hidden">
                  {c.document_count}
                </span>
              </button>
              <Button
                variant="ghost"
                size="icon-xs"
                className="absolute top-1/2 right-1 -translate-y-1/2 text-muted-foreground opacity-0 group-hover/col:opacity-100 focus-visible:opacity-100"
                onClick={() => setDeleting(c)}
                aria-label={`Delete collection ${c.name}`}
              >
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
        {collections && collections.length === 0 && (
          <p className="px-2 py-2 text-xs text-muted-foreground">Group related documents into collections to scope questions.</p>
        )}
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          {createOpen && (
            <CreateCollectionForm
              onCancel={() => setCreateOpen(false)}
              onCreated={(c) => {
                setCreateOpen(false);
                toast.success(`Collection “${c.name}” created`);
                onChanged();
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete collection?"
        description={`“${deleting?.name ?? ""}” will be deleted. Documents in it stay in your library without a collection.`}
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          if (!deleting) return;
          try {
            await deleteCollection(deleting.id);
            toast.success("Collection deleted");
            if (activeId === deleting.id) onSelect(null);
            onChanged();
          } catch (err) {
            notifyError(err);
          }
        }}
      />
    </section>
  );
}

function CreateCollectionForm({ onCancel, onCreated }: { onCancel: () => void; onCreated: (c: CollectionOut) => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      const c = await createCollection({ name: name.trim(), description: description.trim() });
      onCreated(c);
    } catch (err) {
      notifyError(err);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>New collection</DialogTitle>
        <DialogDescription>Collections group documents so you can scope questions to them.</DialogDescription>
      </DialogHeader>
      <div className="grid gap-1.5">
        <Label htmlFor="collection-name">Name</Label>
        <Input id="collection-name" value={name} maxLength={200} onChange={(e) => setName(e.target.value)} autoFocus required />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="collection-description">Description (optional)</Label>
        <Textarea
          id="collection-description"
          value={description}
          maxLength={2000}
          rows={3}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" disabled={!name.trim() || busy}>
          {busy && <Loader2 className="animate-spin" />} Create
        </Button>
      </DialogFooter>
    </form>
  );
}
