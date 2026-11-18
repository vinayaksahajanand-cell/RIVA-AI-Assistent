"use client";

import { Library, MessageSquareText, Plus, ShieldCheck, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { Logo } from "@/components/brand/logo";
import { ConversationList } from "@/components/layout/conversation-list";
import { UserMenu } from "@/components/layout/user-menu";
import { useSession } from "@/components/providers/session-provider";
import { useShell } from "@/components/providers/shell-provider";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  match: (pathname: string) => boolean;
}

const NAV: NavItem[] = [
  { href: "/", label: "Chat", icon: MessageSquareText, match: (p) => p === "/" || p.startsWith("/c/") },
  { href: "/library", label: "Library", icon: Library, match: (p) => p.startsWith("/library") },
];

/** Shared nav link styling for both portal sidebars (white text on purple). */
export function sidebarLinkClass(active: boolean): string {
  return cn(
    "flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-[13px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-sidebar-ring",
    active
      ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground shadow-[inset_0_0_0_1px_rgb(255_255_255/0.12)]"
      : "text-sidebar-foreground/90 hover:bg-white/10 hover:text-white",
  );
}

/** User portal sidebar: new chat, Library, conversations and (for admins/managers) the admin portal link. */
export function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { startNewChat } = useShell();
  const { access } = useSession();

  return (
    <div className="riva-sidebar-user flex h-full min-h-0 w-full flex-col text-sidebar-foreground">
      <div className="flex h-14 shrink-0 items-center px-4">
        <Link
          href="/"
          onClick={(e) => {
            e.preventDefault();
            startNewChat();
            onNavigate?.();
          }}
          className="rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
          aria-label="RIVA AI home"
        >
          <Logo inverted />
        </Link>
      </div>

      <div className="px-3 pb-3">
        <Button
          className="h-9 w-full justify-start gap-2 bg-white text-primary shadow-sm shadow-purple-950/20 hover:bg-violet-50"
          onClick={() => {
            startNewChat();
            onNavigate?.();
          }}
        >
          <Plus /> New conversation
        </Button>
      </div>

      <nav aria-label="Main" className="px-2 pb-3">
        <ul className="space-y-0.5">
          {NAV.map((item) => {
            const active = item.match(pathname);
            const Icon = item.icon;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  className={sidebarLinkClass(active)}
                >
                  <Icon className={cn("size-4", active ? "opacity-100" : "opacity-80")} aria-hidden />
                  {item.label}
                </Link>
              </li>
            );
          })}
          {access.admin_portal && (
            <li>
              <Link href="/admin" onClick={onNavigate} className={sidebarLinkClass(false)}>
                <ShieldCheck className="size-4 opacity-80" aria-hidden />
                Admin portal
              </Link>
            </li>
          )}
        </ul>
      </nav>

      <div className="mx-4 mb-3 h-px bg-sidebar-border" />

      <ConversationList onNavigate={onNavigate} />

      <div className="shrink-0 border-t border-sidebar-border p-2">
        <UserMenu onNavigate={onNavigate} portal="user" />
      </div>
    </div>
  );
}
