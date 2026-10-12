import { Injectable } from '@nestjs/common';
import { KnowledgeItem } from '@prisma/client';
import type { KnowledgeKind, SourceSystem } from '@app-starter/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { IngestionService } from '../../ingestion/ingestion.service';
import { NormalizedRecord } from '../../ingestion/normalized-record';
import { ExecutionContext } from '../constants';

const str = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0) : [];

export type DocUpdateResult = { url: string | null; hydraId: string; title: string; updatedAt: string };

/**
 * Rebuilds the source-agnostic record for a mirrored knowledge-base doc with a
 * corrected body, preserving its ACL, metadata and people, and recording the
 * revision in `additional_metadata`.
 */
export function recordFromRow(
  row: KnowledgeItem,
  body: string,
  audit: { reason: string; approvedBy: string; actionId: string; now?: Date },
): NormalizedRecord {
  const metadata = (row.metadata ?? {}) as Record<string, unknown>;
  const additional = { ...((row.additional ?? {}) as Record<string, unknown>) };
  const people = strings(additional.people);
  delete additional.people;
  delete additional.relations;
  const acl = strings(row.acl);
  return {
    externalId: row.externalId,
    provider: row.provider,
    kind: row.kind as KnowledgeKind,
    sourceSystem: row.sourceSystem as SourceSystem,
    title: row.title,
    body,
    url: row.url,
    authorEmail: row.authorEmail,
    occurredAt: (audit.now ?? new Date()).toISOString(),
    acl: acl.length ? acl : null,
    metadata: {
      channel: str(metadata.channel) ?? null,
      department: str(metadata.department) ?? null,
      project: str(metadata.project) ?? null,
      docType: str(metadata.doc_type) ?? null,
    },
    people,
    extra: {
      ...additional,
      revised_by: 'klennybrain-agent',
      revision_reason: audit.reason.slice(0, 500),
      revision_approved_by: audit.approvedBy,
      revision_action_id: audit.actionId,
      previous_updated_at: row.occurredAt ? row.occurredAt.toISOString() : null,
    },
  };
}

/** Writes an approved doc correction back into HydraDB (upsert) and the Postgres mirror. */
@Injectable()
export class HydraDocExecutor {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ingestion: IngestionService,
  ) {}

  async updateDoc(
    organizationId: string,
    payload: Record<string, unknown>,
    context: ExecutionContext,
  ): Promise<DocUpdateResult> {
    const hydraId = str(payload.hydraId);
    const correctedBody = str(payload.correctedBody);
    if (!hydraId || !correctedBody) throw new Error('hydraId and correctedBody are required');
    const row = await this.prisma.knowledgeItem.findUnique({
      where: { organizationId_hydraId: { organizationId, hydraId } },
    });
    if (!row || row.kind !== 'knowledge_base') throw new Error('Only knowledge-base docs can be updated');

    const record = recordFromRow(row, correctedBody, {
      reason: str(payload.reason) ?? 'Corrected by KlennyBrain',
      approvedBy: context.approvedBy,
      actionId: context.actionId,
    });
    await this.ingestion.upsertRecord(organizationId, row.sourceId, record);
    return { url: row.url, hydraId, title: row.title, updatedAt: record.occurredAt };
  }
}
