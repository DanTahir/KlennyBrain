'use client';

import { clsx } from 'clsx';
import { format } from 'date-fns';
import {
  ExternalLink,
  FileText,
  GitBranch,
  LifeBuoy,
  Mail,
  MessageSquare,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { Citation } from '@app-starter/shared';

const SOURCE_META: Record<string, { icon: LucideIcon; label: string }> = {
  slack: { icon: MessageSquare, label: 'Slack' },
  email: { icon: Mail, label: 'Email' },
  doc: { icon: FileText, label: 'Doc' },
  meeting: { icon: Users, label: 'Meeting' },
  ticket: { icon: LifeBuoy, label: 'Support ticket' },
  issue: { icon: GitBranch, label: 'Issue' },
};

function sourceMeta(sourceSystem: string | null): { icon: LucideIcon; label: string } {
  const meta = sourceSystem ? SOURCE_META[sourceSystem] : undefined;
  return meta ?? { icon: FileText, label: 'Doc' };
}

function authorName(author: string | null): string | null {
  if (!author) return null;
  const local = author.includes('@') ? author.split('@')[0] : author;
  if (!local) return null;
  return local.charAt(0).toUpperCase() + local.slice(1);
}

function formatDate(occurredAt: string | null): string | null {
  if (!occurredAt) return null;
  const date = new Date(occurredAt);
  if (Number.isNaN(date.getTime())) return null;
  return format(date, 'MMM d, yyyy');
}

export function SourceCard({
  citation,
  highlighted,
}: {
  citation: Citation;
  highlighted?: boolean;
}) {
  const { icon: Icon, label } = sourceMeta(citation.sourceSystem);
  const author = authorName(citation.author);
  const date = formatDate(citation.occurredAt);
  const meta = [author, date].filter((part): part is string => Boolean(part));

  return (
    <div
      id={`cite-${citation.n}`}
      className={clsx(
        'scroll-mt-24 rounded-lg border bg-background p-3 transition-shadow',
        highlighted && 'ring-2 ring-primary',
      )}
    >
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-primary/10 px-1 text-[10px] font-semibold text-primary">
          {citation.n}
        </span>
        <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className="font-medium">{label}</span>
      </div>
      <div className="mt-1.5 text-sm font-medium">
        {citation.url ? (
          <a
            href={citation.url}
            target="_blank"
            rel="noopener noreferrer"
            className="group inline-flex items-start gap-1 hover:text-primary"
          >
            <span className="line-clamp-2">{citation.title}</span>
            <ExternalLink
              className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-60 group-hover:opacity-100"
              aria-hidden="true"
            />
          </a>
        ) : (
          <span className="line-clamp-2">{citation.title}</span>
        )}
      </div>
      {meta.length > 0 && (
        <div className="mt-1 text-xs text-muted-foreground">{meta.join(' · ')}</div>
      )}
      {citation.snippet && (
        <p className="mt-1.5 line-clamp-3 text-xs text-muted-foreground">{citation.snippet}</p>
      )}
    </div>
  );
}

export function SourceList({
  citations,
  highlightedN,
}: {
  citations: Citation[];
  highlightedN?: number | null;
}) {
  if (citations.length === 0) return null;
  const sorted = [...citations].sort((a, b) => a.n - b.n);

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {sorted.map((citation) => (
        <SourceCard
          key={`${citation.n}-${citation.hydraId}`}
          citation={citation}
          highlighted={highlightedN === citation.n}
        />
      ))}
    </div>
  );
}