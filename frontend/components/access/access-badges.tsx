import { Lock, Shield, ShieldCheck, ShieldHalf } from "lucide-react";

import { classificationLabel, roleLabel } from "@/lib/permissions";
import { cn } from "@/lib/utils";

const CLASSIFICATION_STYLES: Record<string, string> = {
  public: "bg-emerald-50 text-emerald-800 ring-emerald-200/80",
  internal: "bg-violet-50 text-violet-800 ring-violet-200/80",
  confidential: "bg-amber-50 text-amber-900 ring-amber-200/80",
  restricted: "bg-red-50 text-red-800 ring-red-200/80",
};

/** Document sensitivity label: public < internal < confidential < restricted. */
export function ClassificationBadge({ value, className }: { value: string; className?: string }) {
  const sensitive = value === "confidential" || value === "restricted";
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1 rounded-full px-2 text-[11px] font-medium whitespace-nowrap ring-1 ring-inset",
        CLASSIFICATION_STYLES[value] ?? "bg-muted text-muted-foreground ring-border",
        className,
      )}
    >
      {sensitive && <Lock className="size-3" aria-hidden />}
      {classificationLabel(value)}
    </span>
  );
}

const ROLE_STYLES: Record<string, string> = {
  admin: "bg-purple-700 text-white ring-purple-800",
  manager: "bg-violet-100 text-violet-900 ring-violet-300/80",
  user: "bg-slate-100 text-slate-700 ring-slate-200",
};

const ROLE_ICONS = { admin: ShieldCheck, manager: ShieldHalf, user: Shield } as const;

export function RoleBadge({ role, className }: { role: string; className?: string }) {
  const Icon = ROLE_ICONS[role as keyof typeof ROLE_ICONS] ?? Shield;
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1 rounded-full px-2 text-[11px] font-medium whitespace-nowrap ring-1 ring-inset",
        ROLE_STYLES[role] ?? "bg-muted text-muted-foreground ring-border",
        className,
      )}
    >
      <Icon className="size-3" aria-hidden />
      {roleLabel(role)}
    </span>
  );
}
