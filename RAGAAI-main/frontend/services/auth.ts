import { apiFetch } from "@/services/http";
import type { AuthResponse, LoginRequest, MeResponse, OkResponse, RegisterRequest } from "@/lib/types";

export function login(body: LoginRequest): Promise<AuthResponse> {
  return apiFetch<AuthResponse>("/api/auth/login", { method: "POST", json: body, skipAuthRedirect: true });
}

export function register(body: RegisterRequest): Promise<AuthResponse> {
  return apiFetch<AuthResponse>("/api/auth/register", { method: "POST", json: body, skipAuthRedirect: true });
}

export function logout(): Promise<OkResponse> {
  return apiFetch<OkResponse>("/api/auth/logout", { method: "POST", skipAuthRedirect: true });
}

/** Current session. Pass `skipAuthRedirect` to probe without redirecting (e.g. on /login). */
export function getMe(opts: { signal?: AbortSignal; skipAuthRedirect?: boolean } = {}): Promise<MeResponse> {
  return apiFetch<MeResponse>("/api/auth/me", opts);
}
