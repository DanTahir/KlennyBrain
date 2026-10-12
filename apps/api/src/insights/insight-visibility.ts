import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** An item with no ACL is org-public; otherwise the viewer needs one matching entry. */
export function aclAllows(itemAcl: unknown, viewerAcl: string[]): boolean {
  if (!Array.isArray(itemAcl) || itemAcl.length === 0) return true;
  return itemAcl.some((entry) => typeof entry === 'string' && viewerAcl.includes(entry));
}

/** hydraIds of the citations stored in an insight's `evidence` JSON, in order. */
export function evidenceHydraIds(evidence: unknown): string[] {
  if (!Array.isArray(evidence)) return [];
  return evidence
    .map((entry) => (entry && typeof entry === 'object' ? (entry as { hydraId?: unknown }).hydraId : undefined))
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
}

/**
 * Insights are derived from sources, so they inherit those sources' ACLs: an
 * insight is shown only when the viewer can see every piece of its evidence.
 */
export async function filterVisibleInsights<T extends { evidence: Prisma.JsonValue | null }>(
  prisma: PrismaService,
  organizationId: string,
  viewerAcl: string[],
  insights: T[],
): Promise<T[]> {
  const ids = [...new Set(insights.flatMap((insight) => evidenceHydraIds(insight.evidence)))];
  if (!ids.length) return insights;
  const rows = await prisma.knowledgeItem.findMany({
    where: { organizationId, hydraId: { in: ids } },
    select: { hydraId: true, acl: true },
  });
  const aclById = new Map(rows.map((row) => [row.hydraId, row.acl]));
  return insights.filter((insight) =>
    evidenceHydraIds(insight.evidence).every((id) => aclById.has(id) && aclAllows(aclById.get(id), viewerAcl)),
  );
}
