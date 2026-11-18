"use client";

import { useParams, useRouter } from "next/navigation";
import { useCallback, useState, type ReactNode } from "react";

import { ChatWorkspace } from "@/components/chat/chat-workspace";
import { useShell } from "@/components/providers/shell-provider";

/**
 * Shared layout for "/" and "/c/[id]". The chat workspace lives here (not in the pages) so a
 * brand-new conversation keeps its in-flight stream when the URL switches from "/" to "/c/{id}".
 *
 * The workspace is keyed per conversation: navigating to another conversation, or explicitly
 * starting a new one, remounts it with fresh state; the "/" → "/c/{new id}" hop does not.
 */
export default function ChatLayout({ children }: { children: ReactNode }) {
  const params = useParams<{ id?: string }>();
  const routeId = typeof params?.id === "string" ? decodeURIComponent(params.id) : null;
  const router = useRouter();
  const { newChatNonce } = useShell();

  const [aliases, setAliases] = useState<Record<string, string>>({});
  const [prevRouteId, setPrevRouteId] = useState<string | null>(routeId);
  const [visitsToNew, setVisitsToNew] = useState(0);
  if (prevRouteId !== routeId) {
    setPrevRouteId(routeId);
    if (routeId === null) setVisitsToNew((n) => n + 1);
  }

  const newKey = `new-${newChatNonce}-${visitsToNew}`;
  const key = routeId === null ? newKey : (aliases[routeId] ?? `c-${routeId}`);

  const onConversationCreated = useCallback(
    (id: string) => {
      setAliases((a) => ({ ...a, [id]: newKey }));
      router.replace(`/c/${encodeURIComponent(id)}`, { scroll: false });
    },
    [newKey, router],
  );

  return (
    <>
      {children}
      <ChatWorkspace key={key} conversationId={routeId} onConversationCreated={onConversationCreated} />
    </>
  );
}
