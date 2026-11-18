"use client";

import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { Composer } from "@/components/chat/composer";
import { ContextPanel } from "@/components/chat/context-panel";
import { ConversationHeader } from "@/components/chat/conversation-header";
import { MessageList } from "@/components/chat/message-list";
import { ModelSelect } from "@/components/chat/model-select";
import { ScopePicker } from "@/components/chat/scope-picker";
import { WelcomeScreen } from "@/components/chat/welcome-screen";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { QueryError } from "@/components/common/query-error";
import { RenameDialog } from "@/components/layout/rename-dialog";
import { useConversations } from "@/components/providers/conversations-provider";
import { useSession } from "@/components/providers/session-provider";
import { useShell } from "@/components/providers/shell-provider";
import { useSystemInfo } from "@/components/providers/system-provider";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useApiQuery } from "@/hooks/use-api-query";
import { useAttachments } from "@/hooks/use-attachments";
import { useChatController } from "@/hooks/use-chat-controller";
import { useLocalStorageState } from "@/hooks/use-local-storage";
import { DESKTOP_PANEL_QUERY, useMediaQuery } from "@/hooks/use-media-query";
import { lastAssistantKey } from "@/lib/chat";
import type { CitationTarget } from "@/lib/citations";
import { notifyError } from "@/lib/notify";
import { accessibleClassifications } from "@/lib/permissions";
import type { EvaluationOut } from "@/lib/types";
import { getSuggestions } from "@/services/chat";
import { listCollections } from "@/services/collections";
import { exportConversation } from "@/services/conversations";
import { listDocuments } from "@/services/documents";
import { cn } from "@/lib/utils";

function TranscriptSkeleton() {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-8 px-4 py-8 sm:px-6" aria-busy="true" aria-label="Loading conversation">
      <div className="flex justify-end">
        <Skeleton className="h-10 w-2/3 rounded-2xl" />
      </div>
      <div className="flex gap-3">
        <Skeleton className="size-7 rounded-lg" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-1/4" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-11/12" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="mt-3 h-24 w-full rounded-xl" />
        </div>
      </div>
    </div>
  );
}

