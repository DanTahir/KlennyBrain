'use client';

import { Loader2 } from 'lucide-react';
import type { SyncJobDto, SyncJobStatus } from '@app-starter/shared';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';

const STATUS_META: Record<
  SyncJobStatus,
  { label: string; variant: BadgeProps['variant']; className?: string }
> = {
  QUEUED: { label: 'Queued', variant: 'secondary' },
  RUNNING: { label: 'Running', variant: 'default' },
  SUCCEEDED: {
    label: 'Succeeded',
    variant: 'outline',
    className: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  },
  FAILED: { label: 'Failed', variant: 'destructive' },
};

function percent(value: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.max(0, (value / total) * 100));
}

export function SyncProgress({ job }: { job: SyncJobDto | null }) {
  if (!job) {
    return <p className="text-sm text-muted-foreground">Never synced</p>;
  }

  const meta = STATUS_META[job.status];
  const busy = job.status === 'QUEUED' || job.status === 'RUNNING';
  const indexTarget = Math.max(job.total - job.failed, 0);
  const showIndexHint = job.status === 'SUCCEEDED' && job.indexed < indexTarget;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={meta.variant} className={meta.className}>
          {busy && <Loader2 className="mr-1 h-3 w-3 animate-spin" aria-hidden="true" />}
          {meta.label}
        </Badge>
        {job.failed > 0 && (
          <span className="text-xs font-medium text-red-600 dark:text-red-400">
            {job.failed} failed
          </span>
        )}
      </div>

      <div className="space-y-1">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Uploaded to HydraDB</span>
          <span className="tabular-nums">
            {job.processed} / {job.total}
          </span>
        </div>
        <Progress value={percent(job.processed, job.total)} aria-label="Uploaded to HydraDB" />
      </div>

      <div className="space-y-1">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Searchable (indexed)</span>
          <span className="tabular-nums">
            {job.indexed} / {indexTarget}
          </span>
        </div>
        <Progress
          value={percent(job.indexed, Math.max(job.total - job.failed, 1))}
          aria-label="Searchable (indexed)"
        />
      </div>

      {job.error && <p className="text-xs text-red-600 dark:text-red-400">{job.error}</p>}

      {showIndexHint && (
        <p className="text-xs text-muted-foreground">
          HydraDB builds its knowledge graph in the background; items become searchable within a
          minute or two.
        </p>
      )}
    </div>
  );
}