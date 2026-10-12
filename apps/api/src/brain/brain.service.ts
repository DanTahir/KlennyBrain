import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { BrainSpaceDto, PersonaDto, SourceDto, SyncJobDto } from '@app-starter/shared';
import { PrismaService } from '../prisma/prisma.service';
import { ADMIN_ROLES, AclService } from '../acl/acl.service';
import { HydraService } from '../hydra/hydra.service';
import { LlmService } from '../llm/llm.service';
import { IngestionService } from '../ingestion/ingestion.service';
import { CreateSourceDto } from './dto/create-source.dto';
import { toSourceDto, toSyncJobDto } from './brain.mappers';

const DEFAULT_SOURCE_NAMES = { DEMO: 'Northwind demo dataset', SLACK: 'Slack workspace' } as const;

@Injectable()
export class BrainService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly acl: AclService,
    private readonly ingestion: IngestionService,
    private readonly hydra: HydraService,
    private readonly llm: LlmService,
    private readonly config: ConfigService,
  ) {}

  async getBrain(userId: string, organizationId: string): Promise<BrainSpaceDto> {
    const identity = await this.acl.resolveIdentity(userId, organizationId);
    const space = await this.ingestion.getBrainSpace(organizationId);
    const where = { organizationId };
    const [items, byKind, bySystem, people, openInsights, pendingActions] = await Promise.all([
      this.prisma.knowledgeItem.count({ where }),
      this.prisma.knowledgeItem.groupBy({ by: ['kind'], where, _count: { _all: true } }),
      this.prisma.knowledgeItem.groupBy({ by: ['sourceSystem'], where, _count: { _all: true } }),
      this.prisma.directoryPerson.count({ where }),
      this.prisma.insight.count({ where: { organizationId, status: 'OPEN' } }),
      this.prisma.agentAction.count({ where: { organizationId, status: 'PROPOSED' } }),
    ]);

    return {
      organizationId,
      status: space?.status ?? 'NOT_PROVISIONED',
      hydraDatabase: space?.hydraDatabase ?? null,
      collection: space?.collection ?? 'default',
      error: space?.error ?? null,
      integrations: {
        hydra: this.hydra.isConfigured(),
        llm: this.llm.isConfigured(),
        slack: Boolean(this.config.get<string>('SLACK_BOT_TOKEN') && this.config.get<string>('SLACK_APP_TOKEN')),
        github: Boolean(this.config.get<string>('GITHUB_TOKEN')),
      },
      stats: {
        items,
        byKind: Object.fromEntries(byKind.map((row) => [row.kind, row._count._all])),
        bySourceSystem: Object.fromEntries(bySystem.map((row) => [row.sourceSystem, row._count._all])),
        people,
        openInsights,
        pendingActions,
      },
      viewer: {
        email: identity.email,
        role: identity.role,
        canViewAs: AclService.canViewAs(identity.role),
        person: identity.person,
      },
    };
  }

  async provision(userId: string, organizationId: string): Promise<BrainSpaceDto> {
    await this.acl.requireRole(userId, organizationId, ADMIN_ROLES);
    await this.ingestion.provisionInBackground(organizationId);
    return this.getBrain(userId, organizationId);
  }

  /** One-click demo: create the DEMO source if needed and start syncing it. */
  async loadDemo(userId: string, organizationId: string): Promise<{ source: SourceDto; job: SyncJobDto }> {
    await this.acl.requireRole(userId, organizationId, ADMIN_ROLES);
    const source = await this.upsertSource(organizationId, 'DEMO', DEFAULT_SOURCE_NAMES.DEMO);
    const job = await this.ingestion.startSync(organizationId, source.id);
    return { source: await this.getSource(organizationId, source.id), job: toSyncJobDto(job) };
  }

  async listSources(userId: string, organizationId: string): Promise<SourceDto[]> {
    await this.acl.requireRole(userId, organizationId);
    const sources = await this.prisma.source.findMany({
      where: { organizationId, deletedAt: null },
      include: { syncJobs: { orderBy: { createdAt: 'desc' }, take: 1 } },
      orderBy: { createdAt: 'asc' },
    });
    return sources.map(toSourceDto);
  }

  async createSource(userId: string, organizationId: string, dto: CreateSourceDto): Promise<SourceDto> {
    await this.acl.requireRole(userId, organizationId, ADMIN_ROLES);
    const source = await this.upsertSource(organizationId, dto.type, dto.name?.trim() || DEFAULT_SOURCE_NAMES[dto.type]);
    return this.getSource(organizationId, source.id);
  }

  async syncSource(userId: string, organizationId: string, sourceId: string): Promise<SyncJobDto> {
    await this.acl.requireRole(userId, organizationId, ADMIN_ROLES);
    return toSyncJobDto(await this.ingestion.startSync(organizationId, sourceId));
  }

  async listJobs(userId: string, organizationId: string, sourceId: string): Promise<SyncJobDto[]> {
    await this.acl.requireRole(userId, organizationId);
    const jobs = await this.prisma.syncJob.findMany({
      where: { organizationId, sourceId },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });
    return jobs.map(toSyncJobDto);
  }

  async listPersonas(userId: string, organizationId: string): Promise<PersonaDto[]> {
    await this.acl.requireRole(userId, organizationId, ADMIN_ROLES);
    return this.acl.listPersonas(organizationId);
  }

  private upsertSource(organizationId: string, type: 'DEMO' | 'SLACK', name: string) {
    return this.prisma.source.upsert({
      where: { organizationId_type_name: { organizationId, type, name } },
      update: { deletedAt: null },
      create: { organizationId, type, name },
    });
  }

  private async getSource(organizationId: string, sourceId: string): Promise<SourceDto> {
    const source = await this.prisma.source.findFirstOrThrow({
      where: { id: sourceId, organizationId },
      include: { syncJobs: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    return toSourceDto(source);
  }
}
