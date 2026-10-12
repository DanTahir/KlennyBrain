'use client';

import { use, useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { Loader2, Zap } from 'lucide-react';
import type { AgentActionStatus } from '@app-starter/shared';
import { Card, CardContent } from '@/components/ui/card';
import { PageContainer } from '@/components/layout/PageContainer';
import { PageHeader } from '@/components/layout/PageHeader';
import { ActionCard } from '@/components/brain/ActionCard';
import { brainApi } from '@/lib/brain-api';
import { isApiErrorLike } from '@/lib/sse';

interface PageProps {
  params: Promise<{ organizationId: string }>;
}

type FilterKey = 'ALL' | Extract<AgentActionStatus, 'PROPOSED' | 'EXECUTED' | 'FAILED' | 'REJECTED'>;

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'ALL', label: 'All' },
  { key: 'PROPOSED', label: 'Proposed' },
  { key: 'EXECUTED', label: 'Executed' },
  { key: 'FAILED', label: 'Failed' },
  { key: 'REJECTED', label: 'Rejected' },
];

function errorMessage(err: unknown, fallback: string): string {
  if (isApiErrorLike(err)) return err.message;
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

function createdTime(iso: string): number {
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? 0 : t;
}

export default function ActionsPage({ params }: PageProps) {
  const { organizationId } = use(params);
  const [filter, setFilter] = useState<FilterKey>('ALL');

  const actions = useQuery({
    queryKey: ['actions', organizationId],
    queryFn: () => brainApi.listActions(organizationId),
    refetchInterval: 10000,
  });

  const all = useMemo(
    () => [...(actions.data ?? [])].sort((a, b) => createdTime(b.createdAt) - createdTime(a.createdAt)),
    [actions.data],
  );

  const counts = useMemo(() => {
    const result: Record<FilterKey, number> = {
      ALL: all.length,
      PROPOSED: 0,
      EXECUTED: 0,
      FAILED: 0,
      REJECTED: 0,
    };
    for (const action of all) {
      if (
        action.status === 'PROPOSED' ||
        action.status === 'EXECUTED' ||
        action.status === 'FAILED' ||
        action.status === 'REJECTED'
      ) {
        result[action.status] += 1;
      }
    }
    return result;
  }, [all]);

  const visible = filter === 'ALL' ? all : all.filter((a) => a.status === filter);

  if (actions.isLoading) {
    return (
      <PageContainer>
        <div className="flex justify-center py-24">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-label="Loading" />
        </div>
      </PageContainer>
    );
  }

  const base = `/organizations/${organizationId}`;

  return (
    <PageContainer>
      <div className="mx-auto max-w-4xl space-y-6 px-4 py-8">
        <PageHeader
          title="Agent actions"
          description="Everything the agent proposed — GitHub issues, Slack posts and doc fixes. Nothing runs until an owner or admin approves it."
        />

        <div className="-mb-px flex gap-1 overflow-x-auto border-b" role="tablist">
          {FILTERS.map((f) => {
            const active = f.key === filter;
            return (
              <button
                key={f.key}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setFilter(f.key)}
                className={clsx(
                  'flex shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors',
                  active
                    ? 'border-primary text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
              >
                {f.label}
                <span className="rounded-full bg-muted px-1.5 text-xs tabular-nums text-muted-foreground">
                  {counts[f.key]}
                </span>
              </button>
            );
          })}
        </div>

        <section className="space-y-4" aria-label="Agent actions">
          {actions.isError && (
            <p className="text-sm text-destructive">
              {errorMessage(actions.error, 'Could not load agent actions.')}
            </p>
          )}

          {!actions.isError && all.length === 0 && (
            <Card>
              <CardContent className="space-y-3 py-10 text-center text-sm text-muted-foreground">
                <Zap className="mx-auto h-6 w-6 text-primary" aria-hidden="true" />
                <p>
                  No actions yet. Ask the brain to file an issue or post an update, or use “Fix it
                  with the agent” on an insight.
                </p>
                <div className="flex justify-center gap-4">
                  <Link href={`${base}/ask`} className="font-medium text-primary hover:underline">
                    Ask the brain
                  </Link>
                  <Link
                    href={`${base}/insights`}
                    className="font-medium text-primary hover:underline"
                  >
                    View insights
                  </Link>
                </div>
              </CardContent>
            </Card>
          )}

          {!actions.isError && all.length > 0 && visible.length === 0 && (
            <p className="text-sm text-muted-foreground">No actions with this status.</p>
          )}

          {visible.map((action) => (
            <ActionCard key={action.id} organizationId={organizationId} action={action} />
          ))}
        </section>
      </div>
    </PageContainer>
  );
}