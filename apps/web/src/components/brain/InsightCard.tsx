'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { differenceInCalendarDays, format } from 'date-fns';
import clsx from 'clsx';
import { ExternalLink, Loader2, Sparkles } from 'lucide-react';
import type {
  Citation,
  InsightDto,
  InsightSeverity,
  InsightStatus,
  InsightType,
} from '@app-starter/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ActionCard } from '@/components/brain/ActionCard';
import { brainApi } from '@/lib/brain-api';
import { isApiErrorLike } from '@/lib/sse';

const TYPE_META: Record<InsightType, { label: string; className: string }> = {
  CONTRADICTION: {
    label: 'Contradiction',
    className: 'border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300',
  },
  STALE_DOC: {
    label: 'Stale doc',
    className: 'border-orange-500/40 bg-orange-500/10 text-orange-700 dark:text-orange-300',
  },
  DECISION: {
    label: 'Decision',
    className: 'border-indigo-500/40 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300',
  },
  ACTION_ITEM: {
    label: 'Action item',
    className: 'border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300',
  },
};

const SEVERITY_META: Record<InsightSeverity, { label: string; dot: string; text: string }> = {
  HIGH: { label: 'High', dot: 'bg-red-500', text: 'text-red-700 dark:text-red-300' },
  MEDIUM: { label: 'Medium', dot: 'bg-amber-500', text: 'text-amber-700 dark:text-amber-300' },
  LOW: { label: 'Low', dot: 'bg-gray-400', text: 'text-muted-foreground' },
};

const FIXABLE: InsightType[] = ['CONTRADICTION', 'STALE_DOC', 'ACTION_ITEM'];

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

function parseDate(iso: string | null): Date | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

function shortDate(iso: string | null): string | null {
  const date = parseDate(iso);
  return date ? format(date, 'yyyy-MM-dd') : null;
}

function EvidenceItem({ citation }: { citation: Citation }) {
  const date = shortDate(citation.occurredAt);
  const meta = [String(citation.kind), citation.author, date].filter(
    (part): part is string => Boolean(part),
  );
  return (
    <li className="rounded-md border bg-background p-2 text-sm">
      <div className="flex items-start gap-2">
        <span className="shrink-0 text-xs font-semibold text-primary">[{citation.n}]</span>
        <div className="min-w-0 flex-1">
          {citation.url ? (
            <a
              href={citation.url}
              target="_blank"
              rel="noopener noreferrer"
              className="group inline-flex items-start gap-1 font-medium hover:text-primary"
            >
              <span>{citation.title}</span>
              <ExternalLink
                className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-60 group-hover:opacity-100"
                aria-hidden="true"
              />
            </a>
          ) : (
            <span className="font-medium">{citation.title}</span>
          )}
          {meta.length > 0 && (
            <div className="text-xs text-muted-foreground">{meta.join(' · ')}</div>
          )}
          {citation.snippet && (
            <details className="mt-1">
              <summary className="cursor-pointer text-xs font-medium text-primary">
                Show evidence
              </summary>
              <p className="mt-1 whitespace-pre-line text-xs text-muted-foreground">
                {citation.snippet}
              </p>
            </details>
          )}
        </div>
      </div>
    </li>
  );
}

