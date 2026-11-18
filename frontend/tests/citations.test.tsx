import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MarkdownContent } from "@/components/chat/markdown-content";
import { extractCitationIndices, resolveCitation, splitCitations } from "@/lib/citations";
import type { CitationOut, RetrievedSourceOut } from "@/lib/types";

describe("splitCitations", () => {
  it("splits single, adjacent and comma-separated markers", () => {
    expect(splitCitations("Revenue grew [1].")).toEqual([
      { type: "text", value: "Revenue grew " },
      { type: "citation", indices: [1], raw: "[1]" },
      { type: "text", value: "." },
    ]);
    expect(splitCitations("See [2][3]")).toEqual([
      { type: "text", value: "See " },
      { type: "citation", indices: [2], raw: "[2]" },
      { type: "citation", indices: [3], raw: "[3]" },
    ]);
    expect(splitCitations("[1, 4]")).toEqual([{ type: "citation", indices: [1, 4], raw: "[1, 4]" }]);
  });

  it("leaves links, footnotes, words and zero untouched", () => {
    for (const s of ["[1](https://x.y)", "[^1]", "[note]", "[0]", "array[i]"]) {
      expect(splitCitations(s)).toEqual([{ type: "text", value: s }]);
    }
  });

  it("extracts unique indices in order of appearance", () => {
    expect(extractCitationIndices("a [2] b [1][2] c [3, 1]")).toEqual([2, 1, 3]);
  });
});

describe("resolveCitation", () => {
  const citation: CitationOut = {
    index: 1,
    chunk_id: "c1",
    document_id: "d1",
    document_name: "Contract.pdf",
    page_number: 4,
    page_end: null,
    section_title: "Termination",
    snippet: "Either party may terminate…",
  };
  const source = {
    chunk_id: "c2",
    document_id: "d2",
    document_name: "Policy.pdf",
    page_number: 2,
    page_end: 3,
    section_title: null,
    snippet: "Policy text",
    selected: true,
    context_index: 2,
  } as RetrievedSourceOut;

  it("prefers persisted citations and falls back to selected sources while streaming", () => {
    expect(resolveCitation(1, [citation], [source])?.documentName).toBe("Contract.pdf");
    expect(resolveCitation(2, [citation], [source])?.documentName).toBe("Policy.pdf");
    expect(resolveCitation(3, [citation], [source])).toBeNull();
  });
});

describe("MarkdownContent citation rendering", () => {
  const render = (md: string) =>
    renderToStaticMarkup(
      <MarkdownContent content={md} renderCitation={(i) => <span className="chip" data-index={i}>{i}</span>} />,
    );

  it("renders [1] and [2][3] markers as chips", () => {
    const html = render("Growth was strong [1]. Margins fell [2][3].");
    expect(html.match(/class="chip"/g)).toHaveLength(3);
    expect(html).toContain('data-index="1"');
    expect(html).toContain('data-index="3"');
    expect(html).not.toContain("[1]");
  });

  it("expands [1, 2] into two chips", () => {
    expect(render("Both agree [1, 2].").match(/class="chip"/g)).toHaveLength(2);
  });

  it("does not touch markers inside code or link text", () => {
    const html = render("Use `arr[1]` here.\n\n```ts\nconst x = a[2];\n```\n\n[see [4]](https://example.com)");
    expect(html).not.toContain('class="chip"');
    expect(html).toContain("arr[1]");
    expect(html).toContain("a[2]");
  });

  it("renders GFM tables inside a scroll wrapper and keeps raw HTML inert", () => {
    const html = render("| a | b |\n|---|---|\n| 1 | 2 |\n\n<script>alert(1)</script>");
    expect(html).toContain('<div class="riva-table-wrap"><table>');
    expect(html).not.toContain("<script>");
  });

  it("renders plain text markers when no renderer is given", () => {
    const html = renderToStaticMarkup(<MarkdownContent content="Fact [1]." />);
    expect(html).toContain("[1]");
  });
});
