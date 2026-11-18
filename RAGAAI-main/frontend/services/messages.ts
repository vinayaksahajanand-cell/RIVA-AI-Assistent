import { apiFetch } from "@/services/http";
import type { FeedbackRequest, MessageOut, OkResponse } from "@/lib/types";

export function getMessage(id: string, signal?: AbortSignal): Promise<MessageOut> {
  return apiFetch<MessageOut>(`/api/messages/${encodeURIComponent(id)}`, { signal });
}

export function sendFeedback(id: string, body: FeedbackRequest): Promise<OkResponse> {
  return apiFetch<OkResponse>(`/api/messages/${encodeURIComponent(id)}/feedback`, { method: "POST", json: body });
}
