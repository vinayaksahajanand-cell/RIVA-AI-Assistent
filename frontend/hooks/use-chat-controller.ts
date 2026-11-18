"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import {
  applyStreamEvent,
  draftMessage,
  EMPTY_SCOPE,
  EVALUATION_EMPTY_GRACE_POLLS,
  EVALUATION_MAX_POLL_ERRORS,
  isLocalId,
  itemsFromMessages,
  lastUserIndex,
  newLiveState,
  scopeFromConversation,
  scopeToRequest,
  type ChatItem,
  type ChatScope,
} from "@/lib/chat";
import { EVALUATION_POLL_MS, shouldPollEvaluations } from "@/lib/evaluation";
import { notifyError } from "@/lib/notify";
import { createTypewriter, prefersReducedMotion } from "@/lib/typewriter";
import type { ChatRequest, ChatStreamEvent, ConversationDetail, EvaluationOut, MessageOut } from "@/lib/types";
import { postChat, streamChat, StreamUnsupportedError } from "@/services/chat";
import { getConversation } from "@/services/conversations";
import { getMessageEvaluations } from "@/services/evaluations";
import { ApiError, errorMessage, isAbortError } from "@/services/http";
import { getMessage, sendFeedback } from "@/services/messages";

type LoadState = { status: "idle" | "loading" | "ready" } | { status: "error"; error: unknown };
type DoneEvent = Extract<ChatStreamEvent, { event: "done" }>;

export interface ChatControllerOptions {
  conversationId: string | null;
  model: string | null;
  /** A brand-new conversation was created by the first streamed turn. */
  onConversationCreated: (id: string) => void;
  /** A turn finished (titles / ordering in the sidebar may have changed). */
  onTurnComplete: () => void;
  /**
   * The session may see answer diagnostics (diagnostics.view). Without it the backend answers
   * /api/evaluations/* with 403, so evaluations are only polled for messages that already carry
   * diagnostics (an admin enabled `show_diagnostics_to_users`).
   */
  diagnostics?: boolean;
}

let keySeq = 0;
const nextKey = () => `k${Date.now().toString(36)}${(keySeq++).toString(36)}`;

