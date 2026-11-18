"use client";

import { Loader2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { notifyError } from "@/lib/notify";
import { BENCHMARK_RETRIEVAL_MODES, type BenchmarkKind, type BenchmarkRetrievalMode, type BenchmarkRunOut } from "@/lib/types";
import { runBenchmark } from "@/services/evaluations";

export const BENCHMARK_KINDS: Record<BenchmarkKind, { title: string; description: string }> = {
  retrieval: {
    title: "Retrieval benchmark",
    description: "Measures Recall@K, Precision@K, MRR and nDCG for each retrieval mode against labelled relevant chunks.",
  },
  ragas: {
    title: "RAGAS benchmark",
    description: "Answers every dataset question end-to-end and scores the answers with RAGAS metrics.",
  },
  deepeval: {
    title: "DeepEval benchmark",
    description: "Answers every dataset question end-to-end and scores the answers with DeepEval test metrics.",
  },
};

const MODE_LABELS: Record<BenchmarkRetrievalMode, string> = {
  dense: "Dense (vector)",
  bm25: "BM25 (keyword)",
  hybrid: "Hybrid (RRF)",
  hybrid_rerank: "Hybrid + reranker",
};

export function RunBenchmarkDialog({
  kind,
  datasets,
  onOpenChange,
  onStarted,
}: {
  kind: BenchmarkKind | null;
  datasets: readonly string[];
  onOpenChange: (open: boolean) => void;
  onStarted: (run: BenchmarkRunOut) => void;
}) {
  return (
    <Dialog open={kind !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {kind && <RunForm key={kind} kind={kind} datasets={datasets} onCancel={() => onOpenChange(false)} onStarted={onStarted} />}
      </DialogContent>
    </Dialog>
  );
}

function RunForm({
  kind,
  datasets,
  onCancel,
  onStarted,
}: {
  kind: BenchmarkKind;
  datasets: readonly string[];
  onCancel: () => void;
  onStarted: (run: BenchmarkRunOut) => void;
}) {
  const [dataset, setDataset] = useState(datasets[0] ?? "");
  const [limit, setLimit] = useState("");
  const [label, setLabel] = useState("");
  const [modes, setModes] = useState<BenchmarkRetrievalMode[]>([...BENCHMARK_RETRIEVAL_MODES]);
  const [baseline, setBaseline] = useState(false);
  const [busy, setBusy] = useState(false);

  const limitNum = limit.trim() === "" ? null : Number(limit);
  const limitInvalid = limitNum !== null && (!Number.isInteger(limitNum) || limitNum < 1 || limitNum > 500);
  const modesInvalid = kind === "retrieval" && modes.length === 0;
  const canSubmit = Boolean(dataset) && !limitInvalid && !modesInvalid && !busy;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    try {
      const run = await runBenchmark(kind, {
        dataset,
        limit: limitNum,
        label: label.trim(),
        set_baseline: baseline,
        ...(kind === "retrieval" ? { retrieval_modes: modes } : {}),
      });
      toast.success(`${BENCHMARK_KINDS[kind].title} queued`);
      onStarted(run);
    } catch (err) {
      notifyError(err);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Run {BENCHMARK_KINDS[kind].title.toLowerCase()}</DialogTitle>
        <DialogDescription>{BENCHMARK_KINDS[kind].description} This is an offline benchmark run.</DialogDescription>
      </DialogHeader>

      <div className="grid gap-1.5">
        <Label htmlFor="bench-dataset">Dataset</Label>
        {datasets.length > 0 ? (
          <Select value={dataset} onValueChange={setDataset}>
            <SelectTrigger id="bench-dataset" className="w-full">
              <SelectValue placeholder="Choose a dataset" />
            </SelectTrigger>
            <SelectContent>
              {datasets.map((d) => (
                <SelectItem key={d} value={d}>
                  {d}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-[13px] text-amber-900 ring-1 ring-amber-200/70 ring-inset">
            No benchmark datasets were found. Add a JSON dataset to the backend&apos;s evaluation datasets folder.
          </p>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="bench-limit">Limit (optional)</Label>
          <Input
            id="bench-limit"
            inputMode="numeric"
            type="number"
            min={1}
            max={500}
            placeholder="All items"
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
            aria-invalid={limitInvalid || undefined}
          />
          {limitInvalid && <p className="text-xs text-destructive">Enter a whole number from 1 to 500.</p>}
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="bench-label">Label (optional)</Label>
          <Input id="bench-label" maxLength={200} placeholder="e.g. chunk-800-rerank" value={label} onChange={(e) => setLabel(e.target.value)} />
        </div>
      </div>

      {kind === "retrieval" && (
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-sm font-medium">Retrieval modes</legend>
          <div className="grid grid-cols-2 gap-2">
            {BENCHMARK_RETRIEVAL_MODES.map((m) => (
              <label key={m} className="flex items-center gap-2 rounded-lg border px-2.5 py-2 text-[13px] hover:bg-muted/40">
                <Checkbox
                  checked={modes.includes(m)}
                  onCheckedChange={(c) =>
                    setModes((prev) => (c === true ? [...prev, m] : prev.filter((x) => x !== m)))
                  }
                />
                {MODE_LABELS[m]}
              </label>
            ))}
          </div>
          {modesInvalid && <p className="text-xs text-destructive">Select at least one retrieval mode.</p>}
        </fieldset>
      )}

      <label className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5">
        <span>
          <span className="block text-sm font-medium">Set as baseline</span>
          <span className="block text-xs text-muted-foreground">Future runs are compared against this one for regressions.</span>
        </span>
        <Switch checked={baseline} onCheckedChange={setBaseline} />
      </label>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" disabled={!canSubmit}>
          {busy && <Loader2 className="animate-spin" />} Start run
        </Button>
      </DialogFooter>
    </form>
  );
}