export function ChatWorkspace({
  conversationId,
  onConversationCreated,
}: {
  conversationId: string | null;
  onConversationCreated: (id: string) => void;
}) {
  const { system } = useSystemInfo();
  const { access, can } = useSession();
  const diagnostics = can("diagnostics.view");
  const canUpload = can("documents.manage");
  const allowed = accessibleClassifications(access);
  const accessNote = allowed.length > 0 ? `You can access: ${allowed.join(", ")} documents` : undefined;
  const { refresh: refreshConversations, rename, remove } = useConversations();
  const { startNewChat } = useShell();
  const [model, setModel] = useLocalStorageState<string | null>("riva.chat.model", null);

  const chat = useChatController({
    conversationId,
    model,
    onConversationCreated,
    onTurnComplete: refreshConversations,
    diagnostics,
  });
  const { items, setScope, scope } = chat;

  const docs = useApiQuery("chat:documents", (signal) => listDocuments({}, signal));
  const cols = useApiQuery("chat:collections", (signal) => listCollections(signal));
  const empty = items.length === 0;
  const suggestions = useApiQuery(empty ? "chat:suggestions" : null, (signal) => getSuggestions(signal));

  const attachments = useAttachments({
    system,
    collectionId: scope.collectionId,
    onDocumentsAvailable: (ids) => {
      docs.refresh();
      // When answering from specific documents, include freshly uploaded ones.
      setScope((s) =>
        s.documentIds.length > 0 ? { ...s, documentIds: Array.from(new Set([...s.documentIds, ...ids])) } : s,
      );
    },
  });

  const [draft, setDraft] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<{ key: string; chunkId: string } | null>(null);

  const [panelOpen, setPanelOpen] = useLocalStorageState<boolean>("riva.contextPanel.open", true);
  const isDesktop = useMediaQuery(DESKTOP_PANEL_QUERY);
  const [mobilePanelOpen, setMobilePanelOpen] = useState(false);

  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const effectiveFocusKey = useMemo(() => {
    if (focusedKey && items.some((i) => i.key === focusedKey)) return focusedKey;
    return lastAssistantKey(items);
  }, [focusedKey, items]);
  const focusedItem = items.find((i) => i.key === effectiveFocusKey) ?? null;

  const activeConversationId = conversationId ?? chat.conversation?.id ?? null;
  const title = chat.conversation?.title || (empty ? "New conversation" : "Untitled conversation");

  const submit = useCallback(() => {
    const text = draft.trim();
    if (!text || chat.isStreaming) return;
    chat.send(text);
    setDraft("");
    setFocusedKey(null);
    setHighlight(null);
  }, [draft, chat]);

  const openPanel = useCallback(() => {
    if (window.matchMedia(DESKTOP_PANEL_QUERY).matches) setPanelOpen(true);
    else setMobilePanelOpen(true);
  }, [setPanelOpen]);

  const togglePanel = () => {
    if (window.matchMedia(DESKTOP_PANEL_QUERY).matches) setPanelOpen(!panelOpen);
    else setMobilePanelOpen((o) => !o);
  };

  const onCitationSelect = useCallback(
    (key: string, target: CitationTarget) => {
      setFocusedKey(key);
      setHighlight({ key, chunkId: target.chunkId });
      // Without diagnostics the panel has no source list; the chip's popover already shows the passage.
      if (diagnostics) openPanel();
    },
    [openPanel, diagnostics],
  );

  const onFocusMessage = useCallback((key: string) => setFocusedKey(key), []);
  const { regenerate, setFeedback, setEvaluations } = chat;
  const onEvaluationsChange = useCallback(
    (messageId: string, evals: EvaluationOut[]) => setEvaluations(messageId, evals),
    [setEvaluations],
  );

  const pickPrompt = (prompt: string) => {
    setDraft(prompt);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      }
    });
  };

  const documents = docs.data ?? [];
  const collections = cols.data ?? [];

  const panel = (onClose: () => void) => (
    <ContextPanel
      scope={scope}
      documents={documents}
      collections={collections}
      focused={focusedItem}
      highlightChunkId={highlight && highlight.key === effectiveFocusKey ? highlight.chunkId : null}
      onClose={onClose}
      diagnostics={diagnostics}
      accessNote={accessNote}
    />
  );

  let body: ReactNode;
  if (chat.loadState.status === "error") {
    body = (
      <div className="mx-auto w-full max-w-3xl px-4 py-10">
        <QueryError error={chat.loadState.error} onRetry={chat.reload} title="Couldn't load this conversation" />
      </div>
    );
  } else if (chat.loadState.status === "loading") {
    body = (
      <div className="min-h-0 flex-1 overflow-hidden">
        <TranscriptSkeleton />
      </div>
    );
  } else if (empty) {
    body = (
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
        <WelcomeScreen suggestions={suggestions.data?.questions ?? []} onPick={pickPrompt} accessNote={accessNote} />
      </div>
    );
  } else {
    body = (
      <MessageList
        items={items}
        focusedKey={effectiveFocusKey}
        highlight={highlight}
        busy={chat.isStreaming}
        diagnostics={diagnostics}
        onFocus={onFocusMessage}
        onRegenerate={regenerate}
        onFeedback={setFeedback}
        onEvaluationsChange={onEvaluationsChange}
        onCitationSelect={onCitationSelect}
      />
    );
  }

  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col">
        <ConversationHeader
          title={title}
          hasConversation={Boolean(activeConversationId)}
          panelOpen={isDesktop ? panelOpen : mobilePanelOpen}
          onTogglePanel={togglePanel}
          onRename={() => setRenameOpen(true)}
          onDelete={() => setDeleteOpen(true)}
          onExport={(format) => {
            if (!activeConversationId) return;
            exportConversation(activeConversationId, format).then(
              () => toast.success(`Exported as ${format === "markdown" ? "Markdown" : "JSON"}`),
              (err: unknown) => notifyError(err),
            );
          }}
        />

        {body}

        <div className={cn("shrink-0 px-3 pt-2 pb-3 sm:px-6", empty && "pb-6")}>
          <div className="mx-auto w-full max-w-3xl">
            <Composer
              value={draft}
              onChange={setDraft}
              onSubmit={submit}
              onStop={chat.stop}
              isStreaming={chat.isStreaming}
              textareaRef={textareaRef}
              attachments={attachments.attachments}
              onAttachFiles={canUpload ? (files) => void attachments.upload(files) : undefined}
              onRemoveAttachment={attachments.remove}
              supportedExtensions={system?.supported_extensions}
              maxUploadMb={system?.max_upload_mb}
              toolbar={
                <>
                  <ScopePicker
                    scope={scope}
                    onChange={setScope}
                    documents={documents}
                    collections={collections}
                    loading={docs.isLoading || cols.isLoading}
                    accessNote={accessNote}
                    onOpen={() => {
                      docs.refresh();
                      cols.refresh();
                    }}
                  />
                  <ModelSelect
                    value={model}
                    onChange={setModel}
                    models={system?.available_models ?? []}
                    defaultModel={system?.default_model ?? null}
                    disabled={!system}
                  />
                </>
              }
            />
          </div>
        </div>
      </div>

      <aside
        aria-label="Context panel"
        className={cn("hidden w-[340px] shrink-0 border-l", panelOpen && "xl:flex xl:flex-col")}
      >
        {panel(() => setPanelOpen(false))}
      </aside>

      {!isDesktop && (
        <Sheet open={mobilePanelOpen} onOpenChange={setMobilePanelOpen}>
          <SheetContent side="right" className="w-[360px] max-w-[92vw] gap-0 p-0" showCloseButton={false}>
            <SheetTitle className="sr-only">Context</SheetTitle>
            <SheetDescription className="sr-only">Scope, sources, quality and performance for the focused answer</SheetDescription>
            {panel(() => setMobilePanelOpen(false))}
          </SheetContent>
        </Sheet>
      )}

      <RenameDialog
        open={renameOpen}
        onOpenChange={setRenameOpen}
        initialTitle={chat.conversation?.title ?? ""}
        onSubmit={async (newTitle) => {
          if (!activeConversationId) return;
          try {
            await rename(activeConversationId, newTitle);
            chat.setConversation((c) => (c ? { ...c, title: newTitle } : c));
            toast.success("Conversation renamed");
          } catch (err) {
            notifyError(err);
            throw err;
          }
        }}
      />
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete conversation?"
        description="This conversation and all of its messages, evaluations and feedback will be permanently deleted."
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          if (!activeConversationId) return;
          try {
            await remove(activeConversationId);
            toast.success("Conversation deleted");
            startNewChat();
          } catch (err) {
            notifyError(err);
          }
        }}
      />
    </div>
  );
}
