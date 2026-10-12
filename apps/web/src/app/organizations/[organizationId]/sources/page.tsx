'use client';

import { use } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';
import clsx from 'clsx';
import { CheckCircle2, Database, Loader2, Plug, RefreshCw, Sparkles, XCircle } from 'lucide-react';
import type { BrainStatus, SourceDto, SourceStatus } from '@app-starter/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PageContainer } from '@/components/layout/PageContainer';
import { PageHeader } from '@/components/layout/PageHeader';
import { SyncProgress } from '@/components/brain/SyncProgress';
import { brainApi } from '@/lib/brain-api';
import { isApiErrorLike } from '@/lib/sse';

interface PageProps {
  params: Promise<{ organizationId: string }>;
}

const TEN_MINUTES_MS = 10 * 60 * 1000;

function isSourceSyncActive(source: SourceDto): boolean {
  if (source.status === 'SYNCING') return true;
  const job = source.latestJob;
  if (!job) return false;
  if (job.status === 'QUEUED' || job.status === 'RUNNING') return true;
  if (job.status === 'SUCCEEDED' && job.indexed < job.total - job.failed) {
    const finished = job.finishedAt ? new Date(job.finishedAt).getTime() : Date.now();
    return Date.now() - finished < TEN_MINUTES_MS;
  }
  return false;
}

function isAnySyncActive(sources: SourceDto[] | undefined): boolean {
  return (sources ?? []).some(isSourceSyncActive);
}

function brainStatusVariant(status: BrainStatus): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'READY') return 'default';
  if (status === 'ERROR') return 'destructive';
  if (status === 'NOT_PROVISIONED') return 'outline';
  return 'secondary';
}

function sourceStatusVariant(status: SourceStatus): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'READY') return 'default';
  if (status === 'ERROR') return 'destructive';
  if (status === 'SYNCING') return 'secondary';
  return 'outline';
}

function errorMessage(err: unknown, fallback: string): string {
  if (isApiErrorLike(err)) return err.message;
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

const SOURCE_SYSTEM_LABELS: Record<string, string> = {
  slack: 'Slack',
  email: 'Email',
  doc: 'Docs',
  meeting: 'Meetings',
  ticket: 'Tickets',
  issue: 'Issues',
};

function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border bg-muted/40 px-3 py-2">
      <div className="text-xl font-semibold tabular-nums text-foreground">{value.toLocaleString()}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function IntegrationChip({ label, ready }: { label: string; ready: boolean }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium',
        ready ? 'text-foreground' : 'text-muted-foreground',
      )}
    >
      {ready ? (
        <CheckCircle2 className="h-3.5 w-3.5 text-green-600 dark:text-green-400" aria-hidden="true" />
      ) : (
        <XCircle className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
      )}
      {label}
      <span className="sr-only">{ready ? 'configured' : 'not configured'}</span>
    </span>
  );
}

