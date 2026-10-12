'use client';

import { use, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import clsx from 'clsx';
import { CheckCircle2, Lightbulb, Loader2, RefreshCw, XCircle } from 'lucide-react';
import type { InsightDto, InsightStatus, InsightType } from '@app-starter/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PageContainer } from '@/components/layout/PageContainer';
import { PageHeader } from '@/components/layout/PageHeader';
import { InsightCard } from '@/components/brain/InsightCard';
import { brainApi } from '@/lib/brain-api';
import { isApiErrorLike } from '@/lib/sse';

interface PageProps {
  params: Promise<{ organizationId: string }>;
}

type TabKey = 'issues' | 'actions' | 'decisions';
type StatusFilter = InsightStatus | 'ALL';

const TABS: { key: TabKey; label: string; types: InsightType[] }[] = [
  { key: 'issues', label: 'Contradictions & stale docs', types: ['CONTRADICTION', 'STALE_DOC'] },
  { key: 'actions', label: 'Action items', types: ['ACTION_ITEM'] },
  { key: 'decisions', label: 'Decisions', types: ['DECISION'] },
];

const STATUS_FILTERS: { key: StatusFilter; label: string }[] = [
  { key: 'OPEN', label: 'Open' },
  { key: 'RESOLVED', label: 'Resolved' },
  { key: 'DISMISSED', label: 'Dismissed' },
  { key: 'ALL', label: 'All' },
];

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

function time(iso: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : t;
}

function isOverdue(insight: InsightDto, now: number): boolean {
  const due = time(insight.dueAt);
  return insight.status === 'OPEN' && due !== null && due < now;
}

function sortForTab(tab: TabKey, items: InsightDto[]): InsightDto[] {
  const sorted = [...items];
  if (tab === 'actions') {
    const now = Date.now();
    sorted.sort((a, b) => {
      const oa = isOverdue(a, now) ? 0 : 1;
      const ob = isOverdue(b, now) ? 0 : 1;
      if (oa !== ob) return oa - ob;
      const da = time(a.dueAt);
      const db = time(b.dueAt);
      if (da === null && db === null) return 0;
      if (da === null) return 1;
      if (db === null) return -1;
      return da - db;
    });
  } else if (tab === 'decisions') {
    sorted.sort((a, b) => (time(b.occurredAt) ?? 0) - (time(a.occurredAt) ?? 0));
  }
  return sorted;
}

export default function InsightsPage({ params }: PageProps) {
  const { organizationId } = use(params);
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<TabKey>('issues');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('OPEN');

  const analysis = useQuery({
    queryKey: ['insight-analysis', organizationId],
    queryFn: () => brainApi.getInsightAnalysis(organizationId),
    refetchInterval: (query) => (query.state.data?.status === 'RUNNING' ? 3000 : false),
  });

  const insights = useQuery({
    queryKey: ['insights', organizationId, statusFilter],
    queryFn: () =>
      brainApi.listInsights(
        organizationId,
        statusFilter === 'ALL' ? {} : { status: statusFilter },
      ),
  });

  const analysisStatus = analysis.data?.status;
  const previousStatus = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (previousStatus.current === 'RUNNING' && analysisStatus && analysisStatus !== 'RUNNING') {
      void queryClient.invalidateQueries({ queryKey: ['insights', organizationId] });
    }
    previousStatus.current = analysisStatus;
  }, [analysisStatus, organizationId, queryClient]);

  const analyze = useMutation({
    mutationFn: () => brainApi.analyzeInsights(organizationId),
    onSuccess: (data) => {
      queryClient.setQueryData(['insight-analysis', organizationId], data);
    },
  });

  const allInsights = useMemo(() => insights.data ?? [], [insights.data]);

  const openCounts = useMemo(() => {
    const counts: Record<TabKey, number> = { issues: 0, actions: 0, decisions: 0 };
    for (const t of TABS) {
      counts[t.key] = allInsights.filter(
        (i) => i.status === 'OPEN' && t.types.includes(i.type),
      ).length;
    }
    return counts;
  }, [allInsights]);

  const activeTab = TABS.find((t) => t.key === tab) ?? TABS[0];
  const visible = useMemo(() => {
    if (!activeTab) return [];
    return sortForTab(
      activeTab.key,
      allInsights.filter((i) => activeTab.types.includes(i.type)),
    );
  }, [activeTab, allInsights]);

  if (insights.isLoading || analysis.isLoading) {
    return (
      <PageContainer>
        <div className="flex justify-center py-24">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-label="Loading" />
        </div>
      </PageContainer>
    );
  }

  const running = analysisStatus === 'RUNNING';
  const analysisData = analysis.data;

  const runButton = (
    <Button onClick={() => analyze.mutate()} disabled={analyze.isPending || running}>
      {analyze.isPending || running ? (
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      ) : (
        <RefreshCw className="h-4 w-4" aria-hidden="true" />
      )}
      Run analysis
    </Button>
  );

  const showFirstRun =
    !insights.isError && allInsights.length === 0 && analysisStatus === 'IDLE';

  return (
    <PageContainer>
      <div className="mx-auto max-w-4xl space-y-6 px-4 py-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <PageHeader
            title="Insights"
            description="What the brain noticed across Slack, email, meetings, tickets and docs: contradictions, stale docs, decisions and overdue action items."
          />
          {runButton}
        </div>

        {analyze.isError && (
          <p className="text-sm text-destructive">
            {isForbidden(analyze.error)
              ? 'Only organization owners and admins can run insight analysis.'
              : errorMessage(analyze.error, 'Could not start the analysis.')}
          </p>
        )}

        {analysis.isError && (
          <p className="text-sm text-destructive">
            {errorMessage(analysis.error, 'Could not load the analysis status.')}
          </p>
        )}

        {analysisData && analysisData.status !== 'IDLE' && (
          <div
            className={clsx(
              'flex items-start gap-2 rounded-lg border px-3 py-2 text-sm',
              analysisData.status === 'FAILED'
                ? 'border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300'
                : 'bg-muted/40 text-muted-foreground',
            )}
            role="status"
          >
            {analysisData.status === 'RUNNING' && (
              <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />
            )}
            {analysisData.status === 'SUCCEEDED' && (
              <CheckCircle2
                className="mt-0.5 h-4 w-4 shrink-0 text-green-600 dark:text-green-400"
                aria-hidden="true"
              />
            )}
            {analysisData.status === 'FAILED' && (
              <XCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            )}
            <div>
              {analysisData.status === 'RUNNING' && (
                <span>{analysisData.message ?? 'Analyzing the brain…'}</span>
              )}
              {analysisData.status === 'SUCCEEDED' && (
                <span>{analysisData.message ?? 'Analysis complete.'}</span>
              )}
              {analysisData.status === 'FAILED' && (
                <span>{analysisData.error ?? analysisData.message ?? 'Analysis failed.'}</span>
              )}
              {analysisData.status !== 'RUNNING' && analysisData.finishedAt && (
                <span className="ml-1 text-xs opacity-80">
                  · finished{' '}
                  {formatDistanceToNow(new Date(analysisData.finishedAt), { addSuffix: true })}
                </span>
              )}
            </div>
          </div>
        )}

        {showFirstRun ? (
          <Card className="border-primary/40 bg-primary/10">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Lightbulb className="h-5 w-5 text-primary" aria-hidden="true" />
                No insights yet — run analysis to scan the brain.
              </CardTitle>
              <CardDescription>
                The agent looks for contradicting docs, stale knowledge, decisions and action items
                across every connected source.
              </CardDescription>
            </CardHeader>
            <CardContent>{runButton}</CardContent>
          </Card>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="-mb-px flex gap-1 overflow-x-auto border-b" role="tablist">
                {TABS.map((t) => {
                  const active = t.key === tab;
                  return (
                    <button
                      key={t.key}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      onClick={() => setTab(t.key)}
                      className={clsx(
                        'flex shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors',
                        active
                          ? 'border-primary text-foreground'
                          : 'border-transparent text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {t.label}
                      <span className="rounded-full bg-muted px-1.5 text-xs tabular-nums text-muted-foreground">
                        {openCounts[t.key]}
                      </span>
                    </button>
                  );
                })}
              </div>
              <div className="inline-flex rounded-lg border bg-muted/40 p-0.5" role="group" aria-label="Status filter">
                {STATUS_FILTERS.map((f) => (
                  <button
                    key={f.key}
                    type="button"
                    aria-pressed={statusFilter === f.key}
                    onClick={() => setStatusFilter(f.key)}
                    className={clsx(
                      'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                      statusFilter === f.key
                        ? 'bg-background text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            <section className="space-y-4" aria-label="Insights">
              {insights.isError && (
                <p className="text-sm text-destructive">
                  {errorMessage(insights.error, 'Could not load insights.')}
                </p>
              )}
              {!insights.isError && visible.length === 0 && (
                <Card>
                  <CardContent className="py-10 text-center text-sm text-muted-foreground">
                    Nothing here 🎉
                  </CardContent>
                </Card>
              )}
              {visible.map((insight) => (
                <InsightCard key={insight.id} organizationId={organizationId} insight={insight} />
              ))}
            </section>
          </>
        )}
      </div>
    </PageContainer>
  );
}