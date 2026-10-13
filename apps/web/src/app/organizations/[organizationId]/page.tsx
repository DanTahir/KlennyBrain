'use client';

import { use, useState, type FormEvent, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Database,
  ExternalLink,
  FileWarning,
  Gavel,
  Lightbulb,
  ListTodo,
  Loader2,
  Settings,
  Sparkles,
  UserPlus,
  Users,
  XCircle,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import type {
  AgentActionDto,
  AgentActionStatus,
  AgentActionType,
  BrainSpaceDto,
  InsightDto,
  InsightType,
} from '@app-starter/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { PageContainer } from '@/components/layout/PageContainer';
import { PageHeader } from '@/components/layout/PageHeader';
import { InviteOrganizationMembersDialog } from '@/components/organizations/InviteOrganizationMembersDialog';
import { organizationsApi } from '@/lib/organizations-api';
import { brainApi } from '@/lib/brain-api';
import { cn } from '@/lib/utils';

interface PageProps {
  params: Promise<{ organizationId: string }>;
}

const DEFAULT_DESCRIPTION =
  'Your company brain - cited, permission-aware answers across Slack, docs, email, meetings and tickets.';

const SUGGESTED_QUESTIONS: string[] = [
  'What is blocking the Atlas launch?',
  'When does Atlas launch and why did it move?',
  'What is our refund window?',
  'Who knows the billing service?',
  'What action items are overdue?',
];

const INSIGHT_ORDER: Record<InsightType, number> = {
  CONTRADICTION: 0,
  STALE_DOC: 1,
  ACTION_ITEM: 2,
  DECISION: 3,
};

const INSIGHT_META: Record<InsightType, { label: string; icon: LucideIcon; className: string }> = {
  CONTRADICTION: {
    label: 'Contradiction',
    icon: AlertTriangle,
    className: 'border-transparent bg-red-500/10 text-red-700 dark:text-red-400',
  },
  STALE_DOC: {
    label: 'Stale doc',
    icon: FileWarning,
    className: 'border-transparent bg-amber-500/10 text-amber-700 dark:text-amber-400',
  },
  ACTION_ITEM: {
    label: 'Action item',
    icon: ListTodo,
    className: 'border-transparent bg-blue-500/10 text-blue-700 dark:text-blue-400',
  },
  DECISION: {
    label: 'Decision',
    icon: Gavel,
    className: 'border-transparent bg-violet-500/10 text-violet-700 dark:text-violet-400',
  },
};

const ACTION_TYPE_LABELS: Record<AgentActionType, string> = {
  CREATE_GITHUB_ISSUE: 'GitHub issue',
  POST_SLACK_MESSAGE: 'Slack message',
  UPDATE_KNOWLEDGE_DOC: 'Doc update',
  SEND_EMAIL: 'Email',
};

const ACTION_STATUS_LABELS: Record<AgentActionStatus, string> = {
  PROPOSED: 'Proposed',
  APPROVED: 'Approved',
  EXECUTED: 'Executed',
  FAILED: 'Failed',
  REJECTED: 'Rejected',
};

const KIND_LABELS: Record<string, string> = {
  message: 'Slack messages',
  email: 'Emails',
  ticket: 'Tickets & issues',
  meeting: 'Meetings',
  knowledge_base: 'Docs & policies',
};

const SOURCE_LABELS: Record<string, string> = {
  slack: 'Slack',
  email: 'Email',
  doc: 'Docs',
  meeting: 'Meetings',
  ticket: 'Tickets',
  issue: 'Issues',
};

const INTEGRATION_LABELS: { key: keyof BrainSpaceDto['integrations']; label: string }[] = [
  { key: 'hydra', label: 'HydraDB' },
  { key: 'llm', label: 'OpenRouter LLM' },
  { key: 'slack', label: 'Slack bot' },
  { key: 'github', label: 'GitHub actions' },
];

function sortInsights(insights: InsightDto[]): InsightDto[] {
  return [...insights].sort((a, b) => {
    const ao = INSIGHT_ORDER[a.type] ?? 99;
    const bo = INSIGHT_ORDER[b.type] ?? 99;
    return ao - bo;
  });
}

function ActionStatusBadge({ status }: { status: AgentActionStatus }) {
  const label = ACTION_STATUS_LABELS[status] ?? status;
  if (status === 'EXECUTED') {
    return (
      <Badge
        variant="outline"
        className="border-transparent bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
      >
        {label}
      </Badge>
    );
  }
  if (status === 'PROPOSED') {
    return (
      <Badge
        variant="outline"
        className="border-transparent bg-amber-500/10 text-amber-700 dark:text-amber-400"
      >
        {label}
      </Badge>
    );
  }
  if (status === 'APPROVED') {
    return (
      <Badge
        variant="outline"
        className="border-transparent bg-blue-500/10 text-blue-700 dark:text-blue-400"
      >
        {label}
      </Badge>
    );
  }
  if (status === 'FAILED') {
    return <Badge variant="destructive">{label}</Badge>;
  }
  return <Badge variant="secondary">{label}</Badge>;
}

function actionTitle(action: AgentActionDto): string {
  const title = action.title?.trim();
  if (title) return title;
  const summary = action.summary?.trim();
  if (summary) return summary;
  return ACTION_TYPE_LABELS[action.type] ?? action.type;
}

function actionUrl(action: AgentActionDto): string | null {
  const url = action.result?.url;
  return typeof url === 'string' && url.length > 0 ? url : null;
}

interface StatCardProps {
  icon: LucideIcon;
  label: string;
  value: number | undefined;
  loading: boolean;
  href?: string;
}

function StatCard({ icon: Icon, label, value, loading, href }: StatCardProps) {
  const inner = (
    <Card
      className={cn(
        'h-full transition-colors',
        href && 'hover:border-primary/50 hover:bg-accent/40',
      )}
    >
      <CardContent className="flex items-center gap-4 p-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="h-5 w-5" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          {loading ? (
            <div className="mb-1 h-7 w-12 animate-pulse rounded bg-muted" />
          ) : (
            <div className="text-2xl font-semibold leading-tight tabular-nums">
              {typeof value === 'number' ? value.toLocaleString() : '-'}
            </div>
          )}
          <div className="truncate text-xs text-muted-foreground">{label}</div>
        </div>
      </CardContent>
    </Card>
  );

  if (href) {
    return (
      <Link href={href} className="block rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {inner}
      </Link>
    );
  }
  return inner;
}

