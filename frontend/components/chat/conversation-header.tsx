"use client";

import { Download, MoreHorizontal, PanelRightClose, PanelRightOpen, Pencil, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function ConversationHeader({
  title,
  hasConversation,
  panelOpen,
  onTogglePanel,
  onRename,
  onDelete,
  onExport,
}: {
  title: string;
  hasConversation: boolean;
  panelOpen: boolean;
  onTogglePanel: () => void;
  onRename: () => void;
  onDelete: () => void;
  onExport: (format: "markdown" | "json") => void;
}) {
  return (
    <div className="flex h-12 shrink-0 items-center gap-2 border-b px-3 sm:px-4">
      <h1 className="min-w-0 flex-1 truncate text-[14px] font-medium" title={title}>
        {title}
      </h1>
      {hasConversation && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="Conversation options">
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem onSelect={onRename}>
              <Pencil /> Rename
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Export conversation</DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => onExport("markdown")}>
              <Download /> Markdown (.md)
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onExport("json")}>
              <Download /> JSON (.json)
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={onDelete}>
              <Trash2 /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onTogglePanel}
            aria-pressed={panelOpen}
            aria-label={panelOpen ? "Hide context panel" : "Show context panel"}
          >
            {panelOpen ? <PanelRightClose /> : <PanelRightOpen />}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{panelOpen ? "Hide context panel" : "Show context panel"}</TooltipContent>
      </Tooltip>
    </div>
  );
}
