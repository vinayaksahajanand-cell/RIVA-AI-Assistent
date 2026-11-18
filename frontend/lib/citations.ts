/**
 * Inline citation markers: "[1]", "[2][3]" and "[1, 2]" in answer text.
 *
 * `splitCitations` is the pure tokenizer; `remarkCitations` applies it to markdown
 * text nodes only (code spans/blocks are separate node types and therefore untouched,
 * and text inside links is skipped so chips never nest inside <a>).
 * Each marker becomes a <sup data-citation="1,2"> element that the renderer maps to chips.
 */

import type { Parent, PhrasingContent, Root, RootContent } from "mdast";

import type { CitationOut, RetrievedSourceOut } from "@/lib/types";

export type CitationPart =
  | { type: "text"; value: string }
  | { type: "citation"; indices: number[]; raw: string };

// "[12]" or "[1, 2]" / "[1,2;3]" — but not markdown links "[1](...)" or footnotes "[^1]".
const CITATION_RE = /\[(\d{1,3}(?:\s*[,;]\s*\d{1,3})*)\](?!\()/g;

export function splitCitations(text: string): CitationPart[] {
  const parts: CitationPart[] = [];
  let last = 0;
  CITATION_RE.lastIndex = 0;
  for (let m = CITATION_RE.exec(text); m !== null; m = CITATION_RE.exec(text)) {
    const indices = m[1]
      .split(/[,;]/)
      .map((s) => Number.parseInt(s.trim(), 10))
      .filter((n) => Number.isInteger(n) && n > 0);
    if (indices.length === 0) continue;
    if (m.index > last) parts.push({ type: "text", value: text.slice(last, m.index) });
    parts.push({ type: "citation", indices, raw: m[0] });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ type: "text", value: text.slice(last) });
  if (parts.length === 0) parts.push({ type: "text", value: text });
  return parts;
}

/** Unique citation indices in order of first appearance. */
export function extractCitationIndices(text: string): number[] {
  const seen = new Set<number>();
  for (const part of splitCitations(text)) {
    if (part.type === "citation") part.indices.forEach((i) => seen.add(i));
  }
  return [...seen];
}

function citationNode(indices: number[], raw: string): PhrasingContent {
  return {
    type: "emphasis",
    data: { hName: "sup", hProperties: { dataCitation: indices.join(",") } },
    children: [{ type: "text", value: raw }],
  };
}

function transform(node: Parent, insideLink: boolean): void {
  const children = node.children as RootContent[];
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (child.type === "text") {
      if (insideLink) continue;
      const parts = splitCitations(child.value);
      if (parts.length === 1 && parts[0].type === "text") continue;
      const replacement: PhrasingContent[] = parts.map((p) =>
        p.type === "text" ? { type: "text", value: p.value } : citationNode(p.indices, p.raw),
      );
      children.splice(i, 1, ...(replacement as RootContent[]));
      i += replacement.length - 1;
    } else if ("children" in child && Array.isArray(child.children)) {
      transform(child as Parent, insideLink || child.type === "link" || child.type === "linkReference");
    }
  }
}

/** remark plugin (unified attacher) converting citation markers into chip placeholders. */
export function remarkCitations() {
  return (tree: Root) => {
    transform(tree, false);
  };
}

/** Parse the `data-citation` attribute value ("1,2") back into indices. */
export function parseCitationAttr(value: unknown): number[] {
  if (typeof value !== "string" && typeof value !== "number") return [];
  return String(value)
    .split(",")
    .map((s) => Number.parseInt(s, 10))
    .filter((n) => Number.isInteger(n) && n > 0);
}

/** What a citation chip points at: a persisted citation, or (while streaming) a selected source. */
export interface CitationTarget {
  index: number;
  documentId: string;
  documentName: string;
  pageNumber: number | null;
  pageEnd: number | null;
  sectionTitle: string | null;
  snippet: string;
  chunkId: string;
}

export function resolveCitation(
  index: number,
  citations: readonly CitationOut[] | null | undefined,
  sources: readonly RetrievedSourceOut[] | null | undefined,
): CitationTarget | null {
  const c = citations?.find((x) => x.index === index);
  if (c) {
    return {
      index,
      documentId: c.document_id,
      documentName: c.document_name,
      pageNumber: c.page_number,
      pageEnd: c.page_end,
      sectionTitle: c.section_title,
      snippet: c.snippet,
      chunkId: c.chunk_id,
    };
  }
  const s = sources?.find((x) => x.selected && x.context_index === index);
  if (s) {
    return {
      index,
      documentId: s.document_id,
      documentName: s.document_name,
      pageNumber: s.page_number,
      pageEnd: s.page_end,
      sectionTitle: s.section_title,
      snippet: s.snippet,
      chunkId: s.chunk_id,
    };
  }
  return null;
}
