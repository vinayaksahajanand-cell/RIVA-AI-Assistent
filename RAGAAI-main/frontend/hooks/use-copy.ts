"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

async function writeClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  document.execCommand("copy");
  ta.remove();
}

/** Copy-to-clipboard with a transient "copied" flag for icon feedback. */
export function useCopy(resetMs = 1600): { copied: boolean; copy: (text: string) => void } {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const copy = useCallback(
    (text: string) => {
      writeClipboard(text).then(
        () => {
          setCopied(true);
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => setCopied(false), resetMs);
        },
        () => toast.error("Could not copy to the clipboard."),
      );
    },
    [resetMs],
  );

  return { copied, copy };
}
