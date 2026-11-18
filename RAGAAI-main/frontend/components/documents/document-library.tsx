"use client";

import { FolderOpen, Search, X } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { EmptyState } from "@/components/common/empty-state";
import { PageContainer, PageHeader } from "@/components/common/page-header";
import { QueryError } from "@/components/common/query-error";
import { CollectionsManager } from "@/components/documents/collections-manager";
import { DocumentPreviewSheet } from "@/components/documents/document-preview-sheet";
import { DOCUMENT_STATUS_OPTIONS } from "@/components/documents/document-status";
import { DocumentsTable, type DocumentActions } from "@/components/documents/documents-table";
import { UploadResults, type UploadOutcome } from "@/components/documents/upload-results";
import { UploadZone } from "@/components/documents/upload-zone";
import { ClassificationBadge } from "@/components/access/access-badges";
import { RenameDialog } from "@/components/layout/rename-dialog";
import { useSession } from "@/components/providers/session-provider";
import { useSystemInfo } from "@/components/providers/system-provider";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useApiQuery } from "@/hooks/use-api-query";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { DOCUMENT_POLL_MS, IN_PROGRESS_DOCUMENT_STATUSES } from "@/lib/config";
import { notifyError } from "@/lib/notify";
import { accessibleClassifications, formatClassificationList } from "@/lib/permissions";
import type { Classification, DocumentOut } from "@/lib/types";
import { validateFiles } from "@/lib/uploads";
import { listCollections } from "@/services/collections";
import {
  deleteDocument,
  listDocuments,
  reindexDocument,
  updateDocument,
  uploadDocuments,
  uploadDocumentVersion,
} from "@/services/documents";

const ALL = "__all__";

