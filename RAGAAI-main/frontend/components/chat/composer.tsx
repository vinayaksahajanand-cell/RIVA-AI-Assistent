"use client";

import { ArrowUp, Paperclip, Square, Upload } from "lucide-react";
import { useLayoutEffect, useRef, useState, type DragEvent, type KeyboardEvent, type ReactNode, type RefObject } from "react";

import { AttachmentTray } from "@/components/chat/attachment-tray";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Attachment } from "@/hooks/use-attachments";
import { acceptAttribute } from "@/lib/uploads";
import { cn } from "@/lib/utils";

const MAX_LENGTH = 8000;
const MAX_HEIGHT = 240;

export interface ComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onStop: () => void;
  isStreaming: boolean;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  attachments: Attachment[];
  /** Omit to hide uploads (roles without documents.manage). */
  onAttachFiles?: (files: File[]) => void;
  onRemoveAttachment: (key: string) => void;
  supportedExtensions: readonly string[] | undefined;
  maxUploadMb: number | undefined;
  /** Scope picker + model selector, rendered in the toolbar. */
  toolbar: ReactNode;
  placeholder?: string;
}

/** Auto-growing question box: Enter sends, Shift+Enter adds a line; drag & drop or attach files. */
export function Composer({
  value,
  onChange,
  onSubmit,
  onStop,
  isStreaming,
  textareaRef,
  attachments,
  onAttachFiles,
  onRemoveAttachment,
  supportedExtensions,
  maxUploadMb,
  toolbar,
  placeholder = "Ask anything about your documents…",
}: ComposerProps) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);

  // Auto-grow the textarea with its content.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
    el.style.overflowY = el.scrollHeight > MAX_HEIGHT ? "auto" : "hidden";
  }, [value, textareaRef]);

  const canSend = value.trim().length > 0 && !isStreaming;

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (canSend) onSubmit();
    }
  }

  function hasFiles(e: DragEvent) {
    return Array.from(e.dataTransfer.types).includes("Files");
  }

  const limits = [
    supportedExtensions && supportedExtensions.length > 0
      ? supportedExtensions.map((x) => x.replace(/^\./, "").toUpperCase()).join(", ")
      : null,
    maxUploadMb ? `up to ${maxUploadMb} MB each` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div
      className="relative"
      onDragEnter={(e) => {
        if (!onAttachFiles || !hasFiles(e)) return;
        e.preventDefault();
        dragDepth.current += 1;
        setDragging(true);
      }}
      onDragOver={(e) => {
        if (onAttachFiles && hasFiles(e)) e.preventDefault();
      }}
      onDragLeave={(e) => {
        if (!onAttachFiles || !hasFiles(e)) return;
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) setDragging(false);
      }}
      onDrop={(e) => {
        if (!onAttachFiles || !hasFiles(e)) return;
        e.preventDefault();
        dragDepth.current = 0;
        setDragging(false);
        const files = Array.from(e.dataTransfer.files);
        if (files.length) onAttachFiles(files);
      }}
    >
      <div
        className={cn(
          "rounded-2xl border bg-background shadow-[0_1px_2px_rgba(16,24,40,0.04),0_8px_24px_-12px_rgba(109,40,217,0.18)] transition-shadow",
          "focus-within:border-ring/60 focus-within:ring-3 focus-within:ring-ring/20",
          dragging && "border-primary/60 ring-3 ring-primary/20",
        )}
      >
        <AttachmentTray attachments={attachments} onRemove={onRemoveAttachment} />
        <label htmlFor="chat-composer" className="sr-only">
          Ask a question
        </label>
        <textarea
          id="chat-composer"
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          rows={1}
          maxLength={MAX_LENGTH}
          placeholder={placeholder}
          className="block max-h-[240px] min-h-[56px] w-full resize-none bg-transparent px-4 pt-4 pb-2 text-[15px] leading-relaxed outline-none placeholder:text-muted-foreground/80"
          aria-describedby="composer-hint"
        />
        <div className="flex items-center gap-1 px-2 pb-2">
          {onAttachFiles && (
            <>
              <input
                ref={fileInput}
                type="file"
                multiple
                hidden
                accept={acceptAttribute(supportedExtensions) || undefined}
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  e.target.value = "";
                  if (files.length) onAttachFiles(files);
                }}
              />
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="text-muted-foreground hover:text-foreground"
                    onClick={() => fileInput.current?.click()}
                    aria-label="Attach documents"
                  >
                    <Paperclip />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Upload documents{limits ? ` (${limits})` : ""}</TooltipContent>
              </Tooltip>
            </>
          )}
          <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden">{toolbar}</div>
          {isStreaming ? (
            <Button
              type="button"
              size="icon"
              variant="outline"
              onClick={onStop}
              aria-label="Stop generating"
              className="rounded-full"
            >
              <Square className="size-3.5 fill-current" />
            </Button>
          ) : (
            <Button
              type="button"
              size="icon"
              onClick={onSubmit}
              disabled={!canSend}
              aria-label="Send message"
              className="rounded-full shadow-sm shadow-primary/25"
            >
              <ArrowUp />
            </Button>
          )}
        </div>
      </div>

      {dragging && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-2xl border-2 border-dashed border-primary/50 bg-accent/80 text-sm font-medium text-accent-foreground backdrop-blur-[1px]">
          <Upload className="mr-2 size-4" aria-hidden /> Drop files to upload and index
        </div>
      )}

      <p id="composer-hint" className="mt-2 px-1 text-center text-[11px] text-muted-foreground">
        Enter to send · Shift + Enter for a new line · Answers cite your documents; verify important details.
      </p>
    </div>
  );
}
