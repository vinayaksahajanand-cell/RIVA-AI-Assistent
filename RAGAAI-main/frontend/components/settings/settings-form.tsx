"use client";

import { Loader2, RotateCcw, Save } from "lucide-react";
import { useState, type ChangeEvent, type ReactNode } from "react";
import { toast } from "sonner";

import { InfoHint } from "@/components/common/info-hint";
import { QueryError } from "@/components/common/query-error";
import { useSystemInfo } from "@/components/providers/system-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useApiQuery } from "@/hooks/use-api-query";
import { notifyError } from "@/lib/notify";
import { SETTINGS_RANGES, settingsWarnings, validateSettings, type RangedField } from "@/lib/settings";
import { CHUNK_STRATEGIES, RETRIEVAL_MODES, type ChunkStrategy, type RetrievalMode, type WorkspaceSettings } from "@/lib/types";
import { cn } from "@/lib/utils";
import { getSettings, updateSettings } from "@/services/settings";
import { ApiError } from "@/services/http";

const STRATEGY_LABELS: Record<ChunkStrategy, { label: string; hint: string }> = {
  recursive: { label: "Recursive", hint: "Splits on paragraphs, then sentences, to fit the chunk size." },
  token: { label: "Token", hint: "Fixed-size windows measured in tokens." },
  semantic: { label: "Semantic", hint: "Breaks where the topic shifts, using embeddings." },
  structure: { label: "Structure-aware", hint: "Follows headings and document sections." },
  parent_child: { label: "Parent–child", hint: "Small child chunks for retrieval, larger parents as context." },
};

const MODE_LABELS: Record<RetrievalMode, string> = {
  hybrid: "Hybrid (dense + BM25 with RRF)",
  dense: "Dense (vector only)",
  bm25: "BM25 (keyword only)",
};

function Section({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border bg-background">
      <header className="border-b px-4 py-3">
        <h2 className="text-[14px] font-semibold">{title}</h2>
        <p className="text-xs text-muted-foreground">{description}</p>
      </header>
      <div className="grid gap-4 p-4 sm:grid-cols-2">{children}</div>
    </section>
  );
}

