/**
 * Server-Sent Events parsing for POST streams consumed via fetch + ReadableStream.
 *
 * EventSource cannot POST or send credentials cross-origin with a body, so the chat
 * stream is read manually. The parser follows the WHATWG SSE event-stream grammar:
 *   - lines end with "\n", "\r\n" or "\r" (a "\r\n" split across chunks is handled)
 *   - "event:" sets the event type, "data:" lines are joined with "\n"
 *   - a single leading space after the colon is stripped
 *   - lines beginning with ":" are comments (keep-alives)
 *   - a blank line dispatches the event; events without data are dropped
 */

import type { ChatStreamEvent, StreamDoneEvent } from "@/lib/types";

export interface SSEMessage {
  event: string;
  data: string;
  id?: string;
}

export class SSEParser {
  private buffer = "";
  private eventType = "";
  private dataLines: string[] = [];
  private lastEventId: string | undefined;
  /** True when the previous chunk ended in "\r" (the next "\n" belongs to it). */
  private pendingCR = false;

  /** Feed a decoded text chunk; returns the complete events it finished. */
  push(chunk: string): SSEMessage[] {
    if (!chunk) return [];
    let text = chunk;
    if (this.pendingCR) {
      this.pendingCR = false;
      if (text.startsWith("\n")) text = text.slice(1);
    }
    this.buffer += text;

    const out: SSEMessage[] = [];
    let start = 0;
    for (let i = 0; i < this.buffer.length; i++) {
      const ch = this.buffer[i];
      if (ch !== "\n" && ch !== "\r") continue;
      const line = this.buffer.slice(start, i);
      if (ch === "\r") {
        if (i + 1 < this.buffer.length) {
          if (this.buffer[i + 1] === "\n") i++;
        } else {
          // "\r" at the very end of the chunk: a following "\n" must be swallowed.
          this.pendingCR = true;
        }
      }
      start = i + 1;
      const msg = this.processLine(line);
      if (msg) out.push(msg);
    }
    this.buffer = this.buffer.slice(start);
    return out;
  }

  /** Flush at end of stream: dispatches a final event that lacked its trailing blank line. */
  flush(): SSEMessage[] {
    const out: SSEMessage[] = [];
    if (this.buffer.length > 0) {
      const msg = this.processLine(this.buffer);
      this.buffer = "";
      if (msg) out.push(msg);
    }
    const last = this.dispatch();
    if (last) out.push(last);
    this.pendingCR = false;
    return out;
  }

  private processLine(line: string): SSEMessage | null {
    if (line === "") return this.dispatch();
    if (line.startsWith(":")) return null; // comment / keep-alive

    const colon = line.indexOf(":");
    let field: string;
    let value: string;
    if (colon === -1) {
      field = line;
      value = "";
    } else {
      field = line.slice(0, colon);
      value = line.slice(colon + 1);
      if (value.startsWith(" ")) value = value.slice(1);
    }

    switch (field) {
      case "event":
        this.eventType = value;
        break;
      case "data":
        this.dataLines.push(value);
        break;
      case "id":
        if (!value.includes("\u0000")) this.lastEventId = value;
        break;
      default:
        // "retry" and unknown fields are ignored.
        break;
    }
    return null;
  }

  private dispatch(): SSEMessage | null {
    if (this.dataLines.length === 0) {
      this.eventType = "";
      return null;
    }
    const msg: SSEMessage = {
      event: this.eventType || "message",
      data: this.dataLines.join("\n"),
    };
    if (this.lastEventId !== undefined) msg.id = this.lastEventId;
    this.eventType = "";
    this.dataLines = [];
    return msg;
  }
}

const CHAT_EVENTS = new Set(["meta", "status", "retrieval", "token", "done", "error"]);

/**
 * Decode a raw SSE message into a typed chat stream event.
 * Returns null for unknown event names or malformed JSON (forward-compatible).
 */
export function parseChatStreamEvent(msg: SSEMessage): ChatStreamEvent | null {
  if (!CHAT_EVENTS.has(msg.event)) return null;
  let data: unknown;
  try {
    data = JSON.parse(msg.data);
  } catch {
    return null;
  }
  if (data === null || typeof data !== "object") return null;
  const obj = data as Record<string, unknown>;

  switch (msg.event) {
    case "token":
      return typeof obj.delta === "string" ? { event: "token", data: { delta: obj.delta } } : null;
    case "status":
      return {
        event: "status",
        data: {
          stage: typeof obj.stage === "string" ? obj.stage : "",
          label: typeof obj.label === "string" ? obj.label : String(obj.stage ?? ""),
        },
      };
    case "done":
      return obj.message && typeof obj.message === "object"
        ? { event: "done", data: obj as unknown as StreamDoneEvent }
        : null;
    case "error":
      return {
        event: "error",
        data: {
          code: typeof obj.code === "string" ? obj.code : "stream_error",
          message: typeof obj.message === "string" ? obj.message : "The response stream failed.",
        },
      };
    default:
      return { event: msg.event, data: obj } as unknown as ChatStreamEvent;
  }
}

/**
 * Read an SSE response body to completion, invoking `onEvent` for each typed chat event.
 * UTF-8 sequences split across network chunks are decoded correctly (streaming decoder).
 */
export async function readChatStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: ChatStreamEvent) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8");
  const parser = new SSEParser();
  const emit = (messages: SSEMessage[]) => {
    for (const m of messages) {
      const evt = parseChatStreamEvent(m);
      if (evt) onEvent(evt);
    }
  };
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) emit(parser.push(decoder.decode(value, { stream: true })));
    }
    emit(parser.push(decoder.decode()));
    emit(parser.flush());
  } finally {
    reader.releaseLock();
  }
}
