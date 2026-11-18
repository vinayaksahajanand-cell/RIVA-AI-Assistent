/** Backend base URL, inlined at build time (Docker build arg NEXT_PUBLIC_API_URL). */
export const API_URL: string = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8100").replace(/\/+$/, "");

export const APP_NAME = "RIVA AI";
export const APP_FULL_NAME = "Research, Intelligence & Virtual Assistant";
export const APP_TAGLINE = "Your Intelligent Document Research Partner";

/** Poll interval for documents that are uploaded/processing/updating. */
export const DOCUMENT_POLL_MS = 2000;
/** Poll interval for queued/running benchmark runs. */
export const RUN_POLL_MS = 3000;

export const IN_PROGRESS_DOCUMENT_STATUSES: ReadonlySet<string> = new Set(["uploaded", "processing", "updating"]);
export const ACTIVE_RUN_STATUSES: ReadonlySet<string> = new Set(["queued", "running", "pending"]);

/** Only allow same-origin relative redirect targets (prevents open redirects via ?next=). */
export function safeNextPath(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return "/";
  if (next.startsWith("/login") || next.startsWith("/register") || next.startsWith("/admin/login")) return "/";
  return next;
}
