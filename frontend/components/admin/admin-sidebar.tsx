"use client";

import {
  FlaskConical,
  FolderOpen,
  LayoutDashboard,
  MessageSquareText,
  ScrollText,
  Settings,
  ShieldCheck,
  Users,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { Logo } from "@/components/brand/logo";
import { sidebarLinkClass } from "@/components/layout/app-sidebar";
import { UserMenu } from "@/components/layout/user-menu";
import { useSession } from "@/components/providers/session-provider";
import { adminRoutesFor } from "@/lib/permissions";
import { cn } from "@/lib/utils";

const ICONS: Record<string, LucideIcon> = {
  "/admin": LayoutDashboard,
  "/admin/documents": FolderOpen,
  "/admin/users": Users,
  "/admin/security": ShieldCheck,
  "/admin/audit": ScrollText,
  "/admin/evaluation": FlaskConical,
  "/admin/settings": Settings,
};

function isActive(href: string, pathname: string): boolean {
  return href === "/admin" ? pathname === "/admin" : pathname === href || pathname.startsWith(`${href}/`);
}

/** Admin portal sidebar (deep purple): only the sections the role may open. */
export function AdminSidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { access } = useSession();
  const routes = adminRoutesFor(access);

  return (
    <div className="riva-sidebar-admin flex h-full min-h-0 w-full flex-col text-sidebar-foreground">
      <div className="flex h-14 shrink-0 items-center gap-2 px-4">
        <Link
          href="/admin"
          onClick={onNavigate}
          className="rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
          aria-label="RIVA AI admin portal home"
        >
          <Logo inverted />
        </Link>
        <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-bold tracking-wider text-purple-900 uppercase">
          Admin
        </span>
      </div>

      <p className="px-4 pt-1 pb-2 text-[11px] font-medium tracking-wide text-white/85 uppercase">Administration</p>
      <nav aria-label="Admin" className="min-h-0 flex-1 overflow-y-auto px-2 pb-3 scrollbar-thin">
        <ul className="space-y-0.5">
          {routes.map((route) => {
            const active = isActive(route.href, pathname);
            const Icon = ICONS[route.href] ?? LayoutDashboard;
            return (
              <li key={route.href}>
                <Link
                  href={route.href}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  className={sidebarLinkClass(active)}
                >
                  <Icon className={cn("size-4", active ? "opacity-100" : "opacity-80")} aria-hidden />
                  {route.label}
                </Link>
              </li>
            );
          })}
        </ul>

        <div className="mx-2 my-3 h-px bg-sidebar-border" />

        <Link href="/" onClick={onNavigate} className={sidebarLinkClass(false)}>
          <MessageSquareText className="size-4 opacity-80" aria-hidden />
          Open chat
        </Link>
      </nav>

      <div className="shrink-0 border-t border-sidebar-border p-2">
        <UserMenu onNavigate={onNavigate} portal="admin" />
      </div>
    </div>
  );
}
