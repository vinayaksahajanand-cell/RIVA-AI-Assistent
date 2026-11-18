"use client";

import { FileSearch, FileText, GitCompareArrows, NotebookPen, ScrollText, ShieldCheck, Sparkles, TriangleAlert, type LucideIcon } from "lucide-react";

import { LogoMark } from "@/components/brand/logo";

const STARTERS: Array<{ icon: LucideIcon; label: string }> = [
  { icon: FileText, label: "Summarize my uploaded documents" },
  { icon: GitCompareArrows, label: "Compare two documents" },
  { icon: FileSearch, label: "Find specific information across my files" },
  { icon: TriangleAlert, label: "Identify contradictions between documents" },
  { icon: ScrollText, label: "Extract important clauses" },
  { icon: NotebookPen, label: "Generate a research report" },
];

function Chip({ icon: Icon, label, onClick }: { icon: LucideIcon; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex items-center gap-2.5 rounded-xl border bg-background px-3.5 py-2.5 text-left text-[13.5px] text-foreground/90 shadow-[0_1px_2px_rgba(16,24,40,0.03)] outline-none transition-all hover:-translate-y-px hover:border-violet-200 hover:bg-accent/50 hover:shadow-sm focus-visible:ring-2 focus-visible:ring-ring motion-reduce:hover:translate-y-0"
    >
      <Icon className="size-4 shrink-0 text-primary/80 transition-colors group-hover:text-primary" aria-hidden />
      <span className="min-w-0">{label}</span>
    </button>
  );
}

/** Empty-conversation hero with starter prompts plus server-suggested questions. */
export function WelcomeScreen({
  suggestions,
  onPick,
  accessNote,
}: {
  suggestions: readonly string[];
  onPick: (prompt: string) => void;
  /** e.g. "You can access: public, internal documents" */
  accessNote?: string;
}) {
  const starterSet = new Set(STARTERS.map((s) => s.label.toLowerCase()));
  const extra = Array.from(new Set(suggestions.map((s) => s.trim()).filter(Boolean))).filter(
    (s) => !starterSet.has(s.toLowerCase()),
  );

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col items-center px-4 pt-[10vh] pb-8 text-center sm:pt-[14vh]">
      <LogoMark className="mb-5 size-12 drop-shadow-[0_6px_16px_rgba(109,40,217,0.28)]" />
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Welcome to RIVA AI</h1>
      <p className="mt-2 text-[15px] text-muted-foreground">Your intelligent document research partner.</p>
      {accessNote && (
        <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-accent px-3 py-1 text-[12.5px] font-medium text-accent-foreground ring-1 ring-violet-200/80 ring-inset">
          <ShieldCheck className="size-3.5" aria-hidden />
          {accessNote}
        </p>
      )}

      <div className="mt-8 grid w-full gap-2 sm:grid-cols-2">
        {STARTERS.map((s) => (
          <Chip key={s.label} icon={s.icon} label={s.label} onClick={() => onPick(s.label)} />
        ))}
      </div>

      {extra.length > 0 && (
        <div className="mt-6 w-full text-left">
          <p className="mb-2 flex items-center gap-1.5 px-1 text-xs font-medium text-muted-foreground">
            <Sparkles className="size-3.5 text-primary/70" aria-hidden /> Suggested from your documents
          </p>
          <div className="flex flex-wrap gap-2">
            {extra.slice(0, 6).map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => onPick(q)}
                className="rounded-full border bg-background px-3 py-1.5 text-[13px] text-foreground/85 outline-none transition-colors hover:border-violet-200 hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring"
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
