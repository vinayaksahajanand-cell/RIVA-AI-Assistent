import { apiFetch, downloadFile } from "@/services/http";
import type { ConversationDetail, ConversationOut, ExportFormat, OkResponse } from "@/lib/types";

const base = (id: string) => `/api/conversations/${encodeURIComponent(id)}`;

export function listConversations(q?: string, signal?: AbortSignal): Promise<ConversationOut[]> {
  return apiFetch<ConversationOut[]>("/api/conversations", { query: { q }, signal });
}

export function getConversation(id: string, signal?: AbortSignal): Promise<ConversationDetail> {
  return apiFetch<ConversationDetail>(base(id), { signal });
}

export function renameConversation(id: string, title: string): Promise<ConversationOut> {
  return apiFetch<ConversationOut>(base(id), { method: "PATCH", json: { title } });
}

export function deleteConversation(id: string): Promise<OkResponse> {
  return apiFetch<OkResponse>(base(id), { method: "DELETE" });
}

export function exportConversation(id: string, format: "markdown" | "json"): Promise<void> {
  const ext = format === "markdown" ? "md" : "json";
  return downloadFile(`${base(id)}/export`, { format }, `conversation-${id}.${ext}`);
}

export type { ExportFormat };
