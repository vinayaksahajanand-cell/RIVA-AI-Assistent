"use client";

import { Check, FileLock2, KeyRound, Loader2, Minus, RotateCcw, Save, ShieldAlert, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";

import { ClassificationBadge, RoleBadge } from "@/components/access/access-badges";
import { ClassificationBars, GuardrailEventList, SummaryCard } from "@/components/admin/security-widgets";
import { PageContainer, PageHeader } from "@/components/common/page-header";
import { QueryError } from "@/components/common/query-error";
import { useSession } from "@/components/providers/session-provider";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useApiQuery } from "@/hooks/use-api-query";
import { notifyError } from "@/lib/notify";
import { classificationLabel } from "@/lib/permissions";
import {
  CLASSIFICATIONS,
  type Classification,
  type Permission,
  type SecurityOverview,
  type SecuritySettings,
  type WorkspaceSettings,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import { getSecurityOverview } from "@/services/admin";
import { ApiError } from "@/services/http";
import { getSettings, updateSettings } from "@/services/settings";

const PERMISSION_INFO: Array<{ key: Permission; label: string; hint: string }> = [
  { key: "chat", label: "Chat", hint: "Ask questions in the user portal" },
  { key: "documents.view", label: "List documents", hint: "See titles and metadata of accessible documents" },
  { key: "documents.read_content", label: "Read content", hint: "Preview indexed chunks" },
  { key: "documents.download", label: "Download", hint: "Open original files" },
  { key: "documents.manage", label: "Manage documents", hint: "Upload, classify, re-index, delete, collections" },
  { key: "analytics.view", label: "Analytics", hint: "Usage, latency and quality dashboards" },
  { key: "evaluation.view", label: "View evaluation", hint: "Benchmark runs and regression reports" },
  { key: "evaluation.run", label: "Run evaluation", hint: "Start benchmarks and set baselines" },
  { key: "diagnostics.view", label: "Diagnostics", hint: "Retrieved sources and RAGAS panels under answers" },
  { key: "users.manage", label: "Manage users", hint: "Create, change roles, deactivate, remove" },
  { key: "settings.manage", label: "Workspace settings", hint: "Retrieval, generation and security policy" },
  { key: "audit.view", label: "Audit log", hint: "Security and admin events" },
  { key: "pii.view", label: "Unredacted PII", hint: "See personal data and secrets without redaction" },
  { key: "admin_portal", label: "Admin portal", hint: "Sign in to /admin" },
];

function RoleMatrix({ data }: { data: SecurityOverview }) {
  return (
    <div className="overflow-x-auto rounded-xl border bg-background scrollbar-thin">
      <table className="w-full min-w-[620px] text-[13px]">
        <caption className="sr-only">Permissions and clearance by role</caption>
        <thead>
          <tr className="border-b bg-muted/40">
            <th scope="col" className="px-4 py-2.5 text-left font-medium text-muted-foreground">
              Permission
            </th>
            {data.roles.map((r) => (
              <th key={r.role} scope="col" className="px-3 py-2.5 text-center">
                <RoleBadge role={r.role} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr className="border-b bg-accent/30">
            <th scope="row" className="px-4 py-2 text-left font-medium">
              Clearance
              <span className="block text-[11.5px] font-normal text-muted-foreground">Highest classification retrievable</span>
            </th>
            {data.roles.map((r) => (
              <td key={r.role} className="px-3 py-2 text-center">
                <ClassificationBadge value={r.clearance} />
              </td>
            ))}
          </tr>
          <tr className="border-b">
            <th scope="row" className="px-4 py-2 text-left font-medium">
              Members
            </th>
            {data.roles.map((r) => (
              <td key={r.role} className="px-3 py-2 text-center tabular">
                {r.members}
              </td>
            ))}
          </tr>
          {PERMISSION_INFO.map((p) => (
            <tr key={p.key} className="border-b last:border-0">
              <th scope="row" className="px-4 py-2 text-left font-normal">
                <span className="font-medium">{p.label}</span>
                <span className="block text-[11.5px] text-muted-foreground">{p.hint}</span>
              </th>
              {data.roles.map((r) => {
                const has = r.permissions.includes(p.key);
                return (
                  <td key={r.role} className="px-3 py-2 text-center">
                    {has ? (
                      <Check className="mx-auto size-4 text-primary" aria-label="Allowed" />
                    ) : (
                      <Minus className="mx-auto size-4 text-muted-foreground/50" aria-label="Not allowed" />
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ClassificationSelect({ id, value, onChange, label }: {
  id: string;
  value: Classification;
  onChange: (v: Classification) => void;
  label?: string;
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as Classification)}>
      <SelectTrigger id={id} className="h-9 w-full sm:w-48" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {CLASSIFICATIONS.map((c) => (
          <SelectItem key={c} value={c}>
            {classificationLabel(c)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function Toggle({ id, label, description, checked, onChange, disabled }: {
  id: string;
  label: string;
  description: ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className={cn("flex items-start justify-between gap-4 rounded-lg border px-3 py-2.5", disabled && "opacity-60")}>
      <div>
        <Label htmlFor={id}>{label}</Label>
        <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} disabled={disabled} />
    </div>
  );
}

function SecurityEditor({ initial, onSaved }: { initial: WorkspaceSettings; onSaved: (s: WorkspaceSettings) => void }) {
  const [draft, setDraft] = useState<SecuritySettings>(initial.security);
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial.security);
  const set = (patch: Partial<SecuritySettings>) => setDraft((d) => ({ ...d, ...patch }));
  const guarded = draft.guardrails_enabled;

  async function save() {
    if (saving) return;
    setSaving(true);
    setServerError(null);
    try {
      // Re-read so other sections (edited on the Settings page) are not overwritten with stale values.
      const latest = await getSettings();
      const saved = await updateSettings({ ...latest, security: draft });
      toast.success("Security settings saved");
      onSaved(saved);
    } catch (err) {
      notifyError(err);
      if (err instanceof ApiError) setServerError(err.message);
      setSaving(false);
    }
  }

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <section className="rounded-xl border bg-background">
        <header className="border-b px-4 py-3">
          <h2 className="text-[14px] font-semibold">Clearance &amp; classification</h2>
          <p className="text-xs text-muted-foreground">
            The highest document classification each role may retrieve. Admins always see everything. Retrieval filters by
            clearance before anything reaches the language model.
          </p>
        </header>
        <div className="grid gap-4 p-4 sm:grid-cols-3">
          <div className="grid content-start gap-1.5">
            <Label htmlFor="sec-manager">Manager clearance</Label>
            <ClassificationSelect id="sec-manager" value={draft.role_clearance.manager} onChange={(v) => set({ role_clearance: { ...draft.role_clearance, manager: v } })} />
          </div>
          <div className="grid content-start gap-1.5">
            <Label htmlFor="sec-user">User clearance</Label>
            <ClassificationSelect id="sec-user" value={draft.role_clearance.user} onChange={(v) => set({ role_clearance: { ...draft.role_clearance, user: v } })} />
          </div>
          <div className="grid content-start gap-1.5">
            <Label htmlFor="sec-default">Default classification</Label>
            <ClassificationSelect id="sec-default" value={draft.default_classification} onChange={(v) => set({ default_classification: v })} />
            <p className="text-xs text-muted-foreground">Applied to uploads without an explicit classification.</p>
          </div>
        </div>
      </section>

      <section className="rounded-xl border bg-background">
        <header className="border-b px-4 py-3">
          <h2 className="text-[14px] font-semibold">Guardrails</h2>
          <p className="text-xs text-muted-foreground">Input, context and output protections applied to every chat request.</p>
        </header>
        <div className="grid gap-3 p-4">
          <Toggle id="sec-guardrails" label="Enable guardrails" description="Master switch for all checks below." checked={draft.guardrails_enabled} onChange={(v) => set({ guardrails_enabled: v })} />
          <Toggle id="sec-injection" label="Block prompt injection & jailbreaks" description="Rule-based detection of attempts to override instructions, escalate privileges or extract secrets." checked={draft.block_prompt_injection} onChange={(v) => set({ block_prompt_injection: v })} disabled={!guarded} />
          <Toggle id="sec-llm" label="LLM injection check" description="Also let the query-analysis model flag adversarial requests (no extra LLM call)." checked={draft.llm_injection_check} onChange={(v) => set({ llm_injection_check: v })} disabled={!guarded || !draft.block_prompt_injection} />
          <Toggle id="sec-chunks" label="Exclude flagged chunks" description="Drop retrieved passages flagged for embedded instructions. When off, only the instruction-like lines are replaced." checked={draft.exclude_flagged_chunks} onChange={(v) => set({ exclude_flagged_chunks: v })} disabled={!guarded} />
          <Toggle id="sec-redact" label="Redact sensitive output" description="Mask emails, phone numbers, IDs and secrets in answers for roles without PII access." checked={draft.redact_sensitive_output} onChange={(v) => set({ redact_sensitive_output: v })} disabled={!guarded} />
          <Toggle id="sec-diag" label="Show diagnostics to users" description="Let plain users see retrieved sources and RAGAS scores under answers." checked={draft.show_diagnostics_to_users} onChange={(v) => set({ show_diagnostics_to_users: v })} />
        </div>
      </section>

      {serverError && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-[13px] text-red-700 ring-1 ring-red-200/70 ring-inset">
          {serverError}
        </p>
      )}

      <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center justify-end gap-2 border-t bg-background/90 px-1 py-3 backdrop-blur">
        <p className="mr-auto text-xs text-muted-foreground" aria-live="polite">
          {dirty ? "You have unsaved changes." : "All changes saved."}
        </p>
        <Button type="button" variant="outline" disabled={!dirty || saving} onClick={() => setDraft(initial.security)}>
          <RotateCcw /> Reset
        </Button>
        <Button type="submit" disabled={!dirty || saving}>
          {saving ? <Loader2 className="animate-spin" /> : <Save />} Save security settings
        </Button>
      </div>
    </form>
  );
}

function SecuritySettingsSection({ onSaved }: { onSaved: () => void }) {
  const settings = useApiQuery("settings", (signal) => getSettings(signal));
  const [version, setVersion] = useState(0);
  if (settings.error !== undefined && !settings.data) return <QueryError error={settings.error} onRetry={settings.refresh} />;
  if (!settings.data) return <Skeleton className="h-96 w-full rounded-xl" />;
  return (
    <SecurityEditor
      key={version}
      initial={settings.data}
      onSaved={(saved) => {
        settings.mutate(() => saved);
        setVersion((v) => v + 1);
        onSaved();
      }}
    />
  );
}

/** /admin/security — role matrix, classification and guardrail overview, and the security policy form. */
export function SecurityPage() {
  const { can } = useSession();
  const overview = useApiQuery("admin:security", (signal) => getSecurityOverview(signal));
  const data = overview.data;

  return (
    <PageContainer>
      <PageHeader
        title="Security"
        description="Who can see what: role permissions, document clearance, guardrail activity and policy."
        actions={
          <Button asChild variant="outline">
            <Link href="/admin/audit?event_type=guardrail.">
              <ShieldAlert /> Guardrail events
            </Link>
          </Button>
        }
      />

      {overview.error !== undefined && !data && <QueryError error={overview.error} onRetry={overview.refresh} />}

      <div className="grid gap-3 md:grid-cols-2">
        <SummaryCard icon={FileLock2} title="Documents by classification">
          {data ? <ClassificationBars counts={data.documents_by_classification} /> : <Skeleton className="h-36 w-full" />}
        </SummaryCard>
        <SummaryCard icon={ShieldAlert} title="Guardrail events · last 30 days">
          {data ? <GuardrailEventList events={data.guardrail_events_30d} /> : <Skeleton className="h-36 w-full" />}
        </SummaryCard>
      </div>

      <section aria-labelledby="matrix-title" className="space-y-2">
        <h2 id="matrix-title" className="flex items-center gap-2 text-sm font-semibold">
          <ShieldCheck className="size-4 text-primary" aria-hidden /> Roles &amp; permissions
        </h2>
        {data ? <RoleMatrix data={data} /> : <Skeleton className="h-96 w-full rounded-xl" />}
      </section>

      <section aria-labelledby="policy-title" className="space-y-2">
        <h2 id="policy-title" className="flex items-center gap-2 text-sm font-semibold">
          <KeyRound className="size-4 text-primary" aria-hidden /> Security policy
        </h2>
        {can("settings.manage") ? (
          <SecuritySettingsSection onSaved={overview.refresh} />
        ) : (
          <p className="rounded-xl border bg-muted/40 px-4 py-3 text-[13px] text-muted-foreground">
            Only admins can change the security policy.
          </p>
        )}
      </section>
    </PageContainer>
  );
}
