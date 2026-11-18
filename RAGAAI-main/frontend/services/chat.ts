import { readChatStream } from "@/lib/sse";
import type { ChatRequest, ChatResponse, ChatStreamEvent, SuggestedQuestions } from "@/lib/types";
import { apiFetch, apiRequest } from "@/services/http";

/** The server answered the stream endpoint with something other than an SSE stream. */
export class StreamUnsupportedError extends Error {
  constructor(message = "The server did not return an event stream.") {
    super(message);
    this.name = "StreamUnsupportedError";
  }
}

/**
 * POST /api/chat/stream and dispatch typed SSE events until the stream closes.
 * Uses fetch + ReadableStream (EventSource cannot POST a JSON body).
 * Abort via `signal` (stop button). Rejects with ApiError for non-2xx responses.
 */
export async function streamChat(
  body: ChatRequest,
  onEvent: (event: ChatStreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await apiRequest("/api/chat/stream", {
    method: "POST",
    json: body,
    signal,
    headers: { Accept: "text/event-stream" },
  });
  const contentType = res.headers.get("content-type") ?? "";
  if (!res.body || !contentType.includes("text/event-stream")) {
    throw new StreamUnsupportedError();
  }
  await readChatStream(res.body, onEvent);
}

/** Non-streaming fallback (POST /api/chat). */
export function postChat(body: ChatRequest, signal?: AbortSignal): Promise<ChatResponse> {
  return apiFetch<ChatResponse>("/api/chat", { method: "POST", json: body, signal });
}

export function getSuggestions(signal?: AbortSignal): Promise<SuggestedQuestions> {
  return apiFetch<SuggestedQuestions>("/api/chat/suggestions", { signal });
}
