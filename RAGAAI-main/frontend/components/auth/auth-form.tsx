"use client";

import { Eye, EyeOff, Loader2, ShieldCheck, ShieldOff } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useId, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { LogoMark } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { APP_TAGLINE, safeNextPath } from "@/lib/config";
import { postLoginPath } from "@/lib/permissions";
import type { Portal } from "@/lib/types";
import { getMe, login, register } from "@/services/auth";
import { ApiError, errorMessage } from "@/services/http";

type Mode = "login" | "register";

/**
 * Sign-in / registration for both portals. `portal="admin"` sends `portal: "admin"` to the API, which
 * answers 403 (and sets no session) for accounts without the admin_portal permission.
 */
export function AuthForm({ mode, portal = "user" }: { mode: Mode; portal?: Portal }) {
  const router = useRouter();
  const params = useSearchParams();
  const rawNext = params.get("next");
  const next = safeNextPath(rawNext);
  const ids = useId();
  const isAdmin = portal === "admin";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  /** The admin portal refused this account (403). */
  const [denied, setDenied] = useState<string | null>(null);
  /** Already signed in to the user portal with an account that cannot open the admin portal. */
  const [signedInAs, setSignedInAs] = useState<string | null>(null);

  // Already signed in? Skip the form (admin portal: only when the session may open it).
  useEffect(() => {
    const controller = new AbortController();
    getMe({ signal: controller.signal, skipAuthRedirect: true }).then(
      (me) => {
        if (portal === "admin" && !me.access?.admin_portal) {
          setSignedInAs(me.user.email);
          return;
        }
        router.replace(postLoginPath(portal, me.access, rawNext));
      },
      () => {},
    );
    return () => controller.abort();
  }, [router, rawNext, portal]);

  const isRegister = mode === "register";
  const passwordTooShort = isRegister && password.length > 0 && password.length < 8;

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;
    setFormError(null);
    setDenied(null);
    if (isRegister && password.length < 8) {
      setFormError("Password must be at least 8 characters.");
      return;
    }
    setSubmitting(true);
    try {
      const res = isRegister
        ? await register({ email: email.trim(), password, full_name: fullName.trim() })
        : await login({ email: email.trim(), password, portal });
      if (isRegister) toast.success("Account created. Welcome to RIVA AI!");
      router.replace(postLoginPath(isRegister ? "user" : portal, res.access, rawNext));
    } catch (err) {
      const message = errorMessage(err);
      if (isAdmin && err instanceof ApiError && err.status === 403) {
        setDenied(message);
      } else {
        setFormError(message);
        toast.error(message);
      }
      setSubmitting(false);
    }
  }

  return (
    <div className="rounded-2xl border bg-card/95 p-6 shadow-[0_1px_2px_rgba(16,24,40,0.04),0_12px_32px_-12px_rgba(109,40,217,0.18)] backdrop-blur sm:p-8">
      <div className="mb-6 flex flex-col items-center text-center">
        <LogoMark className="mb-4 size-11" />
        {isAdmin && (
          <span className="mb-2 inline-flex items-center gap-1 rounded-full bg-purple-900 px-2.5 py-0.5 text-[11px] font-semibold tracking-wide text-white uppercase">
            <ShieldCheck className="size-3" aria-hidden /> Admin portal
          </span>
        )}
        <h1 className="text-xl font-semibold tracking-tight">
          {isRegister ? "Create your RIVA AI account" : isAdmin ? "Sign in to RIVA AI Admin" : "Sign in to RIVA AI"}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {isAdmin ? "Manage documents, users, security and quality." : APP_TAGLINE}
        </p>
      </div>

      {signedInAs && !denied && (
        <p className="mb-4 rounded-lg bg-accent/60 px-3 py-2 text-[13px] text-accent-foreground ring-1 ring-violet-200/70 ring-inset">
          You&apos;re signed in as <span className="font-medium">{signedInAs}</span>, which can&apos;t open the admin portal.{" "}
          <Link href="/" className="font-medium underline underline-offset-4">
            Go to chat
          </Link>{" "}
          or sign in with an admin account below.
        </p>
      )}

      {denied && (
        <div role="alert" className="mb-4 flex items-start gap-2.5 rounded-xl bg-amber-50 px-3.5 py-3 text-[13px] text-amber-950 ring-1 ring-amber-200/80 ring-inset">
          <ShieldOff className="mt-0.5 size-4 shrink-0 text-amber-700" aria-hidden />
          <div className="space-y-1">
            <p className="font-semibold">This account doesn&apos;t have admin access</p>
            <p>{denied}</p>
            <Link href="/login" className="inline-block font-medium text-primary underline-offset-4 hover:underline">
              Sign in to the user portal instead
            </Link>
          </div>
        </div>
      )}

      <form onSubmit={onSubmit} className="space-y-4" noValidate={false}>
        {isRegister && (
          <div className="space-y-1.5">
            <Label htmlFor={`${ids}-name`}>Full name</Label>
            <Input
              id={`${ids}-name`}
              autoComplete="name"
              maxLength={200}
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Ada Lovelace"
              className="h-10"
            />
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor={`${ids}-email`}>Email</Label>
          <Input
            id={`${ids}-email`}
            type="email"
            required
            autoComplete="email"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
            className="h-10"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${ids}-password`}>Password</Label>
          <div className="relative">
            <Input
              id={`${ids}-password`}
              type={showPassword ? "text" : "password"}
              required
              minLength={isRegister ? 8 : 1}
              maxLength={128}
              autoComplete={isRegister ? "new-password" : "current-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={passwordTooShort || undefined}
              aria-describedby={isRegister ? `${ids}-password-hint` : undefined}
              className="h-10 pr-10"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-lg text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={showPassword ? "Hide password" : "Show password"}
              aria-pressed={showPassword}
            >
              {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
          {isRegister && (
            <p id={`${ids}-password-hint`} className={passwordTooShort ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>
              At least 8 characters.
            </p>
          )}
        </div>

        {formError && (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-inset ring-red-200/70">
            {formError}
          </p>
        )}

        <Button type="submit" className="h-10 w-full text-sm" disabled={submitting}>
          {submitting && <Loader2 className="animate-spin" />}
          {isRegister ? "Create account" : "Sign in"}
        </Button>
      </form>

      {isAdmin ? (
        <p className="mt-6 text-center text-sm text-muted-foreground">
          Not an admin?{" "}
          <Link href="/login" className="font-medium text-primary underline-offset-4 hover:underline">
            Go to the user portal
          </Link>
        </p>
      ) : (
        <>
          <p className="mt-6 text-center text-sm text-muted-foreground">
            {isRegister ? "Already have an account? " : "New to RIVA AI? "}
            <Link
              href={`${isRegister ? "/login" : "/register"}${next !== "/" ? `?next=${encodeURIComponent(next)}` : ""}`}
              className="font-medium text-primary underline-offset-4 hover:underline"
            >
              {isRegister ? "Sign in" : "Create an account"}
            </Link>
          </p>
          {!isRegister && (
            <p className="mt-2 text-center text-xs text-muted-foreground">
              Administrator?{" "}
              <Link href="/admin/login" className="font-medium text-primary underline-offset-4 hover:underline">
                Sign in to the admin portal
              </Link>
            </p>
          )}
        </>
      )}
    </div>
  );
}
