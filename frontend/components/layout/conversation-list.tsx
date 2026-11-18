"use client";

import { MessageSquare, MoreHorizontal, Pencil, Search, Trash2, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { useConversations } from "@/components/providers/conversations-provider";
import { useShell } from "@/components/providers/shell-provider";
import { RenameDialog } from "@/components/layout/rename-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { formatRelativeTime } from "@/lib/format";
import { notifyError } from "@/lib/notify";
import type { ConversationOut } from "@/lib/types";
import { cn } from "@/lib/utils";

export function ConversationList({ onNavigate }: { onNavigate?: () => void }) {
  const { conversations, isLoading, error, query, setQuery, rename, remove } = useConversations();
  const { startNewChat } = useShell();
  const pathname = usePathname();
  const activeId = pathname.startsWith("/c/") ? decodeURIComponent(pathname.slice(3).split("/")[0]) : null;

  const [renaming, setRenaming] = useState<ConversationOut | null>(null);
  const [deleting, setDeleting] = useState<ConversationOut | null>(null);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-3 pb-2">
        <label htmlFor="conversation-search" className="sr-only">
          Search conversations
        </label>
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            id="conversation-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search conversations"
            className="h-8 border-white/20 bg-white/10 pr-7 pl-8 text-[13px] text-white placeholder:text-white/75 focus-visible:border-white/50 focus-visible:ring-white/25"
            autoComplete="off"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="absolute top-1/2 right-1.5 flex size-5 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              aria-label="Clear search"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
      </div>

      <p className="px-4 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        {query.trim() ? "Results" : "Recent"}
      </p>

      <nav aria-label="Conversations" className="min-h-0 flex-1 overflow-y-auto px-2 pb-2 scrollbar-thin">
        {isLoading && !conversations && (
          <div className="space-y-1.5 px-2 py-1" aria-hidden>
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full rounded-lg" />
            ))}
          </div>
        )}
        {error !== undefined && !conversations && (
          <p className="px-2 py-3 text-xs text-muted-foreground">Couldn&apos;t load conversations.</p>
        )}
        {conversations && conversations.length === 0 && (
          <p className="px-2 py-3 text-xs text-muted-foreground">
            {query.trim() ? "No conversations match your search." : "No conversations yet. Ask your first question."}
          </p>
        )}
        <ul className="space-y-0.5">
          {conversations?.map((c) => {
            const active = c.id === activeId;
            return (
              <li key={c.id} className="group/item relative">
                <Link
                  href={`/c/${c.id}`}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  title={c.last_message_preview ?? c.title}
                  className={cn(
                    "flex h-9 items-center gap-2 rounded-lg pr-8 pl-2.5 text-[13px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                    active
                      ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                      : "text-sidebar-foreground/90 hover:bg-white/10 hover:text-white",
                  )}
                >
                  <MessageSquare className="size-3.5 shrink-0 opacity-60" aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{c.title || "Untitled conversation"}</span>
                  <span className="shrink-0 text-[10px] text-muted-foreground group-hover/item:hidden group-focus-within/item:hidden">
                    {formatRelativeTime(c.updated_at)}
                  </span>
                </Link>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      className="absolute top-1/2 right-1.5 -translate-y-1/2 opacity-0 group-hover/item:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
                      aria-label={`Actions for ${c.title || "conversation"}`}
                    >
                      <MoreHorizontal />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-40">
                    <DropdownMenuItem onSelect={() => setRenaming(c)}>
                      <Pencil /> Rename
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(c)}>
                      <Trash2 /> Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </li>
            );
          })}
        </ul>
      </nav>

      <RenameDialog
        open={renaming !== null}
        onOpenChange={(o) => !o && setRenaming(null)}
        initialTitle={renaming?.title ?? ""}
        onSubmit={async (title) => {
          if (!renaming) return;
          try {
            await rename(renaming.id, title);
            toast.success("Conversation renamed");
          } catch (err) {
            notifyError(err);
            throw err;
          }
        }}
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete conversation?"
        description={`“${deleting?.title || "Untitled conversation"}” and all of its messages will be permanently deleted.`}
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          if (!deleting) return;
          try {
            await remove(deleting.id);
            toast.success("Conversation deleted");
            if (deleting.id === activeId) startNewChat();
          } catch (err) {
            notifyError(err);
          }
        }}
      />
    </div>
  );
}
