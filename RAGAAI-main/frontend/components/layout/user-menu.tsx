"use client";

import { ChevronsUpDown, LogOut, MessageSquareText, Settings, ShieldCheck } from "lucide-react";
import Link from "next/link";

import { ClassificationBadge, RoleBadge } from "@/components/access/access-badges";
import { useSession } from "@/components/providers/session-provider";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { initials } from "@/lib/format";
import { roleLabel } from "@/lib/permissions";

/** Account menu at the bottom of either portal's sidebar: identity, role + clearance, portal switch, logout. */
export function UserMenu({ onNavigate, portal = "user" }: { onNavigate?: () => void; portal?: "user" | "admin" }) {
  const { me, access, can, logout } = useSession();
  const name = me.user.full_name || me.user.email;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center gap-2.5 rounded-lg p-2 text-left text-white outline-none transition-colors hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-sidebar-ring data-[state=open]:bg-white/10"
          aria-label="Account menu"
        >
          <Avatar className="size-8">
            <AvatarFallback className="bg-white text-xs font-semibold text-purple-800">{initials(name)}</AvatarFallback>
          </Avatar>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium">{name}</span>
            <span className="block truncate text-[11px] text-white/85">
              {roleLabel(access.role)} · {access.clearance} clearance
            </span>
          </span>
          <ChevronsUpDown className="size-3.5 shrink-0 text-white/80" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-64">
        <DropdownMenuLabel className="font-normal">
          <span className="block truncate text-sm font-medium text-foreground">{me.user.full_name || "Signed in"}</span>
          <span className="block truncate text-xs text-muted-foreground">{me.user.email}</span>
          <span className="mt-2 flex flex-wrap items-center gap-1.5">
            <RoleBadge role={access.role} />
            <ClassificationBadge value={access.clearance} />
            <span className="text-[11px] text-muted-foreground">clearance</span>
          </span>
          <span className="mt-1.5 block truncate text-xs text-muted-foreground">{me.workspace.name}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {portal === "user" && access.admin_portal && (
          <DropdownMenuItem asChild>
            <Link href="/admin" onClick={onNavigate}>
              <ShieldCheck /> Admin portal
            </Link>
          </DropdownMenuItem>
        )}
        {portal === "admin" && (
          <DropdownMenuItem asChild>
            <Link href="/" onClick={onNavigate}>
              <MessageSquareText /> Open chat
            </Link>
          </DropdownMenuItem>
        )}
        {can("settings.manage") && (
          <DropdownMenuItem asChild>
            <Link href="/admin/settings" onClick={onNavigate}>
              <Settings /> Settings
            </Link>
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={() => void logout()}>
          <LogOut /> Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
