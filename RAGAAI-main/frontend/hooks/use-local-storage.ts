"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";

/**
 * Per-viewer UI preferences in localStorage (e.g. context panel open/closed).
 * Every access is wrapped in try/catch: storage can be unavailable (private mode,
 * blocked site data) and the UI must still work with the default value.
 * Hydration-safe: the server snapshot is always the default.
 */

const listeners = new Set<() => void>();

function safeGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* storage unavailable — keep in-memory behaviour */
  }
}

const memory = new Map<string, string>();

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}

export function useLocalStorageState<T extends string | number | boolean | null>(
  key: string,
  defaultValue: T,
): [T, (value: T) => void] {
  const raw = useSyncExternalStore(
    subscribe,
    () => memory.get(key) ?? safeGet(key),
    () => null,
  );

  const value = useMemo<T>(() => {
    if (raw === null) return defaultValue;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return defaultValue;
    }
  }, [raw, defaultValue]);

  const setValue = useCallback(
    (next: T) => {
      const serialized = JSON.stringify(next);
      memory.set(key, serialized);
      safeSet(key, serialized);
      listeners.forEach((l) => l());
    },
    [key],
  );

  return [value, setValue];
}
