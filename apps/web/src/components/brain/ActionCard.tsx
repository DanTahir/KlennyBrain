'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import clsx from 'clsx';
import {
  Check,
  ExternalLink,
  FileText,
  GitBranch,
  Hash,
  Loader2,
  Mail,
  X,
  type LucideIcon,
} from 'lucide-react';
import type { AgentActionDto, AgentActionStatus, AgentActionType } from '@app-starter/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { brainApi } from '@/lib/brain-api';
import { isApiErrorLike } from '@/lib/sse';

const TYPE_META: Record<AgentActionType, { icon: LucideIcon; label: string }> = {
  CREATE_GITHUB_ISSUE: { icon: GitBranch, label: 'GitHub issue' },
  POST_SLACK_MESSAGE: { icon: Hash, label: 'Slack message' },
  UPDATE_KNOWLEDGE_DOC: { icon: FileText, label: 'Doc update' },
  SEND_EMAIL: { icon: Mail, label: 'Email' },
};

const STATUS_CLASSES: Record<AgentActionStatus, string> = {
  PROPOSED: 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  APPROVED: 'border-blue-500/40 bg-blue-500/10 text-blue-700 dark:text-blue-300',
  EXECUTED: 'border-green-500/40 bg-green-500/10 text-green-700 dark:text-green-300',
  FAILED: 'border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300',
  REJECTED: 'border-gray-400/40 bg-gray-500/10 text-gray-600 dark:text-gray-300',
};

function isForbidden(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const record = err as { status?: unknown; statusCode?: unknown };
  return record.status === 403 || record.statusCode === 403;
}

function errorMessage(err: unknown, fallback: string): string {
  if (isApiErrorLike(err)) return err.message;
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

function str(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function strArr(payload: Record<string, unknown>, key: string): string[] {
  const value = payload[key];
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string');
}

function relative(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return formatDistanceToNow(date, { addSuffix: true });
}

// ---------------------------------------------------------------------------
// Line diff (LCS)
// ---------------------------------------------------------------------------

type DiffLine = { kind: 'same' | 'add' | 'del'; text: string };
type DiffItem = DiffLine | { kind: 'gap'; count: number };

const MAX_DIFF_LINES = 400;

function lineDiff(previous: string, corrected: string): DiffLine[] {
  const a = previous.split('\n').slice(0, MAX_DIFF_LINES);
  const b = corrected.split('\n').slice(0, MAX_DIFF_LINES);
  const n = a.length;
  const m = b.length;
  const width = m + 1;
  const dp = new Array<number>((n + 1) * width).fill(0);
  const get = (i: number, j: number): number => dp[i * width + j] ?? 0;

  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i * width + j] =
        (a[i] ?? '') === (b[j] ?? '') ? get(i + 1, j + 1) + 1 : Math.max(get(i + 1, j), get(i, j + 1));
    }
  }

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    const left = a[i] ?? '';
    const right = b[j] ?? '';
    if (left === right) {
      out.push({ kind: 'same', text: left });
      i += 1;
      j += 1;
    } else if (get(i + 1, j) >= get(i, j + 1)) {
      out.push({ kind: 'del', text: left });
      i += 1;
    } else {
      out.push({ kind: 'add', text: right });
      j += 1;
    }
  }
  while (i < n) {
    out.push({ kind: 'del', text: a[i] ?? '' });
    i += 1;
  }
  while (j < m) {
    out.push({ kind: 'add', text: b[j] ?? '' });
    j += 1;
  }
  return out;
}

function collapseUnchanged(lines: DiffLine[]): DiffItem[] {
  const items: DiffItem[] = [];
  let run: DiffLine[] = [];
  const flush = () => {
    if (run.length > 6) {
      items.push(...run.slice(0, 2));
      items.push({ kind: 'gap', count: run.length - 4 });
      items.push(...run.slice(-2));
    } else {
      items.push(...run);
    }
    run = [];
  };
  for (const line of lines) {
    if (line.kind === 'same') {
      run.push(line);
    } else {
      flush();
      items.push(line);
    }
  }
  flush();
  return items;
}

