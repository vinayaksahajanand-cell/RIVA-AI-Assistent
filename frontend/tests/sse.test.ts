import { describe, expect, it } from "vitest";

import { parseChatStreamEvent, readChatStream, SSEParser } from "@/lib/sse";
import type { ChatStreamEvent } from "@/lib/types";

function feed(chunks: string[]) {
  const p = new SSEParser();
  const out = chunks.flatMap((c) => p.push(c));
  return [...out, ...p.flush()];
}

describe("SSEParser", () => {
  it("parses a single complete frame", () => {
    expect(feed(['event: token\ndata: {"delta":"Hi"}\n\n'])).toEqual([{ event: "token", data: '{"delta":"Hi"}' }]);
  });

  it("handles frames split at arbitrary chunk boundaries", () => {
    const frame = 'event: status\ndata: {"stage":"retrieval","label":"Searching documents"}\n\nevent: token\ndata: {"delta":"a"}\n\n';
    for (let size = 1; size <= 7; size++) {
      const chunks: string[] = [];
      for (let i = 0; i < frame.length; i += size) chunks.push(frame.slice(i, i + size));
      expect(feed(chunks).map((m) => m.event)).toEqual(["status", "token"]);
    }
  });

  it("supports CRLF and a CR/LF pair split across chunks", () => {
    const msgs = feed(["event: token\r", "\ndata: {\"delta\":\"x\"}\r\n", "\r\n"]);
    expect(msgs).toEqual([{ event: "token", data: '{"delta":"x"}' }]);
  });

  it("supports bare CR line endings", () => {
    expect(feed(['event: done\rdata: {"a":1}\r\r'])).toEqual([{ event: "done", data: '{"a":1}' }]);
  });

  it("joins multi-line data with newlines and strips one leading space only", () => {
    expect(feed(["data:  two spaces\ndata:line2\n\n"])).toEqual([{ event: "message", data: " two spaces\nline2" }]);
  });

  it("ignores comments / keep-alives and events without data", () => {
    expect(feed([": ping\n\nevent: meta\n\n", 'event: meta\ndata: {"x":1}\n\n'])).toEqual([{ event: "meta", data: '{"x":1}' }]);
  });

  it("flushes a final frame that lacks the trailing blank line", () => {
    const p = new SSEParser();
    expect(p.push('event: done\ndata: {"message":{}}')).toEqual([]);
    expect(p.flush()).toEqual([{ event: "done", data: '{"message":{}}' }]);
  });

  it("records the last event id", () => {
    expect(feed(["id: 7\ndata: x\n\n"])).toEqual([{ event: "message", data: "x", id: "7" }]);
  });
});

describe("parseChatStreamEvent", () => {
  it("decodes typed chat events", () => {
    expect(parseChatStreamEvent({ event: "token", data: '{"delta":"Hello"}' })).toEqual({ event: "token", data: { delta: "Hello" } });
    expect(parseChatStreamEvent({ event: "status", data: '{"stage":"rerank","label":"Reranking"}' })).toEqual({
      event: "status",
      data: { stage: "rerank", label: "Reranking" },
    });
  });

  it("returns null for unknown events, malformed JSON and invalid payloads", () => {
    expect(parseChatStreamEvent({ event: "heartbeat", data: "{}" })).toBeNull();
    expect(parseChatStreamEvent({ event: "token", data: "{not json" })).toBeNull();
    expect(parseChatStreamEvent({ event: "token", data: '{"delta":5}' })).toBeNull();
    expect(parseChatStreamEvent({ event: "done", data: '{"nope":true}' })).toBeNull();
  });

  it("fills defaults for error events", () => {
    expect(parseChatStreamEvent({ event: "error", data: "{}" })).toEqual({
      event: "error",
      data: { code: "stream_error", message: "The response stream failed." },
    });
  });
});

describe("readChatStream", () => {
  it("decodes a byte stream including a multi-byte character split across chunks", async () => {
    const text = 'event: meta\ndata: {"conversation_id":"c1","user_message_id":"u1","assistant_message_id":"a1","run_id":"r"}\n\n' +
      'event: token\ndata: {"delta":"café ✓"}\n\n' +
      'event: done\ndata: {"message":{"id":"a1","content":"café ✓"}}\n\n';
    const bytes = new TextEncoder().encode(text);
    const cut = text.indexOf("é") + 1; // split inside the 2-byte "é"
    const byteCut = new TextEncoder().encode(text.slice(0, cut)).length - 1;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, byteCut));
        controller.enqueue(bytes.slice(byteCut, byteCut + 3));
        controller.enqueue(bytes.slice(byteCut + 3));
        controller.close();
      },
    });
    const events: ChatStreamEvent[] = [];
    await readChatStream(stream, (e) => events.push(e));
    expect(events.map((e) => e.event)).toEqual(["meta", "token", "done"]);
    const token = events[1];
    expect(token.event === "token" && token.data.delta).toBe("café ✓");
  });
});
