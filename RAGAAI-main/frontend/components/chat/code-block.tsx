"use client";

import type { Element, ElementContent } from "hast";
import { Check, Copy } from "lucide-react";
import type { ReactNode } from "react";

import { useCopy } from "@/hooks/use-copy";

function hastText(node: Element | ElementContent | undefined): string {
  if (!node) return "";
  if (node.type === "text") return node.value;
  if (node.type === "element") return node.children.map(hastText).join("");
  return "";
}

function languageOf(node: Element | undefined): string | null {
  const code = node?.children.find((c): c is Element => c.type === "element" && c.tagName === "code");
  const cls: unknown = code?.properties?.className;
  const list: string[] = Array.isArray(cls) ? cls.map(String) : typeof cls === "string" ? cls.split(" ") : [];
  const lang = list.find((c) => c.startsWith("language-"));
  return lang ? lang.slice("language-".length) : null;
}

/** Fenced code block with a language label and a copy button. */
export function CodeBlock({ node, children }: { node?: Element; children: ReactNode }) {
  const { copied, copy } = useCopy();
  const lang = languageOf(node);
  return (
    <div className="group/code my-3 overflow-hidden rounded-lg border bg-muted/50">
      <div className="flex h-8 items-center justify-between border-b bg-muted/60 px-3">
        <span className="font-mono text-[11px] text-muted-foreground">{lang ?? "code"}</span>
        <button
          type="button"
          onClick={() => copy(hastText(node).replace(/\n$/, ""))}
          className="inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[11px] text-muted-foreground outline-none transition-colors hover:bg-background hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={copied ? "Copied" : "Copy code"}
        >
          {copied ? <Check className="size-3.5 text-emerald-600" /> : <Copy className="size-3.5" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="m-0! overflow-x-auto p-3 scrollbar-thin">{children}</pre>
    </div>
  );
}
