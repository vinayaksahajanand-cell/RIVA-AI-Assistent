/**
 * Typed HTTP core shared by every service module.
 *  - always `credentials: "include"` (httpOnly session cookie set by the backend)
 *  - non-2xx bodies are parsed as {"error": {code, message, details, request_id}}
 *  - 401 anywhere (except auth forms that opt out) redirects to the current portal's login page
 *    (/login, or /admin/login inside the admin portal) with ?next=<current path>
 */

import { API_URL } from "@/lib/config";
import type { ErrorDetail } from "@/lib/types";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Record<string, unknown>;
  readonly requestId: string | null;

  constructor(status: number, detail: Partial<ErrorDetail> & { message: string }) {
    super(detail.message);
    this.name = "ApiError";
    this.status = status;
    this.code = detail.code ?? "error";
    this.details = detail.details ?? {};
    this.requestId = detail.request_id ?? null;
  }
}

/** Thrown when the API cannot be reached at all (server down, CORS, DNS). */
export class NetworkError extends Error {
  constructor(message = `Cannot reach the RIVA API at ${API_URL}. Is the backend running?`) {
    super(message);
    this.name = "NetworkError";
  }
}

export function isAbortError(err: unknown): boolean {
  return (
    (err instanceof DOMException && err.name === "AbortError") ||
    (err instanceof Error && err.name === "AbortError")
  );
}

let redirecting = false;

/** Navigate to the portal's login page, preserving the current location for after sign-in. */
export function redirectToLogin(): void {
  if (typeof window === "undefined" || redirecting) return;
  const { pathname, search } = window.location;
  if (pathname.startsWith("/login") || pathname.startsWith("/register") || pathname.startsWith("/admin/login")) return;
  redirecting = true;
  const loginPath = pathname === "/admin" || pathname.startsWith("/admin/") ? "/admin/login" : "/login";
  const next = encodeURIComponent(`${pathname}${search}`);
  // Deliberate full navigation: a 401 must drop all in-memory client state.
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.assign(`${loginPath}?next=${next}`);
}

export type QueryValue = string | number | boolean | null | undefined;

export function buildUrl(path: string, query?: Record<string, QueryValue>): string {
  const url = `${API_URL}${path.startsWith("/") ? path : `/${path}`}`;
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === "") continue;
    params.set(k, String(v));
  }
  const qs = params.toString();
  return qs ? `${url}?${qs}` : url;
}

/** Turn a non-2xx response into an ApiError, tolerating non-JSON bodies. */
export async function toApiError(res: Response): Promise<ApiError> {
  let detail: Partial<ErrorDetail> & { message: string } = {
    message: res.statusText || `Request failed with status ${res.status}`,
  };
  try {
    const text = await res.text();
    if (text) {
      const body: unknown = JSON.parse(text);
      if (body && typeof body === "object") {
        const b = body as { error?: Partial<ErrorDetail>; detail?: unknown };
        if (b.error && typeof b.error.message === "string") {
          detail = { ...b.error, message: b.error.message };
        } else if (typeof b.detail === "string") {
          detail = { message: b.detail };
        }
      }
    }
  } catch {
    /* keep status-text fallback */
  }
  if (res.status === 413 && !detail.code) detail = { ...detail, code: "payload_too_large" };
  return new ApiError(res.status, detail);
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  query?: Record<string, QueryValue>;
  /** JSON body (serialized automatically). */
  json?: unknown;
  /** Raw body, e.g. FormData for uploads (Content-Type left to the browser). */
  body?: BodyInit;
  signal?: AbortSignal;
  headers?: Record<string, string>;
  /** Do not redirect on 401 (login/register forms show the message instead). */
  skipAuthRedirect?: boolean;
}

/** Low-level fetch with credentials, error envelope parsing and 401 handling. Returns the Response. */
export async function apiRequest(path: string, opts: RequestOptions = {}): Promise<Response> {
  const headers: Record<string, string> = { Accept: "application/json", ...opts.headers };
  let body = opts.body;
  if (opts.json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.json);
  }

  let res: Response;
  try {
    res = await fetch(buildUrl(path, opts.query), {
      method: opts.method ?? (body ? "POST" : "GET"),
      credentials: "include",
      headers,
      body,
      signal: opts.signal,
      cache: "no-store",
    });
  } catch (err) {
    if (isAbortError(err)) throw err;
    throw new NetworkError();
  }

  if (!res.ok) {
    const error = await toApiError(res);
    if (res.status === 401 && !opts.skipAuthRedirect) redirectToLogin();
    throw error;
  }
  return res;
}

/** JSON request helper. 204/empty bodies resolve to `undefined as T`. */
export async function apiFetch<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const res = await apiRequest(path, opts);
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

export function filenameFromDisposition(header: string | null): string | null {
  if (!header) return null;
  const star = /filename\*\s*=\s*(?:UTF-8'')?([^;]+)/i.exec(header);
  if (star) {
    try {
      return decodeURIComponent(star[1].trim().replace(/^"|"$/g, ""));
    } catch {
      /* fall through */
    }
  }
  const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(header);
  return plain ? plain[1].trim() : null;
}

/** Fetch a file with credentials and trigger a browser download. */
export async function downloadFile(
  path: string,
  query: Record<string, QueryValue> | undefined,
  fallbackName: string,
): Promise<void> {
  const res = await apiRequest(path, { query, headers: { Accept: "*/*" } });
  const blob = await res.blob();
  const name = filenameFromDisposition(res.headers.get("Content-Disposition")) ?? fallbackName;
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }
}

/** User-facing message for any thrown value. */
export function errorMessage(err: unknown, fallback = "Something went wrong. Please try again."): string {
  if (err instanceof ApiError || err instanceof NetworkError) return err.message;
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}
