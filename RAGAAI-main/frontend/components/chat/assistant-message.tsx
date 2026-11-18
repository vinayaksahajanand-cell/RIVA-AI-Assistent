"use client";

import {
  AlertTriangle,
  Check,
  Copy,
  EyeOff,
  FilePlus2,
  FlaskConical,
  Gauge,
  Info,
  Library,
  RefreshCw,
  ShieldAlert,
  Square,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react";
import { memo, useCallback, useState, type ReactNode } from "react";

import { LogoMark } from "@/components/brand/logo";
import { AnswerSection } from "@/components/chat/answer-section";
import { CitationChip } from "@/components/chat/citation-chip";
import { EvaluationDetails, evaluationSummary } from "@/components/chat/evaluation-details";
import { LiveStatus } from "@/components/chat/live-status";
import { MarkdownContent } from "@/components/chat/markdown-content";
import { PerformanceDetails, performanceSummary } from "@/components/chat/performance-details";
import { ReferenceAnswerDialog } from "@/components/chat/reference-answer-dialog";
import { SourcesDetails, sourcesSummary } from "@/components/chat/sources-details";
import { VerificationSummary } from "@/components/chat/verification-summary";
import { StatusPill } from "@/components/common/status-pill";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useCopy } from "@/hooks/use-copy";
import { guardrailCategoryLabel, guardrailFromMetadata, isLocalId, redactionSummary, type ChatItem } from "@/lib/chat";
import type { GuardrailInfo } from "@/lib/types";
import { resolveCitation, type CitationTarget } from "@/lib/citations";
import type { EvaluationOut } from "@/lib/types";
import { cn } from "@/lib/utils";

export interface AssistantMessageProps {
  item: ChatItem;
  isLast: boolean;
  /** Any answer is currently streaming (disables regenerate). */
  busy: boolean;
  focused: boolean;
  highlightChunkId: string | null;
  /** The session may see diagnostics (retrieved sources, RAGAS). Panels also show when the data is present. */
  diagnostics: boolean;
  onFocus: (key: string) => void;
  onRegenerate: () => void;
  onFeedback: (messageId: string, rating: 1 | -1) => void;
  onEvaluationsChange: (messageId: string, evaluations: EvaluationOut[]) => void;
  onCitationSelect: (key: string, target: CitationTarget) => void;
}

