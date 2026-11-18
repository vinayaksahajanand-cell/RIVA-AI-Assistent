"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

interface ShellValue {
  /** Changes whenever the user explicitly starts a new conversation (forces a fresh chat view). */
  newChatNonce: number;
  startNewChat: () => void;
  mobileNavOpen: boolean;
  setMobileNavOpen: (open: boolean) => void;
}

const ShellContext = createContext<ShellValue | null>(null);

export function ShellProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [newChatNonce, setNonce] = useState(0);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const startNewChat = useCallback(() => {
    setNonce((n) => n + 1);
    setMobileNavOpen(false);
    router.push("/");
  }, [router]);

  const value = useMemo(
    () => ({ newChatNonce, startNewChat, mobileNavOpen, setMobileNavOpen }),
    [newChatNonce, startNewChat, mobileNavOpen],
  );
  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}

export function useShell(): ShellValue {
  const ctx = useContext(ShellContext);
  if (!ctx) throw new Error("useShell must be used inside <ShellProvider>");
  return ctx;
}
