"use client";

import { Loader2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { notifyError } from "@/lib/notify";
import type { EvaluationOut } from "@/lib/types";
import { submitReferenceAnswer } from "@/services/evaluations";

const MAX = 20000;

export function ReferenceAnswerDialog({
  messageId,
  initialValue,
  open,
  onOpenChange,
  onSubmitted,
}: {
  messageId: string;
  initialValue?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmitted: (evaluations: EvaluationOut[]) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        {open && (
          <ReferenceForm
            messageId={messageId}
            initialValue={initialValue ?? ""}
            onCancel={() => onOpenChange(false)}
            onDone={(evals) => {
              onSubmitted(evals);
              onOpenChange(false);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ReferenceForm({
  messageId,
  initialValue,
  onCancel,
  onDone,
}: {
  messageId: string;
  initialValue: string;
  onCancel: () => void;
  onDone: (evaluations: EvaluationOut[]) => void;
}) {
  const [value, setValue] = useState(initialValue);
  const [busy, setBusy] = useState(false);
  const trimmed = value.trim();

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      const res = await submitReferenceAnswer(messageId, trimmed);
      toast.success("Reference answer saved — reference-based evaluation queued.");
      onDone(res.evaluations);
    } catch (err) {
      notifyError(err);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Add reference answer</DialogTitle>
        <DialogDescription>
          Provide the ground-truth answer for this question. RIVA AI queues a reference-based RAGAS evaluation
          (e.g. context recall, answer correctness) that is reported separately from the online evaluation.
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-1.5">
        <Label htmlFor={`reference-${messageId}`}>Reference answer</Label>
        <Textarea
          id={`reference-${messageId}`}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          maxLength={MAX}
          rows={8}
          autoFocus
          placeholder="The correct, complete answer according to your documents…"
          className="max-h-[50dvh] min-h-40"
        />
        <p className="text-right text-[11px] text-muted-foreground tabular">
          {value.length.toLocaleString()} / {MAX.toLocaleString()}
        </p>
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" disabled={!trimmed || busy}>
          {busy && <Loader2 className="animate-spin" />}
          Save &amp; evaluate
        </Button>
      </DialogFooter>
    </form>
  );
}
