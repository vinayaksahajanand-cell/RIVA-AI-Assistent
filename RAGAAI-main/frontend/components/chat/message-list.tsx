"use client";

import { ArrowDown } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { AssistantMessage, UserMessage, type AssistantMessageProps } from "@/components/chat/assistant-message";
import { Button } from "@/components/ui/button";
import type { ChatItem } from "@/lib/chat";

const STICK_THRESHOLD = 120;

type SharedProps = Omit<AssistantMessageProps, "item" | "isLast" | "focused" | "highlightChunkId">;

/** Scrollable transcript that follows new content unless the user scrolled up. */
export function MessageList({
  items,
  focusedKey,
  highlight,
  ...shared
}: SharedProps & {
  items: ChatItem[];
  focusedKey: string | null;
  highlight: { key: string; chunkId: string } | null;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const [showJump, setShowJump] = useState(false);

  const onScroll = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    stick.current = distance < STICK_THRESHOLD;
    setShowJump(distance > STICK_THRESHOLD * 2);
  }, []);

  // Sending a new question always re-pins the view to the bottom, even if the reader had
  // scrolled up (e.g. to inspect an earlier answer's evaluation panels).
  const userCount = items.reduce((n, it) => n + (it.message.role === "user" ? 1 : 0), 0);
  const lastUserCount = useRef(userCount);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (userCount > lastUserCount.current) {
      stick.current = true;
      setShowJump(false);
    }
    lastUserCount.current = userCount;
    if (stick.current) el.scrollTop = el.scrollHeight;
  }, [items, userCount]);

  const jump = () => {
    const el = scroller.current;
    if (!el) return;
    stick.current = true;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  };

  const lastKey = items.length ? items[items.length - 1].key : null;

  return (
    <div className="relative min-h-0 flex-1">
      <div ref={scroller} onScroll={onScroll} className="h-full overflow-y-auto scrollbar-thin" role="log" aria-label="Conversation" aria-live="off">
        <div className="mx-auto w-full max-w-3xl space-y-8 px-4 py-6 sm:px-6">
          {items.map((it) =>
            it.message.role === "user" ? (
              <UserMessage key={it.key} content={it.message.content} />
            ) : (
              <AssistantMessage
                key={it.key}
                item={it}
                isLast={it.key === lastKey}
                focused={it.key === focusedKey}
                highlightChunkId={highlight && highlight.key === it.key ? highlight.chunkId : null}
                {...shared}
              />
            ),
          )}
        </div>
      </div>
      {showJump && (
        <Button
          variant="outline"
          size="icon-sm"
          onClick={jump}
          className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-background shadow-md"
          aria-label="Scroll to latest message"
        >
          <ArrowDown />
        </Button>
      )}
    </div>
  );
}
