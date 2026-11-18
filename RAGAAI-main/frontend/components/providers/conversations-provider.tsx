"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

import { useApiQuery } from "@/hooks/use-api-query";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import type { ConversationOut } from "@/lib/types";
import { deleteConversation, listConversations, renameConversation } from "@/services/conversations";

interface ConversationsValue {
  conversations: ConversationOut[] | undefined;
  isLoading: boolean;
  error: unknown;
  query: string;
  setQuery: (q: string) => void;
  refresh: () => void;
  rename: (id: string, title: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

const ConversationsContext = createContext<ConversationsValue | null>(null);

/** Sidebar conversation list (GET /api/conversations?q=) shared with the chat view. */
export function ConversationsProvider({ children }: { children: ReactNode }) {
  const [query, setQuery] = useState("");
  const debounced = useDebouncedValue(query.trim(), 300);
  const { data, error, isLoading, refresh, mutate } = useApiQuery(
    `conversations:${debounced}`,
    (signal) => listConversations(debounced || undefined, signal),
    { keepPreviousData: true },
  );

  const rename = useCallback(
    async (id: string, title: string) => {
      const updated = await renameConversation(id, title);
      mutate((prev) => prev?.map((c) => (c.id === id ? { ...c, ...updated, title: updated?.title ?? title } : c)));
    },
    [mutate],
  );

  const remove = useCallback(
    async (id: string) => {
      await deleteConversation(id);
      mutate((prev) => prev?.filter((c) => c.id !== id));
    },
    [mutate],
  );

  const value = useMemo<ConversationsValue>(
    () => ({ conversations: data, isLoading, error, query, setQuery, refresh, rename, remove }),
    [data, isLoading, error, query, refresh, rename, remove],
  );

  return <ConversationsContext.Provider value={value}>{children}</ConversationsContext.Provider>;
}

export function useConversations(): ConversationsValue {
  const ctx = useContext(ConversationsContext);
  if (!ctx) throw new Error("useConversations must be used inside <ConversationsProvider>");
  return ctx;
}