function BarList({
  data,
  labels,
}: {
  data: Record<string, number> | undefined;
  labels: Record<string, string>;
}) {
  const entries = Object.entries(data ?? {})
    .filter(([, count]) => typeof count === 'number' && count > 0)
    .sort((a, b) => b[1] - a[1]);

  if (entries.length === 0) {
    return <p className="text-sm text-muted-foreground">No data yet.</p>;
  }

  const max = Math.max(...entries.map(([, count]) => count), 1);

  return (
    <ul className="space-y-3">
      {entries.map(([key, count]) => (
        <li key={key} className="space-y-1">
          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="truncate">{labels[key] ?? key}</span>
            <span className="tabular-nums text-muted-foreground">{count.toLocaleString()}</span>
          </div>
          <div className="h-2 w-full rounded bg-muted">
            <div
              className="h-2 rounded bg-primary/70"
              style={{ width: `${Math.max((count / max) * 100, 2)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

function SectionMessage({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-sm text-muted-foreground">{children}</p>;
}

function SectionLoading() {
  return (
    <div className="flex justify-center py-6">
      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
    </div>
  );
}

/** Brain Home dashboard. */
export default function OrganizationPage({ params }: PageProps) {
  const { organizationId } = use(params);
  const router = useRouter();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [question, setQuestion] = useState('');

  const base = `/organizations/${organizationId}`;

  const { data: organization, isLoading } = useQuery({
    queryKey: ['organization', organizationId],
    queryFn: () => organizationsApi.getOrganization(organizationId),
  });

  const { data: roleInfo } = useQuery({
    queryKey: ['organization-role', organizationId],
    queryFn: () => organizationsApi.getUserRoleInOrganization(organizationId),
  });

  const {
    data: brain,
    isLoading: brainLoading,
    isError: brainError,
  } = useQuery({
    queryKey: ['brain', organizationId],
    queryFn: () => brainApi.getBrain(organizationId),
  });

  const {
    data: insights,
    isLoading: insightsLoading,
    isError: insightsError,
  } = useQuery({
    queryKey: ['insights', organizationId, 'OPEN'],
    queryFn: () => brainApi.listInsights(organizationId, { status: 'OPEN' }),
  });

  const {
    data: actions,
    isLoading: actionsLoading,
    isError: actionsError,
  } = useQuery({
    queryKey: ['actions', organizationId],
    queryFn: () => brainApi.listActions(organizationId),
  });

  const canManage = roleInfo?.role === 'OWNER' || roleInfo?.role === 'ADMIN';

  const ask = (q: string) => {
    const trimmed = q.trim();
    if (!trimmed) return;
    router.push(`${base}/ask?q=${encodeURIComponent(trimmed)}`);
  };

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    ask(question);
  };

  if (isLoading) {
    return (
      <PageContainer>
        <div className="flex justify-center py-24">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </PageContainer>
    );
  }

  if (!organization) {
    return (
      <PageContainer>
        <div className="mx-auto max-w-6xl px-4 py-16 text-center text-muted-foreground">
          Organization not found, or you no longer have access to it.
        </div>
      </PageContainer>
    );
  }

  const brainEmpty = !!brain && (brain.status !== 'READY' || brain.stats.items === 0);
  const topInsights = insights ? sortInsights(insights).slice(0, 5) : [];
  const recentActions = actions ? actions.slice(0, 5) : [];
  const statsLoading = brainLoading;
  const stats = brainError ? undefined : brain?.stats;

  return (
    <PageContainer>
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-8">
        <PageHeader title={organization.name} description={organization.description || DEFAULT_DESCRIPTION}>
          <div className="flex gap-2">
            {canManage && (
              <Button variant="outline" onClick={() => setInviteOpen(true)}>
                <UserPlus className="mr-2 h-4 w-4" />
                Invite
              </Button>
            )}
            <Button variant="outline" asChild>
              <Link href={`${base}/settings`}>
                <Settings className="mr-2 h-4 w-4" />
                Settings
              </Link>
            </Button>
          </div>
        </PageHeader>

        {brainEmpty && (
          <Card className="border-primary/40 bg-primary/5">
            <CardContent className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
                  <Database className="h-5 w-5" aria-hidden="true" />
                </div>
                <div className="space-y-1">
                  <h2 className="text-lg font-semibold">Your brain is empty</h2>
                  <p className="text-sm text-muted-foreground">
                    Connect Slack or GitHub, or load the Northwind Robotics demo dataset, to start
                    asking questions with cited, permission-aware answers.
                  </p>
                </div>
              </div>
              <Button asChild className="shrink-0">
                <Link href={`${base}/sources`}>
                  Connect sources / load demo data
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
            </CardContent>
          </Card>
        )}

        <Card className="border-primary/30 bg-gradient-to-br from-primary/10 to-transparent">
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center gap-2 text-xl">
              <Sparkles className="h-5 w-5 text-primary" aria-hidden="true" />
              Ask the brain
            </CardTitle>
            <CardDescription>
              Get cited answers drawn from everything your company knows - respecting who can see what.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <form onSubmit={handleSubmit} className="flex gap-2">
              <Input
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="Ask anything about the company..."
                aria-label="Ask the brain"
                className="h-11 bg-background"
              />
              <Button type="submit" className="h-11 shrink-0" disabled={!question.trim()}>
                <Sparkles className="h-4 w-4" />
                Ask
              </Button>
            </form>
            <div className="flex flex-wrap gap-2">
              {SUGGESTED_QUESTIONS.map((q) => (
                <Button
                  key={q}
                  variant="outline"
                  size="sm"
                  className="rounded-full bg-background/60"
                  onClick={() => ask(q)}
                >
                  {q}
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard icon={Database} label="Knowledge items" value={stats?.items} loading={statsLoading} />
          <StatCard icon={Users} label="People in directory" value={stats?.people} loading={statsLoading} />
          <StatCard
            icon={Lightbulb}
            label="Open insights"
            value={stats?.openInsights}
            loading={statsLoading}
            href={`${base}/insights`}
          />
          <StatCard
            icon={Zap}
            label="Pending actions"
            value={stats?.pendingActions}
            loading={statsLoading}
            href={`${base}/actions`}
          />
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
                <div className="space-y-1">
                  <CardTitle className="text-lg">Open insights</CardTitle>
                  <CardDescription>Contradictions, stale docs, decisions and action items.</CardDescription>
                </div>
                <Button variant="ghost" size="sm" asChild>
                  <Link href={`${base}/insights`}>
                    View all
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>
              </CardHeader>
              <CardContent>
                {insightsLoading ? (
                  <SectionLoading />
                ) : insightsError ? (
                  <SectionMessage>Could not load insights right now.</SectionMessage>
                ) : topInsights.length === 0 ? (
                  <SectionMessage>No open insights. Run an analysis from the Insights page.</SectionMessage>
                ) : (
                  <ul className="divide-y">
                    {topInsights.map((insight) => {
                      const meta = INSIGHT_META[insight.type];
                      const Icon = meta?.icon ?? Lightbulb;
                      return (
                        <li key={insight.id}>
                          <Link
                            href={`${base}/insights`}
                            className="-mx-2 flex items-start gap-3 rounded-md px-2 py-3 transition-colors hover:bg-accent/50"
                          >
                            <Badge variant="outline" className={cn('mt-0.5 shrink-0 gap-1', meta?.className)}>
                              <Icon className="h-3 w-3" aria-hidden="true" />
                              {meta?.label ?? insight.type}
                            </Badge>
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-sm font-medium">{insight.title}</div>
                              {insight.summary && (
                                <p className="line-clamp-2 text-xs text-muted-foreground">{insight.summary}</p>
                              )}
                            </div>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
                <div className="space-y-1">
                  <CardTitle className="text-lg">Recent agent actions</CardTitle>
                  <CardDescription>Issues, messages and doc updates proposed by the brain.</CardDescription>
                </div>
                <Button variant="ghost" size="sm" asChild>
                  <Link href={`${base}/actions`}>
                    View all
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>
              </CardHeader>
              <CardContent>
                {actionsLoading ? (
                  <SectionLoading />
                ) : actionsError ? (
                  <SectionMessage>Could not load actions right now.</SectionMessage>
                ) : recentActions.length === 0 ? (
                  <SectionMessage>No actions yet. Ask the brain to fix an insight.</SectionMessage>
                ) : (
                  <ul className="divide-y">
                    {recentActions.map((action) => {
                      const url = actionUrl(action);
                      return (
                        <li key={action.id} className="flex items-center gap-3 py-3">
                          <Badge variant="outline" className="shrink-0">
                            {ACTION_TYPE_LABELS[action.type] ?? action.type}
                          </Badge>
                          <span className="min-w-0 flex-1 truncate text-sm">{actionTitle(action)}</span>
                          <ActionStatusBadge status={action.status} />
                          {url && (
                            <a
                              href={url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="shrink-0 text-muted-foreground hover:text-foreground"
                              aria-label="Open result"
                            >
                              <ExternalLink className="h-4 w-4" />
                            </a>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="space-y-6">
            <Card>
              <CardHeader className="pb-4">
                <CardTitle className="text-lg">Knowledge by source</CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                {brainLoading ? (
                  <SectionLoading />
                ) : brainError || !brain ? (
                  <SectionMessage>Could not load brain stats.</SectionMessage>
                ) : (
                  <>
                    <BarList data={brain.stats.bySourceSystem} labels={SOURCE_LABELS} />
                    <div className="space-y-3">
                      <h4 className="text-sm font-semibold">Knowledge by type</h4>
                      <BarList data={brain.stats.byKind} labels={KIND_LABELS} />
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-4">
                <CardTitle className="text-lg">Integrations</CardTitle>
              </CardHeader>
              <CardContent>
                {brainLoading ? (
                  <SectionLoading />
                ) : brainError || !brain ? (
                  <SectionMessage>Could not load integrations.</SectionMessage>
                ) : (
                  <div className="space-y-3">
                    <ul className="space-y-2">
                      {INTEGRATION_LABELS.map(({ key, label }) => {
                        const connected = brain.integrations[key];
                        return (
                          <li key={key} className="flex items-center justify-between gap-2 text-sm">
                            <span className="flex items-center gap-2">
                              {connected ? (
                                <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden="true" />
                              ) : (
                                <XCircle className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                              )}
                              {label}
                            </span>
                            <span className={cn('text-xs', connected ? 'text-emerald-700 dark:text-emerald-400' : 'text-muted-foreground')}>
                              {connected ? 'Connected' : 'Not configured'}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                    {brain.hydraDatabase && (
                      <div className="border-t pt-3 text-xs text-muted-foreground">
                        Database: <span className="font-mono text-foreground">{brain.hydraDatabase}</span>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      <InviteOrganizationMembersDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        defaultOrganizationId={organizationId}
      />
    </PageContainer>
  );
}