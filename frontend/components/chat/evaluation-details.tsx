"use client";

import { FileJson, FilePlus2, Loader2, RotateCw } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { EvaluationBlock } from "@/components/chat/evaluation-block";
import { RawEvaluationDialog } from "@/components/chat/raw-evaluation-dialog";
import { Button } from "@/components/ui/button";
import { describeMetric } from "@/lib/format";
import { evaluationStatusLabel, groupEvaluations, isEvaluationActive } from "@/lib/evaluation";
import { notifyError } from "@/lib/notify";
import type { EvaluationOut } from "@/lib/types";
import { rerunEvaluations } from "@/services/evaluations";

/** One-line summary for the collapsed section header. */
export function evaluationSummary(evaluations: readonly EvaluationOut[], waiting: boolean): string {
  const { ragas } = groupEvaluations(evaluations);
  if (ragas.length === 0) return waiting ? "Waiting…" : "Not evaluated";
  const active = ragas.find(isEvaluationActive);
  if (active) return evaluationStatusLabel(active.status);
  const done = ragas.find((e) => e.status === "completed");
  if (done) {
    const first = done.metrics.find((m) => !describeMetric(m).isNA);
    return first ? `${first.display_name} ${describeMetric(first).text}` : "Completed";
  }
  return evaluationStatusLabel(ragas[0].status);
}

/**
 * RAGAS (and, separately, DeepEval) results for one answer. The answer remains visible
 * while evaluations are pending/running; polling is driven by the chat controller.
 */
export function EvaluationDetails({
  messageId,
  evaluations,
  canEvaluate,
  waiting,
  onEvaluationsChange,
  onAddReference,
}: {
  messageId: string;
  evaluations: readonly EvaluationOut[];
  /** False for local/unsaved or failed answers. */
  canEvaluate: boolean;
  /** True while the controller is still polling for the first evaluation rows. */
  waiting: boolean;
  onEvaluationsChange: (evaluations: EvaluationOut[]) => void;
  onAddReference: () => void;
}) {
  const [rawOpen, setRawOpen] = useState(false);
  const [rerunning, setRerunning] = useState(false);
  const { ragas, deepeval, other } = groupEvaluations(evaluations);
  const anyActive = evaluations.some(isEvaluationActive);

  async function rerun() {
    setRerunning(true);
    try {
      const res = await rerunEvaluations(messageId);
      onEvaluationsChange(res.evaluations);
      toast.success("Evaluation re-queued");
    } catch (err) {
      notifyError(err);
    } finally {
      setRerunning(false);
    }
  }

  return (
    <div className="space-y-3">
      {ragas.length > 0 ? (
        <div className="space-y-2">
          {ragas.map((e) => (
            <EvaluationBlock key={e.id} evaluation={e} />
          ))}
        </div>
      ) : (
        <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
          {waiting && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
          {waiting
            ? "Waiting for the RAGAS evaluation to be scheduled…"
            : "No RAGAS evaluation has been recorded for this answer."}
        </p>
      )}

      {deepeval.length > 0 && (
        <section aria-label="DeepEval evaluation" className="space-y-2 rounded-lg border border-dashed p-2.5">
          <div className="px-0.5">
            <p className="text-[12.5px] font-semibold">DeepEval</p>
            <p className="text-[11.5px] text-muted-foreground">
              Separate framework with its own methodology and thresholds — DeepEval scores are not interchangeable
              with RAGAS scores.
            </p>
          </div>
          {deepeval.map((e) => (
            <EvaluationBlock key={e.id} evaluation={e} />
          ))}
        </section>
      )}

      {other.map((e) => (
        <EvaluationBlock key={e.id} evaluation={e} />
      ))}

      {canEvaluate && (
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant="outline" onClick={onAddReference}>
            <FilePlus2 /> Add reference answer
          </Button>
          <Button size="sm" variant="outline" onClick={rerun} disabled={rerunning || anyActive}>
            {rerunning ? <Loader2 className="animate-spin" /> : <RotateCw />}
            {evaluations.length > 0 ? "Re-run evaluation" : "Run evaluation"}
          </Button>
          {evaluations.length > 0 && (
            <Button size="sm" variant="ghost" onClick={() => setRawOpen(true)}>
              <FileJson /> Inspect raw results
            </Button>
          )}
        </div>
      )}

      {rawOpen && <RawEvaluationDialog messageId={messageId} open={rawOpen} onOpenChange={setRawOpen} />}
    </div>
  );
}
