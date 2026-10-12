import { Insight } from '@prisma/client';
import type { Citation, InsightDto } from '@app-starter/shared';

export function toInsightDto(insight: Insight): InsightDto {
  return {
    id: insight.id,
    type: insight.type,
    title: insight.title,
    summary: insight.summary,
    severity: insight.severity,
    status: insight.status,
    evidence: Array.isArray(insight.evidence) ? (insight.evidence as unknown as Citation[]) : [],
    entities: Array.isArray(insight.entities)
      ? (insight.entities as unknown[]).filter((entry): entry is string => typeof entry === 'string')
      : [],
    ownerEmail: insight.ownerEmail,
    dueAt: insight.dueAt ? insight.dueAt.toISOString() : null,
    occurredAt: insight.occurredAt ? insight.occurredAt.toISOString() : null,
    createdAt: insight.createdAt.toISOString(),
    updatedAt: insight.updatedAt.toISOString(),
  };
}
