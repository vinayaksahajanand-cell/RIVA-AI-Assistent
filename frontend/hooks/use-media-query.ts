"use client";

import { useCallback, useSyncExternalStore } from "react";

/** Reactive `matchMedia`; returns `false` during SSR/hydration. */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (cb: () => void) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", cb);
      return () => mql.removeEventListener("change", cb);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** Tailwind `xl` breakpoint — the right context panel docks inline from here up. */
export const DESKTOP_PANEL_QUERY = "(min-width: 1280px)";
/** Tailwind `lg` breakpoint — the left sidebar is permanent from here up. */
export const DESKTOP_SIDEBAR_QUERY = "(min-width: 1024px)";
