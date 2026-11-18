"use client";

import { Menu } from "lucide-react";
import type { ReactNode } from "react";

import { Logo } from "@/components/brand/logo";
import { LlmBanner } from "@/components/layout/llm-banner";
import { useShell } from "@/components/providers/shell-provider";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

export type PortalVariant = "user" | "admin";

/**
 * Left sidebar (permanent ≥ lg, drawer below) + main column. Shared by both portals; the
 * `sidebar` render prop receives an `onNavigate` callback that closes the mobile drawer.
 */
export function AppShell({
  children,
  sidebar,
  variant = "user",
}: {
  children: ReactNode;
  sidebar: (onNavigate?: () => void) => ReactNode;
  variant?: PortalVariant;
}) {
  const { mobileNavOpen, setMobileNavOpen } = useShell();
  const close = () => setMobileNavOpen(false);

  return (
    <div className={cn("flex h-dvh overflow-hidden", variant === "admin" ? "bg-riva-glow-admin" : "bg-background")}>
      <a
        href="#main-content"
        className="sr-only z-50 rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to content
      </a>

      <aside className="hidden w-[268px] shrink-0 lg:flex" aria-label="Sidebar">
        {sidebar()}
      </aside>

      <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <SheetContent side="left" className="w-[288px] max-w-[85vw] gap-0 border-0 p-0" showCloseButton={false}>
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SheetDescription className="sr-only">
            {variant === "admin" ? "Admin portal navigation" : "Conversations and app navigation"}
          </SheetDescription>
          {sidebar(close)}
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b bg-background px-3 lg:hidden">
          <Button variant="ghost" size="icon" onClick={() => setMobileNavOpen(true)} aria-label="Open navigation">
            <Menu />
          </Button>
          <Logo />
          {variant === "admin" && (
            <span className="rounded-full bg-purple-900 px-2 py-0.5 text-[10.5px] font-semibold tracking-wide text-white uppercase">
              Admin
            </span>
          )}
        </header>
        <LlmBanner />
        <main id="main-content" className="min-h-0 flex-1">
          {children}
        </main>
      </div>
    </div>
  );
}