function DocDiff({ previous, corrected }: { previous: string; corrected: string }) {
  const items = useMemo(() => collapseUnchanged(lineDiff(previous, corrected)), [previous, corrected]);
  return (
    <div className="mt-2 max-h-96 overflow-auto rounded-md border bg-muted/30 p-2 font-mono text-xs">
      {items.map((item, idx) => {
        if (item.kind === 'gap') {
          return (
            <div key={idx} className="py-0.5 italic text-muted-foreground">
              … {item.count} unchanged lines
            </div>
          );
        }
        return (
          <div
            key={idx}
            className={clsx(
              'whitespace-pre-wrap break-words',
              item.kind === 'add' && 'bg-green-500/10 text-green-700 dark:text-green-300',
              item.kind === 'del' && 'bg-red-500/10 text-red-700 dark:text-red-300',
              item.kind === 'same' && 'text-muted-foreground',
            )}
          >
            {item.kind === 'add' ? '+ ' : item.kind === 'del' ? '- ' : '  '}
            {item.text}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Payload previews
// ---------------------------------------------------------------------------

function PayloadPreview({ action }: { action: AgentActionDto }) {
  const payload = action.payload;

  if (action.type === 'CREATE_GITHUB_ISSUE') {
    const repo = str(payload, 'repo');
    const title = str(payload, 'title');
    const body = str(payload, 'body');
    const labels = strArr(payload, 'labels');
    return (
      <div className="space-y-2 text-sm">
        {repo && (
          <div className="text-xs text-muted-foreground">
            Repo <span className="font-mono text-foreground">{repo}</span>
          </div>
        )}
        {title && <div className="font-medium text-foreground">{title}</div>}
        {labels.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {labels.map((label) => (
              <span
                key={label}
                className="rounded-full border bg-muted/40 px-2 py-0.5 text-xs text-muted-foreground"
              >
                {label}
              </span>
            ))}
          </div>
        )}
        {body && (
          <details>
            <summary className="cursor-pointer text-xs font-medium text-primary">Issue body</summary>
            <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded-md border bg-muted/30 p-2 font-sans text-xs text-foreground">
              {body}
            </pre>
          </details>
        )}
      </div>
    );
  }

  if (action.type === 'POST_SLACK_MESSAGE') {
    const channel = str(payload, 'channel');
    const text = str(payload, 'text');
    return (
      <div className="space-y-2 text-sm">
        {channel && (
          <div className="font-mono text-xs text-foreground">
            #{channel.replace(/^#/, '')}
          </div>
        )}
        {text && (
          <blockquote className="whitespace-pre-wrap border-l-4 border-primary/40 bg-muted/30 py-1.5 pl-3 pr-2 text-sm text-foreground">
            {text}
          </blockquote>
        )}
      </div>
    );
  }

  if (action.type === 'UPDATE_KNOWLEDGE_DOC') {
    const title = str(payload, 'title');
    const reason = str(payload, 'reason');
    const previousBody = str(payload, 'previousBody') ?? '';
    const correctedBody = str(payload, 'correctedBody') ?? '';
    return (
      <div className="space-y-2 text-sm">
        {title && <div className="font-medium text-foreground">{title}</div>}
        {reason && (
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">Reason: </span>
            {reason}
          </p>
        )}
        {(previousBody || correctedBody) && (
          <details>
            <summary className="cursor-pointer text-xs font-medium text-primary">View changes</summary>
            <DocDiff previous={previousBody} corrected={correctedBody} />
          </details>
        )}
      </div>
    );
  }

  return null;
}

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

export function ActionCard({
  organizationId,
  action,
  compact,
}: {
  organizationId: string;
  action: AgentActionDto;
  compact?: boolean;
}) {
  const queryClient = useQueryClient();
  const [current, setCurrent] = useState<AgentActionDto>(action);

  useEffect(() => {
    setCurrent(action);
  }, [action]);

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['actions', organizationId] }),
      queryClient.invalidateQueries({ queryKey: ['insights', organizationId] }),
    ]);
  };

  const approve = useMutation({
    mutationFn: () => brainApi.approveAction(organizationId, current.id),
    onSuccess: async (data) => {
      setCurrent(data);
      await invalidate();
    },
  });

  const reject = useMutation({
    mutationFn: () => brainApi.rejectAction(organizationId, current.id),
    onSuccess: async (data) => {
      setCurrent(data);
      await invalidate();
    },
  });

  const meta = TYPE_META[current.type] ?? { icon: FileText, label: current.type };
  const Icon = meta.icon;
  const pending = approve.isPending || reject.isPending;
  const canDecide = current.status === 'PROPOSED' || current.status === 'FAILED';
  const mutationError = approve.error ?? reject.error;
  const created = relative(current.createdAt);
  const resolvedRaw = current.result?.resolvedInsights;
  const resolvedInsights = typeof resolvedRaw === 'number' ? resolvedRaw : 0;
  const resultUrl = typeof current.result?.url === 'string' ? current.result.url : null;

  return (
    <Card>
      <CardContent className={clsx('space-y-3', compact ? 'p-3' : 'p-5')}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {meta.label}
            </div>
            <h3 className={clsx('font-semibold text-foreground', compact ? 'text-sm' : 'text-base')}>
              {current.title}
            </h3>
          </div>
          <span
            className={clsx(
              'inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 text-xs font-medium',
              STATUS_CLASSES[current.status],
            )}
          >
            {current.status === 'APPROVED' && (
              <Loader2 className="mr-1 h-3 w-3 animate-spin" aria-hidden="true" />
            )}
            {current.status}
          </span>
        </div>

        {!compact && (created || current.requestedBy || current.approvedBy) && (
          <div className="text-xs text-muted-foreground">
            {[
              created ? `Created ${created}` : null,
              current.requestedBy
                ? `Requested by ${current.requestedBy.name ?? current.requestedBy.email}`
                : null,
              current.approvedBy
                ? `${current.status === 'REJECTED' ? 'Rejected' : 'Approved'} by ${
                    current.approvedBy.name ?? current.approvedBy.email
                  }`
                : null,
            ]
              .filter((part): part is string => Boolean(part))
              .join(' · ')}
          </div>
        )}

        {current.summary && (
          <p className="whitespace-pre-line text-sm text-muted-foreground">{current.summary}</p>
        )}

        <PayloadPreview action={current} />

        {current.status === 'FAILED' && current.error && (
          <p className="text-sm text-red-600 dark:text-red-400">{current.error}</p>
        )}

        {current.status === 'EXECUTED' && (
          <div className="space-y-1 text-sm">
            {resultUrl && (
              <a
                href={resultUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
              >
                View result ↗
                <span className="sr-only">(opens in a new tab)</span>
              </a>
            )}
            {current.type === 'UPDATE_KNOWLEDGE_DOC' && (
              <>
                {resolvedInsights > 0 && (
                  <p className="text-green-700 dark:text-green-300">
                    Resolved {resolvedInsights} insight{resolvedInsights === 1 ? '' : 's'}
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  HydraDB re-indexes the updated doc in the background (about a minute).
                </p>
              </>
            )}
          </div>
        )}

        {canDecide && (
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={() => approve.mutate()} disabled={pending}>
              {approve.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Check className="h-4 w-4" aria-hidden="true" />
              )}
              {approve.isPending
                ? 'Running…'
                : current.status === 'FAILED'
                  ? 'Retry'
                  : 'Approve & run'}
            </Button>
            <Button size="sm" variant="outline" onClick={() => reject.mutate()} disabled={pending}>
              {reject.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <X className="h-4 w-4" aria-hidden="true" />
              )}
              Reject
            </Button>
          </div>
        )}

        {mutationError && (
          <p className="text-sm text-red-600 dark:text-red-400">
            {isForbidden(mutationError)
              ? 'Only organization owners and admins can approve agent actions.'
              : errorMessage(mutationError, 'Something went wrong.')}
          </p>
        )}

        {!compact && resultUrl && current.status !== 'EXECUTED' && (
          <a
            href={resultUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary"
          >
            <ExternalLink className="h-3 w-3" aria-hidden="true" />
            Related link
          </a>
        )}
      </CardContent>
    </Card>
  );
}