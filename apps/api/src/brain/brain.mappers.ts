import { Source, SyncJob } from '@prisma/client';
import type { SourceDto, SyncJobDto } from '@app-starter/shared';

const iso = (value: Date | null | undefined) => (value ? value.toISOString() : null);

export function toSyncJobDto(job: SyncJob): SyncJobDto {
  return {
    id: job.id,
    sourceId: job.sourceId,
    status: job.status,
    total: job.total,
    processed: job.processed,
    failed: job.failed,
    indexed: job.indexed,
    startedAt: iso(job.startedAt),
    finishedAt: iso(job.finishedAt),
    error: job.error,
    createdAt: job.createdAt.toISOString(),
  };
}

export function toSourceDto(source: Source & { syncJobs?: SyncJob[] }): SourceDto {
  const latest = source.syncJobs?.[0] ?? null;
  return {
    id: source.id,
    type: source.type,
    name: source.name,
    status: source.status,
    itemCount: source.itemCount,
    lastSyncedAt: iso(source.lastSyncedAt),
    error: source.error,
    latestJob: latest ? toSyncJobDto(latest) : null,
  };
}