/** Admin portal document management (requires documents.manage). */
export function DocumentLibrary() {
  const { system } = useSystemInfo();
  const { access, can } = useSession();
  const allowed = accessibleClassifications(access);
  const [classFilter, setClassFilter] = useState<string>(ALL);
  const [uploadClassification, setUploadClassification] = useState<Classification | null>(null);
  const [query, setQuery] = useState("");
  const q = useDebouncedValue(query.trim(), 300);
  const [status, setStatus] = useState<string>(ALL);
  const [collectionId, setCollectionId] = useState<string | null>(null);

  const docs = useApiQuery(
    `documents:${q}:${status}:${collectionId ?? ""}`,
    (signal) =>
      listDocuments({ q: q || undefined, status: status === ALL ? undefined : status, collection_id: collectionId ?? undefined }, signal),
    {
      keepPreviousData: true,
      refetchInterval: (data) => (data?.some((d) => IN_PROGRESS_DOCUMENT_STATUSES.has(d.status)) ? DOCUMENT_POLL_MS : false),
    },
  );
  const cols = useApiQuery("collections", (signal) => listCollections(signal));
  const collections = cols.data ?? [];

  const [uploading, setUploading] = useState(false);
  const [uploadTarget, setUploadTarget] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<UploadOutcome | null>(null);

  const [previewId, setPreviewId] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<DocumentOut | null>(null);
  const [deleting, setDeleting] = useState<DocumentOut | null>(null);
  const versionInput = useRef<HTMLInputElement>(null);
  const [versionTarget, setVersionTarget] = useState<DocumentOut | null>(null);

  const replaceDoc = (updated: DocumentOut) =>
    docs.mutate((prev) => prev?.map((d) => (d.id === updated.id ? { ...d, ...updated } : d)));

  async function handleFiles(files: File[]) {
    const { accepted, rejected } = validateFiles(files, {
      maxUploadMb: system?.max_upload_mb,
      supportedExtensions: system?.supported_extensions,
    });
    const localRejected = rejected.map((r) => ({ filename: r.file.name, reason: r.reason }));
    if (accepted.length === 0) {
      setOutcome({ uploaded: [], duplicates: [], rejected: localRejected });
      return;
    }
    setUploading(true);
    try {
      const res = await uploadDocuments(accepted, uploadTarget, uploadClassification);
      setOutcome({
        uploaded: res.uploaded.map((d) => d.filename),
        duplicates: res.duplicates,
        rejected: [...localRejected, ...res.rejected],
      });
      if (res.uploaded.length > 0) toast.success(`${res.uploaded.length} document${res.uploaded.length === 1 ? "" : "s"} uploaded`);
      docs.refresh();
      cols.refresh();
    } catch (err) {
      notifyError(err);
      if (localRejected.length) setOutcome({ uploaded: [], duplicates: [], rejected: localRejected });
    } finally {
      setUploading(false);
    }
  }

  const actions: DocumentActions = {
    onPreview: (d) => setPreviewId(d.id),
    onReindex: async (d) => {
      try {
        replaceDoc(await reindexDocument(d.id));
        toast.success(`Re-indexing “${d.title}”`);
        docs.refresh();
      } catch (err) {
        notifyError(err);
      }
    },
    onNewVersion: (d) => {
      setVersionTarget(d);
      versionInput.current?.click();
    },
    onRename: (d) => setRenaming(d),
    onDelete: (d) => setDeleting(d),
    onClassify: async (d, classification) => {
      try {
        replaceDoc(await updateDocument(d.id, { classification }));
        toast.success(`“${d.title}” is now ${classification}`);
      } catch (err) {
        notifyError(err);
      }
    },
    onAssignCollection: async (d, id) => {
      try {
        const updated = await updateDocument(d.id, id ? { collection_id: id } : { clear_collection: true });
        replaceDoc(updated);
        toast.success(id ? "Moved to collection" : "Removed from collection");
        cols.refresh();
        if (collectionId && id !== collectionId) docs.refresh();
      } catch (err) {
        notifyError(err);
      }
    },
  };

  const list = docs.data && classFilter !== ALL ? docs.data.filter((d) => d.classification === classFilter) : docs.data;
  const filtered = Boolean(q) || status !== ALL || collectionId !== null || classFilter !== ALL;

  return (
    <PageContainer>
      <PageHeader
        title="Document Library"
        description={`Upload, classify, organize and monitor the documents RIVA AI searches. You can see and assign ${formatClassificationList(allowed)} documents.`}
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div className="min-w-0 space-y-4">
          <UploadZone
            onFiles={(f) => void handleFiles(f)}
            uploading={uploading}
            supportedExtensions={system?.supported_extensions}
            maxUploadMb={system?.max_upload_mb}
            collections={collections}
            targetCollectionId={uploadTarget}
            onTargetCollectionChange={setUploadTarget}
            classifications={allowed}
            classification={uploadClassification}
            onClassificationChange={setUploadClassification}
          />
          {outcome && <UploadResults outcome={outcome} onDismiss={() => setOutcome(null)} />}

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
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="h-9 w-full sm:w-40" aria-label="Filter by status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All statuses</SelectItem>
                {DOCUMENT_STATUS_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={classFilter} onValueChange={setClassFilter}>
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
              icon={FolderOpen}
              title={filtered ? "No documents match these filters" : "Your library is empty"}
              description={
                filtered
                  ? "Adjust the search, status, classification or collection filters."
                  : "Upload PDFs and other documents above. RIVA AI indexes them for hybrid search and cited answers."
              }
            />
          )}
          {list && list.length > 0 && (
            <DocumentsTable
              documents={list}
              collections={collections}
              actions={actions}
              capabilities={{
                preview: can("documents.read_content"),
                download: can("documents.download"),
                classifications: allowed,
              }}
            />
          )}
        </div>

        <aside className="space-y-4">
          <CollectionsManager
            collections={cols.data}
            loading={cols.isLoading}
            activeId={collectionId}
            onSelect={setCollectionId}
            onChanged={() => {
              cols.refresh();
              docs.refresh();
            }}
          />
          {list && list.length > 0 && (
            <div className="rounded-xl border bg-background p-3 text-[13px]">
              <p className="mb-2 font-semibold">In this view</p>
              <dl className="grid grid-cols-2 gap-2">
                {[
                  ["Documents", list.length],
                  ["Indexed", list.filter((d) => d.status === "indexed").length],
                  ["In progress", list.filter((d) => IN_PROGRESS_DOCUMENT_STATUSES.has(d.status)).length],
                  ["Failed", list.filter((d) => d.status === "failed").length],
                ].map(([k, v]) => (
                  <div key={k} className="rounded-lg bg-muted/40 px-2.5 py-1.5">
                    <dt className="text-[11px] text-muted-foreground">{k}</dt>
                    <dd className="font-semibold tabular">{v}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </aside>
      </div>

      <input
        ref={versionInput}
        type="file"
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          const target = versionTarget;
          setVersionTarget(null);
          if (!file || !target) return;
          const { rejected } = validateFiles([file], {
            maxUploadMb: system?.max_upload_mb,
            supportedExtensions: system?.supported_extensions,
          });
          if (rejected.length) {
            toast.error(`${file.name}: ${rejected[0].reason}`);
            return;
          }
          const id = toast.loading(`Uploading new version of “${target.title}”…`);
          try {
            replaceDoc(await uploadDocumentVersion(target.id, file));
            toast.success("New version uploaded — re-indexing", { id });
            docs.refresh();
          } catch (err) {
            toast.dismiss(id);
            notifyError(err);
          }
        }}
      />

      <DocumentPreviewSheet documentId={previewId} onOpenChange={(o) => !o && setPreviewId(null)} />

      <RenameDialog
        open={renaming !== null}
        onOpenChange={(o) => !o && setRenaming(null)}
        initialTitle={renaming?.title ?? ""}
        title="Rename document"
        maxLength={512}
        onSubmit={async (title) => {
          if (!renaming) return;
          try {
            replaceDoc(await updateDocument(renaming.id, { title }));
            toast.success("Document renamed");
          } catch (err) {
            notifyError(err);
            throw err;
          }
        }}
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete document?"
        description={`“${deleting?.title ?? ""}”, all its versions and indexed chunks will be permanently deleted. Past answers keep their citations text but links to this document will stop working.`}
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          if (!deleting) return;
          try {
            await deleteDocument(deleting.id);
            docs.mutate((prev) => prev?.filter((d) => d.id !== deleting.id));
            toast.success("Document deleted");
            cols.refresh();
          } catch (err) {
            notifyError(err);
          }
        }}
      />
    </PageContainer>
  );
}
