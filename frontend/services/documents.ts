import { apiFetch, buildUrl } from "@/services/http";
import type {
  ChunkPage,
  Classification,
  DocumentDetail,
  DocumentListParams,
  DocumentOut,
  DocumentUpdate,
  OkResponse,
  UploadResult,
} from "@/lib/types";

const base = (id: string) => `/api/documents/${encodeURIComponent(id)}`;

export function listDocuments(params: DocumentListParams = {}, signal?: AbortSignal): Promise<DocumentOut[]> {
  return apiFetch<DocumentOut[]>("/api/documents", {
    query: { q: params.q, status: params.status, collection_id: params.collection_id },
    signal,
  });
}

export function getDocument(id: string, signal?: AbortSignal): Promise<DocumentDetail> {
  return apiFetch<DocumentDetail>(base(id), { signal });
}

/**
 * Multipart upload: one `files` field per file plus optional `collection_id` and `classification`
 * fields (the workspace default classification applies when omitted). Requires documents.manage.
 */
export function uploadDocuments(
  files: File[],
  collectionId?: string | null,
  classification?: Classification | null,
): Promise<UploadResult> {
  const form = new FormData();
  for (const f of files) form.append("files", f, f.name);
  if (collectionId) form.append("collection_id", collectionId);
  if (classification) form.append("classification", classification);
  return apiFetch<UploadResult>("/api/documents/upload", { method: "POST", body: form });
}

export function updateDocument(id: string, body: DocumentUpdate): Promise<DocumentOut> {
  return apiFetch<DocumentOut>(base(id), { method: "PATCH", json: body });
}

export function deleteDocument(id: string): Promise<OkResponse> {
  return apiFetch<OkResponse>(base(id), { method: "DELETE" });
}

export function reindexDocument(id: string): Promise<DocumentOut> {
  return apiFetch<DocumentOut>(`${base(id)}/reindex`, { method: "POST" });
}

export function uploadDocumentVersion(id: string, file: File): Promise<DocumentOut> {
  const form = new FormData();
  form.append("file", file, file.name);
  return apiFetch<DocumentOut>(`${base(id)}/versions`, { method: "POST", body: form });
}

export function getDocumentChunks(
  id: string,
  params: { offset?: number; limit?: number; q?: string } = {},
  signal?: AbortSignal,
): Promise<ChunkPage> {
  return apiFetch<ChunkPage>(`${base(id)}/chunks`, {
    query: { offset: params.offset ?? 0, limit: params.limit ?? 20, q: params.q },
    signal,
  });
}

/** Direct URL of the original file (new tab / iframe); the session cookie authenticates it. */
export function documentFileUrl(id: string): string {
  return buildUrl(`${base(id)}/file`);
}
