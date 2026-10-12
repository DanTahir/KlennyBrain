'use client';

import { useMemo } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Citation } from '@app-starter/shared';

const GROUPED_MARKER = /\[(\d+(?:\s*,\s*\d+)+)\]/g;
const SINGLE_MARKER = /\[(\d+)\](?!\()/g;
const CITE_PREFIX = '#cite-';

function linkifyCitations(content: string): string {
  const expanded = content.replace(GROUPED_MARKER, (_match, group: string) =>
    group
      .split(',')
      .map((part) => `[${part.trim()}]`)
      .join(''),
  );
  return expanded.replace(SINGLE_MARKER, (_match, n: string) => `[${n}](${CITE_PREFIX}${n})`);
}

export function AnswerMarkdown({
  content,
  citations,
  onCitationClick,
}: {
  content: string;
  citations: Citation[];
  onCitationClick?: (n: number) => void;
}) {
  const processed = useMemo(() => linkifyCitations(content), [content]);

  const components = useMemo<Components>(() => {
    const titleByN = new Map<number, string>();
    for (const citation of citations) {
      titleByN.set(citation.n, citation.title);
    }

    return {
      a: ({ href, children }) => {
        if (href && href.startsWith(CITE_PREFIX)) {
          const n = Number.parseInt(href.slice(CITE_PREFIX.length), 10);
          const title = titleByN.get(n);
          return (
            <button
              type="button"
              title={title ?? `Source ${n}`}
              aria-label={title ? `Source ${n}: ${title}` : `Source ${n}`}
              onClick={() => {
                onCitationClick?.(n);
                document
                  .getElementById(`cite-${n}`)
                  ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
              }}
              className="mx-0.5 inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-primary/10 px-1 align-super text-[10px] font-semibold leading-none text-primary transition-colors hover:bg-primary/20"
            >
              {Number.isNaN(n) ? children : n}
            </button>
          );
        }
        return (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-primary underline underline-offset-2 hover:opacity-80"
          >
            {children}
          </a>
        );
      },
      p: ({ children }) => <p className="leading-relaxed [&:not(:first-child)]:mt-3">{children}</p>,
      ul: ({ children }) => <ul className="mt-3 list-disc space-y-1 pl-5">{children}</ul>,
      ol: ({ children }) => <ol className="mt-3 list-decimal space-y-1 pl-5">{children}</ol>,
      li: ({ children }) => <li className="leading-relaxed">{children}</li>,
      strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
      em: ({ children }) => <em className="italic">{children}</em>,
      h1: ({ children }) => <h3 className="mt-4 text-lg font-semibold">{children}</h3>,
      h2: ({ children }) => <h3 className="mt-4 text-base font-semibold">{children}</h3>,
      h3: ({ children }) => <h4 className="mt-3 text-sm font-semibold">{children}</h4>,
      h4: ({ children }) => <h4 className="mt-3 text-sm font-semibold">{children}</h4>,
      blockquote: ({ children }) => (
        <blockquote className="mt-3 border-l-2 pl-3 text-muted-foreground">{children}</blockquote>
      ),
      code: ({ children }) => (
        <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">{children}</code>
      ),
      pre: ({ children }) => (
        <pre className="mt-3 overflow-x-auto rounded-lg bg-muted p-3 font-mono text-xs [&_code]:bg-transparent [&_code]:p-0">
          {children}
        </pre>
      ),
      hr: () => <hr className="my-4 border-border" />,
      table: ({ children }) => (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full border-collapse border text-sm">{children}</table>
        </div>
      ),
      thead: ({ children }) => <thead className="bg-muted">{children}</thead>,
      th: ({ children }) => (
        <th className="border px-3 py-1.5 text-left font-semibold">{children}</th>
      ),
      td: ({ children }) => <td className="border px-3 py-1.5 align-top">{children}</td>,
    };
  }, [citations, onCitationClick]);

  return (
    <div className="text-sm text-foreground">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {processed}
      </ReactMarkdown>
    </div>
  );
}