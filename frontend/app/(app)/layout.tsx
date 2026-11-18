import type { ReactNode } from "react";

import { UserPortalShell } from "@/components/layout/portal-shells";
import { ConversationsProvider } from "@/components/providers/conversations-provider";
import { SessionProvider } from "@/components/providers/session-provider";
import { ShellProvider } from "@/components/providers/shell-provider";
import { SystemProvider } from "@/components/providers/system-provider";

/** User portal ("/", "/c/[id]", "/library"). */
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <SystemProvider>
        <ConversationsProvider>
          <ShellProvider>
            <UserPortalShell>{children}</UserPortalShell>
          </ShellProvider>
        </ConversationsProvider>
      </SystemProvider>
    </SessionProvider>
  );
}
