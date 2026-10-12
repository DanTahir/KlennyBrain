import { KnowledgeItem } from '@prisma/client';
import { recordFromRow } from './hydra-doc.executor';

const ROW = {
  id: 'row-1',
  organizationId: 'org-1',
  sourceId: 'source-1',
  hydraId: 'docs-doc-refund-policy',
  kind: 'knowledge_base',
  sourceSystem: 'doc',
  provider: 'docs',
  externalId: 'doc-refund-policy',
  title: 'Refund Policy',
  body: 'Refunds within 14 days.',
  url: 'https://docs.northwind.dev/refund-policy',
  authorEmail: 'priya@northwind.dev',
  occurredAt: new Date('2026-04-20T00:00:00.000Z'),
  acl: ['group:dept:support'],
  metadata: { source_system: 'doc', department: 'support', doc_type: 'policy' },
  additional: { people: ['priya@northwind.dev'], relations: [], owner: 'priya@northwind.dev' },
  indexingStatus: 'completed',
  createdAt: new Date(),
  updatedAt: new Date(),
} as unknown as KnowledgeItem;

describe('recordFromRow', () => {
  it('keeps identity, ACL and metadata while replacing the body', () => {
    // Arrange
    const inputNow = new Date('2026-10-12T20:00:00.000Z');

    // Act
    const actual = recordFromRow(ROW, 'Refunds within 30 days.', {
      reason: 'Aligned with the 2026-08-18 decision',
      approvedBy: 'Elena Park',
      actionId: 'action-1',
      now: inputNow,
    });

    // Assert
    expect(actual).toMatchObject({
      externalId: 'doc-refund-policy',
      provider: 'docs',
      kind: 'knowledge_base',
      body: 'Refunds within 30 days.',
      occurredAt: '2026-10-12T20:00:00.000Z',
      acl: ['group:dept:support'],
      metadata: { department: 'support', docType: 'policy', channel: null, project: null },
      people: ['priya@northwind.dev'],
    });
  });

  it('records the revision and drops mirror-only fields from extra metadata', () => {
    // Act
    const actual = recordFromRow(ROW, 'Refunds within 30 days.', {
      reason: 'Aligned with the 2026-08-18 decision',
      approvedBy: 'Elena Park',
      actionId: 'action-1',
    });

    // Assert
    expect(actual.extra).toEqual({
      owner: 'priya@northwind.dev',
      revised_by: 'klennybrain-agent',
      revision_reason: 'Aligned with the 2026-08-18 decision',
      revision_approved_by: 'Elena Park',
      revision_action_id: 'action-1',
      previous_updated_at: '2026-04-20T00:00:00.000Z',
    });
  });

  it('treats an empty ACL as org-public', () => {
    // Arrange
    const inputRow = { ...ROW, acl: [] } as unknown as KnowledgeItem;

    // Act
    const actual = recordFromRow(inputRow, 'Body', { reason: 'r', approvedBy: 'a', actionId: 'x' });

    // Assert
    expect(actual.acl).toBeNull();
  });
});
