"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { DOCUMENT_POLL_MS } from "@/lib/config";
import { notifyError } from "@/lib/notify";
import type { SystemInfo } from "@/lib/types";
import { validateFiles } from "@/lib/uploads";
import { getDocument, uploadDocuments } from "@/services/documents";
import { errorMessage } from "@/services/http";

export type AttachmentState = "uploading" | "processing" | "indexed" | "failed" | "duplicate" | "rejected";

export interface Attachment {
  key: string;
  name: string;
  size: number;
  state: AttachmentState;
  documentId: string | null;
  progress: number | null;
  stage: string | null;
  message: string | null;
}

let seq = 0;
const key = () => `att-${Date.now().toString(36)}-${(seq++).toString(36)}`;

/**
 * Composer attachments: upload via /api/documents/upload, then poll each new document
 * (GET /api/documents/{id}) until it is indexed or failed.
 */
export function useAttachments({
  system,
  collectionId,
  onDocumentsAvailable,
}: {
  system: SystemInfo | undefined;
  collectionId: string | null;
  /** Called with ids of documents that were uploaded (or already existed as duplicates). */
  onDocumentsAvailable?: (documentIds: string[]) => void;
}) {
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [tick, setTick] = useState(0);
  const callbackRef = useRef(onDocumentsAvailable);
  useEffect(() => {
    callbackRef.current = onDocumentsAvailable;
  });

  const upload = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      const { accepted, rejected } = validateFiles(files, {
        maxUploadMb: system?.max_upload_mb,
        supportedExtensions: system?.supported_extensions,
      });
      const pending = accepted.map((f) => ({ file: f, key: key() }));
      setAttachments((prev) => [
        ...prev,
        ...rejected.map((r) => ({
          key: key(),
          name: r.file.name,
          size: r.file.size,
          state: "rejected" as const,
          documentId: null,
          progress: null,
          stage: null,
          message: r.reason,
        })),
        ...pending.map((p) => ({
          key: p.key,
          name: p.file.name,
          size: p.file.size,
          state: "uploading" as const,
          documentId: null,
          progress: null,
          stage: null,
          message: null,
        })),
      ]);
      if (pending.length === 0) return;

      try {
        const res = await uploadDocuments(pending.map((p) => p.file), collectionId);
        const uploaded = [...res.uploaded];
        const duplicates = [...res.duplicates];
        const serverRejected = [...res.rejected];
        const available: string[] = [];

        const resolved = new Map<string, Partial<Attachment>>();
        for (const p of pending) {
          const ui = uploaded.findIndex((d) => d.filename === p.file.name);
          if (ui !== -1) {
            const doc = uploaded.splice(ui, 1)[0];
            available.push(doc.id);
            resolved.set(p.key, {
              state: doc.status === "indexed" ? "indexed" : doc.status === "failed" ? "failed" : "processing",
              documentId: doc.id,
              progress: doc.job?.progress ?? null,
              stage: doc.job?.stage ?? null,
              message: doc.error_message,
            });
            continue;
          }
          const di = duplicates.findIndex((d) => d.filename === p.file.name);
          if (di !== -1) {
            const dup = duplicates.splice(di, 1)[0];
            available.push(dup.existing_document_id);
            resolved.set(p.key, {
              state: "duplicate",
              documentId: dup.existing_document_id,
              message: `Already in your library as “${dup.existing_title}”`,
            });
            continue;
          }
          const ri = serverRejected.findIndex((r) => r.filename === p.file.name);
          if (ri !== -1) {
            const rej = serverRejected.splice(ri, 1)[0];
            resolved.set(p.key, { state: "rejected", message: rej.reason });
            continue;
          }
          resolved.set(p.key, { state: "failed", message: "The server did not report a result for this file." });
        }

        setAttachments((prev) => prev.map((a) => (resolved.has(a.key) ? { ...a, ...resolved.get(a.key) } : a)));
        if (available.length > 0) callbackRef.current?.(available);
      } catch (err) {
        notifyError(err);
        const message = errorMessage(err);
        const keys = new Set(pending.map((p) => p.key));
        setAttachments((prev) => prev.map((a) => (keys.has(a.key) ? { ...a, state: "failed", message } : a)));
      }
    },
    [system, collectionId],
  );

  const processingKey = useMemo(
    () =>
      attachments
        .filter((a) => a.state === "processing" && a.documentId)
        .map((a) => a.documentId)
        .join(","),
    [attachments],
  );

  useEffect(() => {
    if (!processingKey) return;
    const ids = processingKey.split(",");
    let cancelled = false;
    const timer = setTimeout(async () => {
      const results = await Promise.allSettled(ids.map((id) => getDocument(id)));
      if (cancelled) return;
      const byId = new Map<string, Partial<Attachment>>();
      results.forEach((r, i) => {
        if (r.status !== "fulfilled") return;
        const d = r.value;
        byId.set(ids[i], {
          state: d.status === "indexed" ? "indexed" : d.status === "failed" ? "failed" : "processing",
          progress: d.job?.progress ?? null,
          stage: d.job?.stage ?? null,
          message: d.status === "failed" ? d.error_message ?? d.job?.last_error ?? "Indexing failed" : null,
        });
      });
      setAttachments((prev) =>
        prev.map((a) => (a.documentId && a.state === "processing" && byId.has(a.documentId) ? { ...a, ...byId.get(a.documentId) } : a)),
      );
      setTick((t) => t + 1);
    }, DOCUMENT_POLL_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [processingKey, tick]);

  const remove = useCallback((k: string) => setAttachments((prev) => prev.filter((a) => a.key !== k)), []);
  const clearSettled = useCallback(
    () => setAttachments((prev) => prev.filter((a) => a.state === "uploading" || a.state === "processing")),
    [],
  );

  const busy = attachments.some((a) => a.state === "uploading" || a.state === "processing");
  return { attachments, upload, remove, clearSettled, busy };
}
