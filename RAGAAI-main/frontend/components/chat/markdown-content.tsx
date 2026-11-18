"use client";

import { Fragment, memo, useMemo, type ReactNode } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { CodeBlock } from "@/components/chat/code-block";
import { parseCitationAttr, remarkCitations } from "@/lib/citations";
import { cn } from "@/lib/utils";

const REMARK_PLUGINS = [remarkGfm, remarkCitations];

export interface MarkdownContentProps {
  content: string;
  /** Render one citation chip for marker index n. Without it, markers render as plain text. */
  renderCitation?: (index: number) => ReactNode;
  className?: string;
}

/**
 * Answer markdown: GFM tables, fenced code with copy, and inline citation markers
 * ([1], [2][3], [1, 2]) turned into chips. Raw HTML in the answer is not rendered.
 */
export const MarkdownContent = memo(function MarkdownContent({ content, renderCitation, className }: MarkdownContentProps) {
  const components = useMemo<Components>(
    () => ({
      sup({ node, children, ...props }) {
        const attr = node?.properties?.dataCitation;
        if (attr === undefined) return <sup {...props}>{children}</sup>;
        const indices = parseCitationAttr(attr);
        if (!renderCitation) return <span className="text-muted-foreground">{children}</span>;
        return (
          <>
            {indices.map((index, i) => (
              <Fragment key={`${index}-${i}`}>{renderCitation(index)}</Fragment>
            ))}
          </>
        );
      },
      pre({ node, children }) {
        return <CodeBlock node={node}>{children}</CodeBlock>;
      },
      table({ node: _node, ...props }) {
        return (
          <div className="riva-table-wrap">
            <table {...props} />
          </div>
        );
      },
      a({ node: _node, href, children, ...props }) {
        return (
          <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
            {children}
          </a>
        );
      },
    }),
    [renderCitation],
  );

  return (
    <div className={cn("riva-prose", className)}>
      <Markdown remarkPlugins={REMARK_PLUGINS} components={components}>
        {content}
      </Markdown>
    </div>
  );
});