export function useChatController({
  conversationId,
  model,
  onConversationCreated,
  onTurnComplete,
  diagnostics = false,
}: ChatControllerOptions) {
  const [items, setItems] = useState<ChatItem[]>([]);
  const [conversation, setConversation] = useState<ConversationDetail | null>(null);
  const [scope, setScope] = useState<ChatScope>(EMPTY_SCOPE);
  const [loadState, setLoadState] = useState<LoadState>(() =>
    conversationId ? { status: "loading" } : { status: "idle" },
  );
  const [reloadTick, setReloadTick] = useState(0);
  const [isStreaming, setIsStreaming] = useState(false);
  const [pollTick, setPollTick] = useState(0);

  const controllerRef = useRef<AbortController | null>(null);
  const createdIdRef = useRef<string | null>(null);
  const callbacksRef = useRef({ onConversationCreated, onTurnComplete });
  useEffect(() => {
    callbacksRef.current = { onConversationCreated, onTurnComplete };
  });

  /* ---------------------------------------------------------- load history */
  useEffect(() => {
    // The conversation this view just created is already in memory.
    if (!conversationId || conversationId === createdIdRef.current) return;
    const ctrl = new AbortController();
    getConversation(conversationId, ctrl.signal).then(
      (detail) => {
        setConversation(detail);
        setItems(itemsFromMessages(detail.messages));
        setScope(scopeFromConversation(detail.scope));
        setLoadState({ status: "ready" });
      },
      (error: unknown) => {
        if (ctrl.signal.aborted || isAbortError(error)) return;
        setLoadState({ status: "error", error });
      },
    );
    return () => ctrl.abort();
  }, [conversationId, reloadTick]);

  const reload = useCallback(() => {
    setLoadState({ status: "loading" });
    setReloadTick((t) => t + 1);
  }, []);

  // Abort an in-flight stream when the view unmounts (navigating to another conversation).
  useEffect(() => () => controllerRef.current?.abort(), []);

  const updateItem = useCallback((key: string, fn: (item: ChatItem) => ChatItem) => {
    setItems((prev) => prev.map((it) => (it.key === key ? fn(it) : it)));
  }, []);

  const refreshConversationMeta = useCallback((id: string) => {
    getConversation(id).then(
      (detail) => setConversation(detail),
      () => {},
    );
  }, []);

  /* -------------------------------------------------------------- streaming */
  const runStream = useCallback(
    async (request: ChatRequest, userKey: string, asstKey: string) => {
      const controller = new AbortController();
      controllerRef.current = controller;
      setIsStreaming(true);

      let assistantId: string | null = null;
      let createdId: string | null = null;
      let finished = false; // got `done` or `error`

      // Word-by-word reveal: `token` words are queued and revealed at a smooth cadence; `done` is held
      // back until the queue has drained so the final message (citation chips etc.) swaps in last.
      const typer = createTypewriter({
        instant: prefersReducedMotion(),
        onReveal: (text) => updateItem(asstKey, (it) => applyStreamEvent(it, { event: "token", data: { delta: text } })),
      });
      const pending: { done: DoneEvent | null } = { done: null };
      const onAbort = () => typer.flush();
      controller.signal.addEventListener("abort", onAbort);

      /** Finish revealing (quickly), then apply the held `done` event. */
      const settleDone = async (): Promise<boolean> => {
        const done = pending.done;
        if (!done) return false;
        pending.done = null;
        await typer.finish();
        updateItem(asstKey, (it) => applyStreamEvent(it, done));
        return true;
      };

      const markCreated = (id: string) => {
        if (request.conversation_id || createdId) return;
        createdId = id;
        createdIdRef.current = id;
        callbacksRef.current.onConversationCreated(id);
      };

      const onEvent = (event: ChatStreamEvent) => {
        if (event.event === "meta") {
          assistantId = event.data.assistant_message_id;
          const { user_message_id, conversation_id } = event.data;
          setItems((prev) =>
            prev.map((it) => {
              if (it.key === userKey) {
                return { ...it, message: { ...it.message, id: user_message_id || it.message.id, conversation_id } };
              }
              return it.key === asstKey ? applyStreamEvent(it, event) : it;
            }),
          );
          markCreated(conversation_id);
          return;
        }
        if (event.event === "token") {
          typer.push(event.data.delta);
          return;
        }
        if (event.event === "done") {
          finished = true;
          pending.done = event;
          return;
        }
        if (event.event === "error") {
          finished = true;
          typer.flush();
          toast.error(event.data.message);
        }
        updateItem(asstKey, (it) => applyStreamEvent(it, event));
      };

      try {
        try {
          await streamChat(request, onEvent, controller.signal);
          await settleDone();
        } catch (err) {
          const unsupported =
            err instanceof StreamUnsupportedError ||
            (err instanceof ApiError && [404, 405, 501].includes(err.status));
          if (!unsupported) throw err;
          // Non-streaming fallback (POST /api/chat).
          const res = await postChat(request, controller.signal);
          finished = true;
          setItems((prev) =>
            prev.map((it) => {
              if (it.key === userKey) return { ...it, message: res.user_message };
              if (it.key === asstKey) {
                return { key: asstKey, message: res.assistant_message, evalGrace: EVALUATION_EMPTY_GRACE_POLLS, pollErrors: 0 };
              }
              return it;
            }),
          );
          markCreated(res.conversation_id);
        }

        if (!finished) {
          typer.flush();
          // Stream closed without `done`: recover the persisted answer if possible.
          let recovered: MessageOut | null = null;
          if (assistantId) {
            try {
              const m = await getMessage(assistantId);
              if (m.status !== "streaming") recovered = m;
            } catch {
              /* fall through */
            }
          }
          updateItem(asstKey, (it) =>
            recovered
              ? { key: it.key, message: recovered, evalGrace: EVALUATION_EMPTY_GRACE_POLLS, pollErrors: 0 }
              : {
                  key: it.key,
                  message: {
                    ...it.message,
                    status: "failed",
                    error_message: "The connection closed before the answer finished.",
                  },
                },
          );
        }
      } catch (err) {
        typer.flush();
        if (await settleDone()) {
          // The answer completed before the stream errored or was stopped: keep the final message.
        } else if (isAbortError(err)) {
          updateItem(asstKey, (it) => ({
            key: it.key,
            stopped: true,
            message: { ...it.message, status: "stopped" },
          }));
        } else {
          notifyError(err);
          updateItem(asstKey, (it) => ({
            key: it.key,
            message: { ...it.message, status: "failed", error_message: errorMessage(err) },
          }));
        }
      } finally {
        typer.dispose();
        controller.signal.removeEventListener("abort", onAbort);
        if (controllerRef.current === controller) controllerRef.current = null;
        setIsStreaming(false);
        const convId = createdId ?? request.conversation_id ?? null;
        if (convId) refreshConversationMeta(convId);
        callbacksRef.current.onTurnComplete();
      }
    },
    [updateItem, refreshConversationMeta],
  );

  const baseRequest = useCallback(
    (): Pick<ChatRequest, "document_ids" | "collection_id" | "model"> => ({ ...scopeToRequest(scope), model }),
    [scope, model],
  );

  const send = useCallback(
    (text: string) => {
      const message = text.trim();
      if (!message || controllerRef.current) return;
      const userKey = nextKey();
      const asstKey = nextKey();
      const convId = conversationId ?? createdIdRef.current;
      setItems((prev) => [
        ...prev,
        { key: userKey, message: draftMessage({ id: `local-${userKey}`, role: "user", content: message, status: "completed" }) },
        {
          key: asstKey,
          message: draftMessage({ id: `local-${asstKey}`, role: "assistant", content: "", status: "streaming", model }),
          live: newLiveState(),
        },
      ]);
      void runStream({ message, conversation_id: convId, ...baseRequest() }, userKey, asstKey);
    },
    [conversationId, model, runStream, baseRequest],
  );

  const regenerate = useCallback(() => {
    if (controllerRef.current) return;
    const convId = conversationId ?? createdIdRef.current;
    const idx = lastUserIndex(items);
    if (!convId || idx === -1) return;
    const userItem = items[idx];
    const asstKey = nextKey();
    setItems((prev) => [
      ...prev.slice(0, idx + 1),
      {
        key: asstKey,
        message: draftMessage({ id: `local-${asstKey}`, role: "assistant", content: "", status: "streaming", model }),
        live: newLiveState(),
      },
    ]);
    void runStream(
      { message: userItem.message.content, conversation_id: convId, regenerate: true, ...baseRequest() },
      userItem.key,
      asstKey,
    );
  }, [conversationId, items, model, runStream, baseRequest]);

  const stop = useCallback(() => controllerRef.current?.abort(), []);

  /* --------------------------------------------------------------- feedback */
  const setFeedback = useCallback(
    async (messageId: string, rating: 1 | -1) => {
      let previous: number | null = null;
      setItems((prev) =>
        prev.map((it) => {
          if (it.message.id !== messageId) return it;
          previous = it.message.feedback_rating;
          return { ...it, message: { ...it.message, feedback_rating: rating } };
        }),
      );
      try {
        await sendFeedback(messageId, { rating });
        toast.success(rating === 1 ? "Thanks for the feedback" : "Feedback recorded");
      } catch (err) {
        notifyError(err);
        setItems((prev) =>
          prev.map((it) =>
            it.message.id === messageId ? { ...it, message: { ...it.message, feedback_rating: previous } } : it,
          ),
        );
      }
    },
    [],
  );

  /* ------------------------------------------------------------ evaluations */
  const setEvaluations = useCallback((messageId: string, evaluations: EvaluationOut[]) => {
    setItems((prev) =>
      prev.map((it) =>
        it.message.id === messageId
          ? { ...it, message: { ...it.message, evaluations }, pollErrors: 0, evalGrace: EVALUATION_EMPTY_GRACE_POLLS }
          : it,
      ),
    );
  }, []);

  const pollKey = useMemo(
    () =>
      items
        .filter(
          (it) =>
            it.message.role === "assistant" &&
            !it.live &&
            !isLocalId(it.message.id) &&
            it.message.status !== "blocked" &&
            (diagnostics || it.message.retrieval !== null) &&
            (it.pollErrors ?? 0) < EVALUATION_MAX_POLL_ERRORS &&
            shouldPollEvaluations(it.message.evaluations, it.evalGrace ?? 0),
        )
        .map((it) => it.message.id)
        .join(","),
    [items, diagnostics],
  );

  useEffect(() => {
    if (!pollKey) return;
    const ids = pollKey.split(",");
    let cancelled = false;
    const timer = setTimeout(async () => {
      const results = await Promise.allSettled(ids.map((id) => getMessageEvaluations(id)));
      if (cancelled) return;
      setItems((prev) =>
        prev.map((it) => {
          const i = ids.indexOf(it.message.id);
          if (i === -1) return it;
          const r = results[i];
          const grace = Math.max(0, (it.evalGrace ?? 0) - 1);
          if (r.status === "fulfilled") {
            return { ...it, message: { ...it.message, evaluations: r.value.evaluations }, evalGrace: grace, pollErrors: 0 };
          }
          return { ...it, evalGrace: grace, pollErrors: (it.pollErrors ?? 0) + 1 };
        }),
      );
      setPollTick((t) => t + 1);
    }, EVALUATION_POLL_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [pollKey, pollTick]);

  return {
    items,
    conversation,
    setConversation,
    scope,
    setScope,
    loadState,
    reload,
    isStreaming,
    send,
    regenerate,
    stop,
    setFeedback,
    setEvaluations,
  };
}

export type ChatController = ReturnType<typeof useChatController>;
