import { toast } from "sonner";

import { ApiError, errorMessage, isAbortError } from "@/services/http";

/** Show an API/network error as a toast. 401s are silent (the client is already redirecting). */
export function notifyError(err: unknown, fallback?: string): void {
  if (isAbortError(err)) return;
  if (err instanceof ApiError && err.status === 401) return;
  const description = err instanceof ApiError && err.requestId ? `Request ID: ${err.requestId}` : undefined;
  toast.error(errorMessage(err, fallback), { description });
}