function Field({
  id,
  label,
  hint,
  error,
  warning,
  children,
  className,
  info,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  warning?: string;
  children: ReactNode;
  className?: string;
  info?: ReactNode;
}) {
  return (
    <div className={cn("grid content-start gap-1.5", className)}>
      <Label htmlFor={id} className="flex items-center gap-1">
        {label}
        {info && <InfoHint label={`About ${label}`}>{info}</InfoHint>}
      </Label>
      {children}
      {error ? (
        <p id={`${id}-msg`} className="text-xs text-destructive">
          {error}
        </p>
      ) : warning ? (
        <p id={`${id}-msg`} className="text-xs text-amber-700">
          {warning}
        </p>
      ) : hint ? (
        <p id={`${id}-msg`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

function ToggleRow({ id, label, description, checked, onChange, disabled }: {
  id: string;
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border px-3 py-2.5 sm:col-span-2">
      <div>
        <Label htmlFor={id}>{label}</Label>
        <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} disabled={disabled} />
    </div>
  );
}

function Editor({ initial, onSaved }: { initial: WorkspaceSettings; onSaved: (s: WorkspaceSettings) => void }) {
  const { system } = useSystemInfo();
  const [draft, setDraft] = useState<WorkspaceSettings>(initial);
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const errors = validateSettings(draft);
  const warnings = settingsWarnings(draft);
  const hasErrors = Object.keys(errors).length > 0;
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);

  const set = <K extends keyof WorkspaceSettings>(section: K, patch: Partial<WorkspaceSettings[K]>) =>
    setDraft((d) => ({ ...d, [section]: { ...d[section], ...patch } }));

  const num = (path: RangedField, step?: number) => {
    const [section, field] = path.split(".") as [keyof WorkspaceSettings, string];
    const value = (draft[section] as unknown as Record<string, number>)[field];
    const range = SETTINGS_RANGES[path];
    return {
      id: path.replace(".", "-"),
      type: "number" as const,
      inputMode: ("integer" in range ? "numeric" : "decimal") as "numeric" | "decimal",
      min: range.min,
      max: range.max,
      step: step ?? ("integer" in range ? 1 : 0.1),
      value: Number.isNaN(value) ? "" : value,
      "aria-invalid": errors[path] ? true : undefined,
      "aria-describedby": `${path.replace(".", "-")}-msg`,
      onChange: (e: ChangeEvent<HTMLInputElement>) =>
        set(section, { [field]: e.target.value === "" ? Number.NaN : Number(e.target.value) } as Partial<WorkspaceSettings[typeof section]>),
      className: "h-9",
    };
  };

  async function save() {
    if (hasErrors || saving) return;
    setSaving(true);
    setServerError(null);
    try {
      const saved = await updateSettings(draft);
      toast.success("Settings saved");
      onSaved(saved);
    } catch (err) {
      notifyError(err);
      if (err instanceof ApiError) setServerError(err.message);
      setSaving(false);
    }
  }

  const models = system?.available_models ?? [];
  const modelOptions = draft.generation.model && !models.includes(draft.generation.model) ? [...models, draft.generation.model] : models;
  const parentChild = draft.chunking.strategy === "parent_child";

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      noValidate
    >
      <Section title="Chunking" description="How documents are split before embedding. Changes apply to documents indexed or re-indexed afterwards.">
        <Field id="chunking-strategy" label="Strategy" hint={STRATEGY_LABELS[draft.chunking.strategy]?.hint} className="sm:col-span-2">
          <Select value={draft.chunking.strategy} onValueChange={(v) => set("chunking", { strategy: v as ChunkStrategy })}>
            <SelectTrigger id="chunking-strategy" className="h-9 w-full sm:w-72">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CHUNK_STRATEGIES.map((s) => (
                <SelectItem key={s} value={s}>
                  {STRATEGY_LABELS[s].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field id="chunking-chunk_size" label="Chunk size (tokens)" hint="100 – 4000" error={errors["chunking.chunk_size"]}>
          <Input {...num("chunking.chunk_size", 50)} />
        </Field>
        <Field id="chunking-chunk_overlap" label="Chunk overlap (tokens)" hint="0 – 1000, smaller than chunk size" error={errors["chunking.chunk_overlap"]}>
          <Input {...num("chunking.chunk_overlap", 10)} />
        </Field>
        <Field
          id="chunking-parent_chunk_size"
          label="Parent chunk size"
          hint={parentChild ? "400 – 8000 tokens" : "Used by the parent–child strategy"}
          error={errors["chunking.parent_chunk_size"]}
          className={cn(!parentChild && "opacity-70")}
        >
          <Input {...num("chunking.parent_chunk_size", 100)} />
        </Field>
        <Field
          id="chunking-child_chunk_size"
          label="Child chunk size"
          hint={parentChild ? "100 – 2000 tokens, smaller than parent" : "Used by the parent–child strategy"}
          error={errors["chunking.child_chunk_size"]}
          className={cn(!parentChild && "opacity-70")}
        >
          <Input {...num("chunking.child_chunk_size", 50)} />
        </Field>
      </Section>

      <Section title="Retrieval" description="How candidate passages are found, fused and filtered for each question.">
        <Field id="retrieval-mode" label="Retrieval mode" className="sm:col-span-2">
          <Select value={draft.retrieval.mode} onValueChange={(v) => set("retrieval", { mode: v as RetrievalMode })}>
            <SelectTrigger id="retrieval-mode" className="h-9 w-full sm:w-80">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RETRIEVAL_MODES.map((m) => (
                <SelectItem key={m} value={m}>
                  {MODE_LABELS[m]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field id="retrieval-top_k" label="top_k (candidates)" hint="1 – 50 passages retrieved per search" error={errors["retrieval.top_k"]}>
          <Input {...num("retrieval.top_k")} />
        </Field>
        <Field
          id="retrieval-final_k"
          label="final_k (context passages)"
          hint="1 – 12 passages given to the model"
          error={errors["retrieval.final_k"]}
          warning={warnings["retrieval.final_k"]}
        >
          <Input {...num("retrieval.final_k")} />
        </Field>
        <Field
          id="retrieval-rrf_k"
          label="rrf_k"
          hint="1 – 500"
          error={errors["retrieval.rrf_k"]}
          info="Reciprocal Rank Fusion constant: score = Σ weight / (rrf_k + rank). Larger values flatten rank differences."
        >
          <Input {...num("retrieval.rrf_k")} />
        </Field>
        <Field id="retrieval-max_corrective_attempts" label="Corrective attempts" hint="0 – 3 query rewrites when context is insufficient" error={errors["retrieval.max_corrective_attempts"]}>
          <Input {...num("retrieval.max_corrective_attempts")} />
        </Field>
        <Field id="retrieval-dense_weight" label="Dense weight" hint="0 – 5 (RRF weight for vector results)" error={errors["retrieval.dense_weight"]}>
          <Input {...num("retrieval.dense_weight")} />
        </Field>
        <Field id="retrieval-sparse_weight" label="BM25 weight" hint="0 – 5 (RRF weight for keyword results)" error={errors["retrieval.sparse_weight"]}>
          <Input {...num("retrieval.sparse_weight")} />
        </Field>
        <ToggleRow
          id="retrieval-reranker"
          label="Cross-encoder reranking"
          description={
            system?.reranker_model
              ? `Rerank fused candidates with ${system.reranker_model}.`
              : "Rerank fused candidates with the configured cross-encoder."
          }
          checked={draft.retrieval.reranker_enabled}
          onChange={(v) => set("retrieval", { reranker_enabled: v })}
        />
      </Section>

      <Section title="Generation" description="The language model and how it answers.">
        <Field id="generation-model" label="Model" error={errors["generation.model"]} className="sm:col-span-2">
          {modelOptions.length > 0 ? (
            <Select value={draft.generation.model} onValueChange={(v) => set("generation", { model: v })}>
              <SelectTrigger id="generation-model" className="h-9 w-full sm:w-80">
                <SelectValue placeholder="Choose a model" />
              </SelectTrigger>
              <SelectContent>
                {modelOptions.map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Input
              id="generation-model"
              className="h-9 sm:w-80"
              maxLength={100}
              value={draft.generation.model}
              onChange={(e) => set("generation", { model: e.target.value })}
            />
          )}
        </Field>
        <Field id="generation-temperature" label="Temperature" hint="0 – 2; lower is more deterministic" error={errors["generation.temperature"]}>
          <Input {...num("generation.temperature")} />
        </Field>
        <Field id="generation-max_tokens" label="Max output tokens" hint="64 – 8192" error={errors["generation.max_tokens"]}>
          <Input {...num("generation.max_tokens", 64)} />
        </Field>
        <ToggleRow
          id="generation-grounded"
          label="Grounded answers only"
          description="Answer strictly from retrieved documents; reply with “insufficient context” instead of using general knowledge."
          checked={draft.generation.grounded_only}
          onChange={(v) => set("generation", { grounded_only: v })}
        />
      </Section>

      <Section title="Evaluation" description="Automatic quality evaluation of answers.">
        <ToggleRow
          id="evaluation-online"
          label="Online RAGAS evaluation"
          description={
            system && !system.online_evaluation_available
              ? "Unavailable on this server (an evaluator LLM must be configured). The setting is stored and applies once available."
              : "Evaluate each answer in the background after it is delivered. Evaluation time is not part of response time."
          }
          checked={draft.evaluation.online_enabled}
          onChange={(v) => set("evaluation", { online_enabled: v })}
        />
      </Section>

      {serverError && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-[13px] text-red-700 ring-1 ring-red-200/70 ring-inset">
          {serverError}
        </p>
      )}

      <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center justify-end gap-2 border-t bg-background/90 px-1 py-3 backdrop-blur">
        <p className="mr-auto text-xs text-muted-foreground" aria-live="polite">
          {hasErrors ? "Fix the highlighted fields to save." : dirty ? "You have unsaved changes." : "All changes saved."}
        </p>
        <Button type="button" variant="outline" disabled={!dirty || saving} onClick={() => setDraft(initial)}>
          <RotateCcw /> Reset
        </Button>
        <Button type="submit" disabled={!dirty || hasErrors || saving}>
          {saving ? <Loader2 className="animate-spin" /> : <Save />} Save settings
        </Button>
      </div>
    </form>
  );
}

export function SettingsForm() {
  const settings = useApiQuery("settings", (signal) => getSettings(signal));
  const [version, setVersion] = useState(0);

  if (settings.error !== undefined && !settings.data) return <QueryError error={settings.error} onRetry={settings.refresh} />;
  if (!settings.data) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-56 w-full rounded-xl" />
        ))}
      </div>
    );
  }
  return (
    <Editor
      key={version}
      initial={settings.data}
      onSaved={(saved) => {
        settings.mutate(() => saved);
        setVersion((v) => v + 1);
      }}
    />
  );
}
