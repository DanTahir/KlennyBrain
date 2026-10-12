import { NormalizedRecord } from '../normalized-record';
import { hydraIdFor, normalizeAcl, toAppKnowledgeItem } from './app-knowledge.mapper';

describe('app-knowledge mapper', () => {
  const baseRecord: NormalizedRecord = {
    externalId: 'leadership-20261007-01',
    provider: 'slack',
    kind: 'message',
    sourceSystem: 'slack',
    title: '#leadership: Q4 reorg',
    body: 'Support and CS merge under Ana on Nov 1.',
    url: 'https://northwind.slack.com/archives/C07LEAD/p1',
    authorEmail: 'Elena@Northwind.dev',
    occurredAt: '2026-10-07T18:00:00Z',
    acl: ['group:slack:leadership'],
    metadata: { channel: 'leadership', department: 'exec' },
    threadId: 'leadership-20261007-01',
    people: ['ana@northwind.dev', 'not-an-email'],
  };

  describe('hydraIdFor', () => {
    it('builds a lowercase url-safe id', () => {
      // Arrange
      const inputProvider = 'linear';
      const inputExternalId = 'ATL-212';

      // Act
      const actualId = hydraIdFor(inputProvider, inputExternalId);

      // Assert
      expect(actualId).toBe('linear-atl-212');
    });

    it('collapses unsafe characters', () => {
      // Arrange
      const inputExternalId = 'email/globex sso#1';

      // Act
      const actualId = hydraIdFor('email', inputExternalId);

      // Assert
      expect(actualId).toBe('email-email-globex-sso-1');
    });
  });

  describe('toAppKnowledgeItem', () => {
    it('maps a private Slack message with ACL, thread and declared metadata only', () => {
      // Arrange
      const inputRecord = baseRecord;

      // Act
      const actualItem = toAppKnowledgeItem(inputRecord);

      // Assert
      expect(actualItem.id).toBe('slack-leadership-20261007-01');
      expect(actualItem.kind).toBe('message');
      expect(actualItem.acl).toEqual(['group:slack:leadership']);
      expect(actualItem.fields).toMatchObject({
        kind: 'message',
        author: 'elena@northwind.dev',
        thread_id: 'leadership-20261007-01',
      });
      expect(actualItem.metadata).toEqual({
        source_system: 'slack',
        channel: 'leadership',
        department: 'exec',
        author: 'elena@northwind.dev',
      });
      expect(actualItem.additional_metadata?.people).toEqual(['elena@northwind.dev', 'ana@northwind.dev']);
    });

    it('omits acl for org-public items', () => {
      // Arrange
      const inputRecord: NormalizedRecord = { ...baseRecord, acl: null };

      // Act
      const actualItem = toAppKnowledgeItem(inputRecord);

      // Assert
      expect(actualItem).not.toHaveProperty('acl');
    });

    it('maps issue relations to provider-scoped targets', () => {
      // Arrange
      const inputRecord: NormalizedRecord = {
        ...baseRecord,
        externalId: 'ATL-212',
        provider: 'linear',
        kind: 'ticket',
        sourceSystem: 'issue',
        acl: null,
        metadata: { project: 'sso', department: 'engineering' },
        threadId: null,
        relations: [
          { predicate: 'blocks', targetExternalId: 'ATL-200' },
          { predicate: 'related_to', targetExternalId: 'ZD-1042', targetProvider: 'zendesk' },
        ],
      };

      // Act
      const actualItem = toAppKnowledgeItem(inputRecord);

      // Assert
      expect(actualItem.relations).toEqual([
        { predicate: 'blocks', target: { external_id: 'ATL-200', provider: 'linear' } },
        { predicate: 'related_to', target: { external_id: 'ZD-1042', provider: 'zendesk' } },
      ]);
      expect(actualItem.fields).not.toHaveProperty('thread_id');
    });

    it('truncates metadata values to the schema max length', () => {
      // Arrange
      const inputRecord: NormalizedRecord = {
        ...baseRecord,
        metadata: { ...baseRecord.metadata, project: 'x'.repeat(300) },
      };

      // Act
      const actualItem = toAppKnowledgeItem(inputRecord);

      // Assert
      expect(actualItem.metadata.project).toHaveLength(128);
    });
  });

  describe('normalizeAcl', () => {
    it('returns null for empty or blank lists', () => {
      // Arrange
      const inputAcl = ['  ', ''];

      // Act
      const actualAcl = normalizeAcl(inputAcl);

      // Assert
      expect(actualAcl).toBeNull();
    });
  });
});