/** Distinct rendering for answers refused by the guardrails (status "blocked"). */
function BlockedNotice({ content, guardrail, showReasons }: {
  content: string;
  guardrail: GuardrailInfo | null;
  showReasons: boolean;
}) {
  const reasons = showReasons ? (guardrail?.reasons ?? []) : [];
  return (
    <div
      role="status"
      className="rounded-xl border border-purple-200 bg-gradient-to-b from-violet-50 to-background px-4 py-3.5"
    >
      <div className="flex items-start gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-purple-700 text-white shadow-sm shadow-purple-900/20">
          <ShieldAlert className="size-4" aria-hidden />
        </span>
        <div className="min-w-0 space-y-1.5">
          <p className="text-[14px] font-semibold text-purple-950">Request blocked by the security policy</p>
          <p className="text-[13.5px] leading-relaxed text-foreground/85">
            {content ||
              "RIVA AI can't help with this request. It looks like an attempt to bypass the assistant's safeguards or reach information outside your access."}
          </p>
          <p className="text-[12.5px] text-muted-foreground">
            Rephrase your question about your documents and try again. Repeated attempts are recorded in the audit log.
          </p>
          <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
            <StatusPill tone="primary">{guardrailCategoryLabel(guardrail?.category)}</StatusPill>
            {guardrail?.source === "llm" && <StatusPill tone="neutral" dot={false}>AI check</StatusPill>}
          </div>
          {reasons.length > 0 && (
            <ul className="list-disc space-y-0.5 pl-4 text-[12px] text-muted-foreground">
              {reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function ActionButton({ label, onClick, pressed, disabled, children }: {
  label: string;
  onClick: () => void;
  pressed?: boolean;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={onClick}
          disabled={disabled}
          aria-label={label}
          aria-pressed={pressed}
          className={cn("text-muted-foreground hover:text-foreground", pressed && "bg-accent text-primary")}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export const AssistantMessage = memo(function AssistantMessage({
  item,
  isLast,
  busy,
  focused,
  highlightChunkId,
  diagnostics,
  onFocus,
  onRegenerate,
  onFeedback,
  onEvaluationsChange,
  onCitationSelect,
}: AssistantMessageProps) {
  const { message, live } = item;
  const streaming = Boolean(live);
  const persisted = !isLocalId(message.id);
  const failed = message.status === "failed";
  const insufficient = message.status === "insufficient_context";
  const blocked = message.status === "blocked";
  const guardrail = guardrailFromMetadata(message.metadata);
  const redacted = redactionSummary(guardrail?.redactions);
  // Users without diagnostics get no retrieval / evaluations from the API, so their panels are hidden.
  const showDiagnostics = !blocked && (diagnostics || message.retrieval !== null || message.evaluations.length > 0);
  const [referenceOpen, setReferenceOpen] = useState(false);
  const { copied, copy } = useCopy();

  const renderCitation = useCallback(
    (index: number) => (
      <CitationChip
        index={index}
        target={resolveCitation(index, message.citations, message.retrieval?.sources)}
        onSelect={(t) => onCitationSelect(item.key, t)}
      />
    ),
    [message.citations, message.retrieval, onCitationSelect, item.key],
  );

  const waitingForEval =
    showDiagnostics && !streaming && persisted && (item.evalGrace ?? 0) > 0 && message.evaluations.length === 0;
  const showDetails = !(failed && !message.content);
  const canAct = !streaming && persisted;

  return (
    <article
      aria-label="RIVA answer"
      onClick={() => onFocus(item.key)}
      onFocusCapture={() => onFocus(item.key)}
      className={cn(
        "group/answer relative flex gap-3 rounded-2xl transition-colors",
        focused && "before:absolute before:inset-y-1 before:-left-3 before:w-0.5 before:rounded-full before:bg-primary/40",
      )}
    >
      <LogoMark className="mt-0.5 size-7" title="RIVA" />
      <div className="min-w-0 flex-1 space-y-3">
        <div className="flex h-7 items-center gap-2 text-xs text-muted-foreground">
          <span className="font-semibold text-foreground">RIVA</span>
          {message.model && <span className="truncate">· {message.model}</span>}
        </div>

        {live && <LiveStatus live={live} />}

        {insufficient && (
          <div className="flex items-start gap-2 rounded-lg bg-violet-50/80 px-3 py-2 text-[13px] text-violet-950 ring-1 ring-violet-200/70 ring-inset">
            <Info className="mt-0.5 size-4 shrink-0 text-violet-600" aria-hidden />
            <p>
              <span className="font-medium">Not enough context.</span> Your documents don&apos;t contain enough
              information to answer this confidently.
            </p>
          </div>
        )}

        {blocked ? (
          <BlockedNotice content={message.content} guardrail={guardrail} showReasons={diagnostics} />
        ) : message.content ? (
          <MarkdownContent
            content={message.content}
            renderCitation={renderCitation}
            className={cn(streaming && "riva-caret", insufficient && "text-foreground/85")}
          />
        ) : (
          !streaming &&
          !failed && <p className="text-sm text-muted-foreground italic">{item.stopped ? "Stopped before any text was generated." : "No answer text."}</p>
        )}

        {failed && (
          <div role="alert" className="flex items-start gap-2 rounded-lg bg-red-50/80 px-3 py-2 text-[13px] text-red-800 ring-1 ring-red-200/70 ring-inset">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-red-600" aria-hidden />
            <p>{message.error_message || "The answer could not be generated."}</p>
          </div>
        )}

        {item.stopped && (
          <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <Square className="size-3" aria-hidden /> Generation stopped
          </p>
        )}

        {redacted && !streaming && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <EyeOff className="size-3.5 shrink-0" aria-hidden />
            Sensitive data was redacted from this answer ({redacted}).
          </p>
        )}

        {!streaming && !blocked && <VerificationSummary verification={message.verification} />}

        {!streaming && (
          <div className="-ml-1.5 flex flex-wrap items-center gap-0.5">
            <ActionButton label={copied ? "Copied" : "Copy answer"} onClick={() => copy(message.content)} disabled={!message.content}>
              {copied ? <Check className="text-emerald-600" /> : <Copy />}
            </ActionButton>
            {isLast && (
              <ActionButton label="Regenerate answer" onClick={onRegenerate} disabled={busy}>
                <RefreshCw />
              </ActionButton>
            )}
            {persisted && !failed && (
              <>
                <ActionButton
                  label="Helpful"
                  pressed={message.feedback_rating === 1}
                  onClick={() => onFeedback(message.id, 1)}
                >
                  <ThumbsUp />
                </ActionButton>
                <ActionButton
                  label="Not helpful"
                  pressed={message.feedback_rating === -1}
                  onClick={() => onFeedback(message.id, -1)}
                >
                  <ThumbsDown />
                </ActionButton>
                {showDiagnostics && (
                  <ActionButton label="Add reference answer" onClick={() => setReferenceOpen(true)}>
                    <FilePlus2 />
                  </ActionButton>
                )}
              </>
            )}
          </div>
        )}

        {showDetails && (
          <div className="divide-y overflow-hidden rounded-xl border bg-background">
            <AnswerSection
              icon={Gauge}
              title="Response Performance"
              summary={performanceSummary(message.performance, streaming)}
            >
              <PerformanceDetails performance={message.performance} evaluations={message.evaluations} streaming={streaming} />
            </AnswerSection>
            {showDiagnostics && (
              <AnswerSection
                icon={FlaskConical}
                title="RAGAS Quality Evaluation"
                summary={streaming ? "After the answer completes" : evaluationSummary(message.evaluations, waitingForEval)}
              >
                {streaming || !persisted ? (
                  <p className="text-[13px] text-muted-foreground">
                    {streaming
                      ? "Quality evaluation starts after the answer is complete."
                      : "This answer was not saved, so it cannot be evaluated."}
                  </p>
                ) : (
                  <EvaluationDetails
                    messageId={message.id}
                    evaluations={message.evaluations}
                    canEvaluate={canAct && !failed}
                    waiting={waitingForEval}
                    onEvaluationsChange={(evals) => onEvaluationsChange(message.id, evals)}
                    onAddReference={() => setReferenceOpen(true)}
                  />
                )}
              </AnswerSection>
            )}
            {showDiagnostics && (
              <AnswerSection icon={Library} title="Retrieved Sources" summary={sourcesSummary(message.retrieval, streaming)}>
                <SourcesDetails retrieval={message.retrieval} streaming={streaming} highlightChunkId={highlightChunkId} />
              </AnswerSection>
            )}
          </div>
        )}
      </div>

      {persisted && showDiagnostics && referenceOpen && (
        <ReferenceAnswerDialog
          messageId={message.id}
          initialValue={message.reference_answer}
          open={referenceOpen}
          onOpenChange={setReferenceOpen}
          onSubmitted={(evals) => onEvaluationsChange(message.id, evals)}
        />
      )}
    </article>
  );
});

export function UserMessage({ content }: { content: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] rounded-2xl rounded-br-md bg-accent px-4 py-2.5 text-[15px] leading-relaxed break-words whitespace-pre-wrap text-foreground ring-1 ring-violet-100 ring-inset">
        {content}
      </div>
    </div>
  );
}