export function InsightCard({
  organizationId,
  insight,
}: {
  organizationId: string;
  insight: InsightDto;
}) {
  const queryClient = useQueryClient();

  const fix = useMutation({
    mutationFn: () => brainApi.fixInsight(organizationId, insight.id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['actions', organizationId] });
    },
  });

  const updateStatus = useMutation({
    mutationFn: (status: InsightStatus) =>
      brainApi.updateInsight(organizationId, insight.id, { status }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['insights', organizationId] });
    },
  });

  const typeMeta = TYPE_META[insight.type];
  const severity = SEVERITY_META[insight.severity];
  const isOpen = insight.status === 'OPEN';
  const due = parseDate(insight.dueAt);
  const daysOverdue = due ? differenceInCalendarDays(new Date(), due) : 0;
  const overdue = isOpen && due !== null && daysOverdue > 0;
  const occurred = shortDate(insight.occurredAt);
  const canFix = isOpen && FIXABLE.includes(insight.type);
  const proposed = fix.data?.actions ?? [];

  return (
    <Card>
      <CardContent className="space-y-3 p-5">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={clsx(
              'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium',
              typeMeta.className,
            )}
          >
            {typeMeta.label}
          </span>
          <span className={clsx('inline-flex items-center gap-1.5 text-xs font-medium', severity.text)}>
            <span className={clsx('h-2 w-2 rounded-full', severity.dot)} aria-hidden="true" />
            {severity.label}
          </span>
          {!isOpen && (
            <span className="inline-flex items-center rounded-full border bg-muted/40 px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
              {insight.status}
            </span>
          )}
          {overdue && (
            <span className="inline-flex items-center rounded-full border border-red-500/40 bg-red-500/10 px-2.5 py-0.5 text-xs font-medium text-red-700 dark:text-red-300">
              Overdue · {daysOverdue} day{daysOverdue === 1 ? '' : 's'}
            </span>
          )}
        </div>

        <div className="space-y-1">
          <h2 className="text-base font-semibold text-foreground">{insight.title}</h2>
          <p className="whitespace-pre-line text-sm text-muted-foreground">{insight.summary}</p>
        </div>

        {(insight.ownerEmail || due || occurred) && (
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {insight.ownerEmail && (
              <span>
                Owner <span className="text-foreground">{insight.ownerEmail}</span>
              </span>
            )}
            {due && (
              <span className={clsx(overdue && 'text-red-600 dark:text-red-400')}>
                Due {format(due, 'yyyy-MM-dd')}
              </span>
            )}
            {occurred && <span>Noticed in content from {occurred}</span>}
          </div>
        )}

        {insight.evidence.length > 0 && (
          <div className="space-y-1.5">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Evidence
            </div>
            <ul className="space-y-1.5">
              {[...insight.evidence]
                .sort((a, b) => a.n - b.n)
                .map((citation) => (
                  <EvidenceItem key={`${citation.n}-${citation.hydraId}`} citation={citation} />
                ))}
            </ul>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 pt-1">
          {canFix && (
            <Button size="sm" onClick={() => fix.mutate()} disabled={fix.isPending}>
              {fix.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Sparkles className="h-4 w-4" aria-hidden="true" />
              )}
              {fix.isPending ? 'Agent is drafting fixes… (~30s)' : 'Fix it with the agent'}
            </Button>
          )}
          {isOpen ? (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={() => updateStatus.mutate('RESOLVED')}
                disabled={updateStatus.isPending}
              >
                Resolve
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => updateStatus.mutate('DISMISSED')}
                disabled={updateStatus.isPending}
              >
                Dismiss
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={() => updateStatus.mutate('OPEN')}
              disabled={updateStatus.isPending}
            >
              Reopen
            </Button>
          )}
          {updateStatus.isPending && (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label="Saving" />
          )}
        </div>

        {fix.isError && (
          <p className="text-sm text-red-600 dark:text-red-400">
            {errorMessage(fix.error, 'The agent could not draft fixes.')}
          </p>
        )}
        {updateStatus.isError && (
          <p className="text-sm text-red-600 dark:text-red-400">
            {isForbidden(updateStatus.error)
              ? 'Only owners and admins can change insight status.'
              : errorMessage(updateStatus.error, 'Could not update the insight.')}
          </p>
        )}

        {fix.isSuccess && (
          <div className="space-y-2 border-t pt-3">
            <div className="text-sm font-medium text-foreground">
              Proposed actions — nothing runs until approved
            </div>
            {proposed.length === 0 ? (
              <p className="text-sm text-muted-foreground">The agent did not propose any actions.</p>
            ) : (
              <div className="space-y-2">
                {proposed.map((action) => (
                  <ActionCard
                    key={action.id}
                    organizationId={organizationId}
                    action={action}
                    compact
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}