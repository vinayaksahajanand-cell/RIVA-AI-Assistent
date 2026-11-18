"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { isAbortError } from "@/services/http";

export type RefetchInterval<T> = number | false | ((data: T | undefined) => number | false);

export interface ApiQueryOptions<T> {
  /** Poll interval in ms, or a function deciding from the latest data (false = stop). */
  refetchInterval?: RefetchInterval<T>;
  /** Keep showing the previous key's data while the next key loads (search-as-you-type). */
  keepPreviousData?: boolean;
}

export interface ApiQueryResult<T> {
  data: T | undefined;
  error: unknown;
  /** True until the first response for the current key settles. */
  isLoading: boolean;
  /** Re-run the fetcher now. */
  refresh: () => void;
  /** Locally update cached data (optimistic updates). */
  mutate: (updater: (prev: T | undefined) => T | undefined) => void;
}

interface QueryState<T> {
  key: string | null;
  data: T | undefined;
  error: unknown;
}

/**
 * Minimal data-fetching hook: keyed requests with abort-on-change, manual refresh,
 * optimistic mutation and optional polling. `key = null` disables the query.
 */
export function useApiQuery<T>(
  key: string | null,
  fetcher: (signal: AbortSignal) => Promise<T>,
  options: ApiQueryOptions<T> = {},
): ApiQueryResult<T> {
  const [state, setState] = useState<QueryState<T>>({ key: null, data: undefined, error: undefined });
  const [tick, setTick] = useState(0);

  const fetcherRef = useRef(fetcher);
  const intervalRef = useRef(options.refetchInterval);
  useEffect(() => {
    fetcherRef.current = fetcher;
    intervalRef.current = options.refetchInterval;
  });

  useEffect(() => {
    if (key === null) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;

    const schedule = (data: T | undefined, failed: boolean) => {
      const iv = intervalRef.current;
      const ms = typeof iv === "function" ? (failed ? false : iv(data)) : iv;
      if (ms && ms > 0 && !controller.signal.aborted) {
        timer = setTimeout(() => setTick((t) => t + 1), failed ? Math.max(ms, 5000) : ms);
      }
    };

    fetcherRef.current(controller.signal).then(
      (data) => {
        if (controller.signal.aborted) return;
        setState({ key, data, error: undefined });
        schedule(data, false);
      },
      (error: unknown) => {
        if (controller.signal.aborted || isAbortError(error)) return;
        setState((prev) => ({ key, data: prev.key === key ? prev.data : undefined, error }));
        schedule(undefined, true);
      },
    );

    return () => {
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [key, tick]);

  const refresh = useCallback(() => setTick((t) => t + 1), []);
  const mutate = useCallback(
    (updater: (prev: T | undefined) => T | undefined) =>
      setState((prev) => ({ ...prev, data: updater(prev.data) })),
    [],
  );

  const settled = key !== null && state.key === key;
  const data = settled || options.keepPreviousData ? state.data : undefined;
  return {
    data,
    error: settled ? state.error : undefined,
    isLoading: key !== null && !settled,
    refresh,
    mutate,
  };
}