export default function SourcesPage({ params }: PageProps) {
  const { organizationId } = use(params);
  const queryClient = useQueryClient();

  const sources = useQuery({
    queryKey: ['sources', organizationId],
    queryFn: () => brainApi.listSources(organizationId),
    refetchInterval: (query) => (isAnySyncActive(query.state.data) ? 3000 : false),
  });

  const sourcesActive = isAnySyncActive(sources.data);

  const brain = useQuery({
    queryKey: ['brain', organizationId],
    queryFn: () => brainApi.getBrain(organizationId),
    refetchInterval: (query) =>
      query.state.data?.status === 'PROVISIONING' || sourcesActive ? 5000 : false,
  });

  const canManage = brain.data?.viewer.canViewAs === true;

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['sources', organizationId] }),
      queryClient.invalidateQueries({ queryKey: ['brain', organizationId] }),
    ]);
  };

  const loadDemo = useMutation({
    mutationFn: () => brainApi.loadDemo(organizationId),
    onSuccess: async () => {
      toast.success('Loading Northwind Robotics into HydraDB…');
      await invalidate();
    },
    onError: (err: unknown) => {
      toast.error(errorMessage(err, 'Could not load the demo company'));
    },
  });

  const syncSource = useMutation({
    mutationFn: (sourceId: string) => brainApi.syncSource(organizationId, sourceId),
    onSuccess: async () => {
      toast.success('Sync started');
      await invalidate();
    },
    onError: (err: unknown) => {
      toast.error(errorMessage(err, 'Could not start the sync'));
    },
  });

  if (brain.isLoading || sources.isLoading) {
    return (
      <PageContainer>
        <div className="flex justify-center py-24">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-label="Loading" />
        </div>
      </PageContainer>
    );
  }

  const sourceList = sources.data ?? [];
  const hasDemo = sourceList.some((s) => s.type === 'DEMO');
  const brainData = brain.data;

  return (
    <PageContainer>
      <div className="mx-auto max-w-4xl space-y-8 px-4 py-8">
        <PageHeader
          title="Sources"
          description="Everything the brain knows comes from these sources. All content is stored in HydraDB with per-item access control."
        />

        {brainData ? (
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Database className="h-5 w-5 text-primary" aria-hidden="true" />
                  Brain
                </CardTitle>
                <Badge variant={brainStatusVariant(brainData.status)}>
                  {brainData.status === 'PROVISIONING' && (
                    <Loader2 className="mr-1 h-3 w-3 animate-spin" aria-hidden="true" />
                  )}
                  {brainData.status.replace('_', ' ')}
                </Badge>
              </div>
              <CardDescription>
                HydraDB database{' '}
                <span className="font-mono text-foreground">
                  {brainData.hydraDatabase ?? 'not provisioned'}
                </span>
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {brainData.error && <p className="text-sm text-destructive">{brainData.error}</p>}

              <div className="flex flex-wrap gap-2">
                <IntegrationChip label="HydraDB" ready={brainData.integrations.hydra} />
                <IntegrationChip label="OpenRouter LLM" ready={brainData.integrations.llm} />
                <IntegrationChip label="Slack bot" ready={brainData.integrations.slack} />
                <IntegrationChip label="GitHub" ready={brainData.integrations.github} />
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <StatTile label="Total items" value={brainData.stats.items} />
                <StatTile label="People" value={brainData.stats.people} />
                {Object.entries(brainData.stats.bySourceSystem).map(([system, count]) => (
                  <StatTile
                    key={system}
                    label={SOURCE_SYSTEM_LABELS[system] ?? system}
                    value={count}
                  />
                ))}
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="py-6 text-sm text-destructive">
              {errorMessage(brain.error, 'Could not load the brain status.')}
            </CardContent>
          </Card>
        )}

        {!hasDemo && (
          <Card className="border-primary/40 bg-primary/10">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Sparkles className="h-5 w-5 text-primary" aria-hidden="true" />
                Load the demo company
              </CardTitle>
              <CardDescription>
                Northwind Robotics: 14 people, ~350 Slack messages, emails, docs, meetings, tickets and
                issues with planted contradictions, blockers and restricted HR content.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {canManage ? (
                <Button onClick={() => loadDemo.mutate()} disabled={loadDemo.isPending}>
                  {loadDemo.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Sparkles className="h-4 w-4" aria-hidden="true" />
                  )}
                  Load demo company
                </Button>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Ask an owner or admin to load the demo data.
                </p>
              )}
            </CardContent>
          </Card>
        )}

        <section className="space-y-4" aria-label="Connected sources">
          {sources.isError && (
            <p className="text-sm text-destructive">
              {errorMessage(sources.error, 'Could not load sources.')}
            </p>
          )}
          {sourceList.length === 0 && !sources.isError && (
            <p className="text-sm text-muted-foreground">No sources connected yet.</p>
          )}
          {sourceList.map((source) => {
            const syncingThis = syncSource.isPending && syncSource.variables === source.id;
            return (
              <Card key={source.id}>
                <CardContent className="space-y-3 p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-base font-semibold text-foreground">{source.name}</h2>
                        <Badge variant="outline">{source.type}</Badge>
                        <Badge variant={sourceStatusVariant(source.status)}>
                          {source.status === 'SYNCING' && (
                            <Loader2 className="mr-1 h-3 w-3 animate-spin" aria-hidden="true" />
                          )}
                          {source.status}
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {source.itemCount.toLocaleString()} items · Last synced{' '}
                        {source.lastSyncedAt
                          ? formatDistanceToNow(new Date(source.lastSyncedAt), { addSuffix: true })
                          : 'never'}
                      </p>
                    </div>
                    {canManage && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => syncSource.mutate(source.id)}
                        disabled={source.status === 'SYNCING' || syncingThis}
                      >
                        <RefreshCw
                          className={clsx('h-4 w-4', syncingThis && 'animate-spin')}
                          aria-hidden="true"
                        />
                        Sync now
                      </Button>
                    )}
                  </div>
                  {source.error && <p className="text-sm text-destructive">{source.error}</p>}
                  <SyncProgress job={source.latestJob} />
                </CardContent>
              </Card>
            );
          })}
        </section>

        <Card className="bg-muted/40">
          <CardContent className="flex items-center gap-3 p-4 text-sm text-muted-foreground">
            <Plug className="h-4 w-4 shrink-0" aria-hidden="true" />
            Slack (real-time) and other connectors plug in through the same SourceAdapter interface.
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  );
}