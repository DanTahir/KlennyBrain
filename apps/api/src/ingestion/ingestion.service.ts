import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { BrainSpace, Prisma, SourceType, SyncJob } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { HydraService, SEARCHABLE_STATUSES } from '../hydra/hydra.service';
import { HydraAppKnowledgeItem } from '../hydra/hydra.types';
import { DemoAdapter } from './adapters/demo.adapter';
import { JobRunnerService } from './job-runner.service';
import { hydraIdFor, toAppKnowledgeItem } from './mappers/app-knowledge.mapper';
import { NormalizedRecord } from './normalized-record';
import { SourceAdapter } from './source-adapter.interface';

const BATCH_SIZE = 20;
const BATCH_DELAY_MS = 1000;
const INDEX_POLL_MS = 15_000;
const INDEX_TRACK_MS = 8 * 60_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function isRetryable(error: unknown): boolean {
  const code = (error as { statusCode?: number })?.statusCode;
  return code === undefined || code === 429 || code >= 500;
}

@Injectable()
export class IngestionService {
  private readonly logger = new Logger(IngestionService.name);
  private readonly adapters: Partial<Record<SourceType, SourceAdapter>>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly hydra: HydraService,
    private readonly jobs: JobRunnerService,
    demoAdapter: DemoAdapter,
  ) {
    this.adapters = { DEMO: demoAdapter };
  }

  /** Creates the BrainSpace row (if needed) and the HydraDB database, waiting until it is ready. */
  async ensureBrainSpace(organizationId: string): Promise<BrainSpace> {
    const space = await this.upsertBrainSpace(organizationId);
    if (space.status === 'READY') return space;
    await this.prisma.brainSpace.update({ where: { id: space.id }, data: { status: 'PROVISIONING', error: null } });
    try {
      await this.hydra.ensureDatabase(space.hydraDatabase);
      return await this.prisma.brainSpace.update({ where: { id: space.id }, data: { status: 'READY', error: null } });
    } catch (error) {
      await this.prisma.brainSpace.update({
        where: { id: space.id },
        data: { status: 'ERROR', error: (error as Error).message.slice(0, 500) },
      });
      throw error;
    }
  }

  async provisionInBackground(organizationId: string): Promise<BrainSpace> {
    const space = await this.upsertBrainSpace(organizationId);
    if (space.status !== 'READY') {
      this.jobs.enqueue(`provision:${organizationId}`, async () => {
        await this.ensureBrainSpace(organizationId);
      });
    }
    return space;
  }

  async getBrainSpace(organizationId: string): Promise<BrainSpace | null> {
    return this.prisma.brainSpace.findUnique({ where: { organizationId } });
  }

  /** Queues a sync for one source; returns the existing job if one is already queued or running. */
  async startSync(organizationId: string, sourceId: string): Promise<SyncJob> {
    const source = await this.prisma.source.findFirst({ where: { id: sourceId, organizationId, deletedAt: null } });
    if (!source) throw new NotFoundException('Source not found');
    if (!this.adapters[source.type]) throw new NotFoundException(`Syncing ${source.type} sources is not supported yet`);

    const active = await this.prisma.syncJob.findFirst({
      where: { sourceId, status: { in: ['QUEUED', 'RUNNING'] } },
      orderBy: { createdAt: 'desc' },
    });
    if (active) return active;

    const job = await this.prisma.syncJob.create({ data: { organizationId, sourceId, status: 'QUEUED' } });
    await this.prisma.source.update({ where: { id: sourceId }, data: { status: 'SYNCING', error: null } });
    this.jobs.enqueue(`sync:${sourceId}`, () => this.runSync(job.id));
    return job;
  }

  /** Upserts one knowledge doc into HydraDB and its Postgres mirror (used by the doc-fix action). */
  async upsertRecord(organizationId: string, sourceId: string, record: NormalizedRecord): Promise<string> {
    const space = await this.ensureBrainSpace(organizationId);
    const item = toAppKnowledgeItem(record);
    const result = await this.withRetry(() => this.hydra.ingest(space.hydraDatabase, space.collection, [item]));
    if (result.failed.length) throw new Error(`HydraDB rejected ${item.id}: ${result.failed[0].error}`);
    await this.mirror(organizationId, sourceId, [{ record, item }], 'queued');
    return item.id;
  }

  private async runSync(jobId: string): Promise<void> {
    const job = await this.prisma.syncJob.findUniqueOrThrow({ where: { id: jobId }, include: { source: true } });
    const { source, organizationId } = job;
    try {
      const space = await this.ensureBrainSpace(organizationId);
      const adapter = this.adapters[source.type];
      if (!adapter) throw new Error(`No adapter for ${source.type}`);

      const records = await adapter.fetch({
        organizationId,
        config: (source.config ?? {}) as Record<string, unknown>,
      });
      await this.prisma.syncJob.update({
        where: { id: jobId },
        data: { status: 'RUNNING', startedAt: new Date(), total: records.length },
      });

      const pairs = records.map((record) => ({ record, item: toAppKnowledgeItem(record) }));
      await this.mirror(organizationId, source.id, pairs, 'queued');
      // (relations are mirrored too so graph exploration works before HydraDB finishes its graph)

      let processed = 0;
      let failed = 0;
      const accepted: string[] = [];
      for (let offset = 0; offset < pairs.length; offset += BATCH_SIZE) {
        const batch = pairs.slice(offset, offset + BATCH_SIZE).map((pair) => pair.item);
        try {
          const result = await this.withRetry(() => this.hydra.ingest(space.hydraDatabase, space.collection, batch));
          accepted.push(...result.accepted);
          failed += result.failed.length;
          for (const failure of result.failed) this.logger.warn(`HydraDB rejected ${failure.id}: ${failure.error}`);
        } catch (error) {
          failed += batch.length;
          this.logger.error(`Batch at offset ${offset} failed: ${(error as Error).message}`);
        }
        processed += batch.length;
        await this.prisma.syncJob.update({ where: { id: jobId }, data: { processed, failed } });
        if (offset + BATCH_SIZE < pairs.length) await sleep(BATCH_DELAY_MS);
      }

      const allFailed = pairs.length > 0 && failed >= pairs.length;
      const error = failed ? `${failed} of ${pairs.length} items failed to ingest` : null;
      await this.prisma.syncJob.update({
        where: { id: jobId },
        data: { status: allFailed ? 'FAILED' : 'SUCCEEDED', finishedAt: new Date(), error },
      });
      await this.prisma.source.update({
        where: { id: source.id },
        data: {
          status: allFailed ? 'ERROR' : 'READY',
          itemCount: await this.prisma.knowledgeItem.count({ where: { sourceId: source.id } }),
          lastSyncedAt: new Date(),
          error,
        },
      });
      if (accepted.length) void this.trackIndexing(jobId, organizationId, space, accepted);
    } catch (error) {
      const message = (error as Error).message.slice(0, 500);
      await this.prisma.syncJob.update({
        where: { id: jobId },
        data: { status: 'FAILED', finishedAt: new Date(), error: message },
      });
      await this.prisma.source.update({ where: { id: source.id }, data: { status: 'ERROR', error: message } });
      throw error;
    }
  }

  /** Re-reads a source and refreshes only the Postgres mirror (no HydraDB re-ingest). */
  async refreshMirror(organizationId: string, sourceId: string): Promise<number> {
    const source = await this.prisma.source.findFirstOrThrow({ where: { id: sourceId, organizationId } });
    const adapter = this.adapters[source.type];
    if (!adapter) throw new Error(`No adapter for ${source.type}`);
    const records = await adapter.fetch({
      organizationId,
      config: (source.config ?? {}) as Record<string, unknown>,
    });
    await this.mirror(
      organizationId,
      source.id,
      records.map((record) => ({ record, item: toAppKnowledgeItem(record) })),
    );
    return records.length;
  }

  /** Polls HydraDB until items are searchable/completed, recording progress on the job. */
  private async trackIndexing(jobId: string, organizationId: string, space: BrainSpace, ids: string[]) {
    const deadline = Date.now() + INDEX_TRACK_MS;
    while (Date.now() < deadline) {
      await sleep(INDEX_POLL_MS);
      try {
        const statuses = await this.hydra.indexingStatuses(space.hydraDatabase, space.collection, ids);
        const values = [...statuses.values()];
        const indexed = values.filter((status) => SEARCHABLE_STATUSES.has(status)).length;
        await this.prisma.syncJob.update({ where: { id: jobId }, data: { indexed } });

        const byStatus = new Map<string, string[]>();
        for (const [id, status] of statuses) byStatus.set(status, [...(byStatus.get(status) ?? []), id]);
        for (const [status, hydraIds] of byStatus) {
          await this.prisma.knowledgeItem.updateMany({
            where: { organizationId, hydraId: { in: hydraIds } },
            data: { indexingStatus: status },
          });
        }
        if (values.length && values.every((status) => status === 'completed' || status === 'errored')) return;
      } catch (error) {
        this.logger.warn(`Indexing status poll failed: ${(error as Error).message}`);
      }
    }
  }

  private async mirror(
    organizationId: string,
    sourceId: string,
    pairs: { record: NormalizedRecord; item: HydraAppKnowledgeItem }[],
    indexingStatus?: string,
  ): Promise<void> {
    for (let offset = 0; offset < pairs.length; offset += 50) {
      const slice = pairs.slice(offset, offset + 50);
      await this.prisma.$transaction(
        slice.map(({ record, item }) => {
          const data = {
            sourceId,
            kind: record.kind,
            sourceSystem: record.sourceSystem,
            provider: record.provider,
            externalId: record.externalId,
            title: item.title,
            body: record.body,
            url: record.url ?? null,
            authorEmail: record.authorEmail?.toLowerCase() ?? null,
            occurredAt: new Date(record.occurredAt),
            acl: item.acl ?? Prisma.DbNull,
            metadata: item.metadata as Prisma.InputJsonValue,
            additional: {
              ...(item.additional_metadata ?? {}),
              relations: (item.relations ?? []).map((relation) => ({
                predicate: relation.predicate,
                target: hydraIdFor(relation.target.provider, relation.target.external_id),
              })),
            } as Prisma.InputJsonValue,
            ...(indexingStatus ? { indexingStatus } : {}),
          };
          return this.prisma.knowledgeItem.upsert({
            where: { organizationId_hydraId: { organizationId, hydraId: item.id } },
            update: data,
            create: { ...data, organizationId, hydraId: item.id },
          });
        }),
      );
    }
  }

  private async withRetry<T>(task: () => Promise<T>, attempts = 3): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        return await task();
      } catch (error) {
        lastError = error;
        if (!isRetryable(error) || attempt === attempts - 1) break;
        await sleep(2000 * 2 ** attempt);
      }
    }
    throw lastError;
  }

  private async upsertBrainSpace(organizationId: string): Promise<BrainSpace> {
    const organization = await this.prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
    return this.prisma.brainSpace.upsert({
      where: { organizationId },
      update: {},
      create: { organizationId, hydraDatabase: HydraService.databaseNameFor(organization.slug) },
    });
  }
}
