"use client";

import { KeyRound, X } from "lucide-react";
import { useState } from "react";

import { useSystemInfo } from "@/components/providers/system-provider";

/** Non-blocking notice shown when the backend reports `llm_configured: false`. */
export function LlmBanner() {
  const { system } = useSystemInfo();
  const [dismissed, setDismissed] = useState(false);
  if (!system || system.llm_configured || dismissed) return null;

  return (
    <div
      role="status"
      className="flex items-start gap-3 border-b border-amber-200/70 bg-amber-50/80 px-4 py-2.5 text-[13px] text-amber-900 sm:items-center"
    >
      <KeyRound className="mt-0.5 size-4 shrink-0 text-amber-600 sm:mt-0" aria-hidden />
      <p className="min-w-0 flex-1 leading-snug">
        <span className="font-medium">Language model not configured.</span>{" "}
        Set <code className="rounded bg-amber-100 px-1 py-0.5 font-mono text-[12px]">OPENAI_API_KEY</code> in{" "}
        <code className="rounded bg-amber-100 px-1 py-0.5 font-mono text-[12px]">backend/.env</code> and restart the
        backend to enable answers and LLM-based evaluation. Uploading and indexing documents still works.
      </p>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        className="flex size-6 shrink-0 items-center justify-center rounded-md text-amber-700 outline-none hover:bg-amber-100 focus-visible:ring-2 focus-visible:ring-amber-400"
        aria-label="Dismiss notice"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
