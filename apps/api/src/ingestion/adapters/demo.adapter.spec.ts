import * as path from 'path';
import { toAppKnowledgeItem } from '../mappers/app-knowledge.mapper';
import { DemoAdapter, parseFrontMatter } from './demo.adapter';

describe('DemoAdapter', () => {
  const inputDir = path.resolve(__dirname, '..', '..', '..', '..', '..', 'data', 'demo');
  const adapter = new DemoAdapter({ get: () => undefined } as never);
  const records = adapter.readAll(inputDir);

  it('normalizes every record in the committed dataset with unique HydraDB ids', () => {
    // Arrange
    const bySystem = (system: string) => records.filter((record) => record.sourceSystem === system).length;

    // Act
    const actualIds = new Set(records.map((record) => toAppKnowledgeItem(record).id));

    // Assert
    expect(bySystem('slack')).toBe(236);
    expect(bySystem('email')).toBe(36);
    expect(bySystem('doc')).toBe(21);
    expect(bySystem('meeting')).toBe(9);
    expect(bySystem('ticket')).toBe(24);
    expect(bySystem('issue')).toBe(22);
    expect(actualIds.size).toBe(records.length);
  });

  it('restricts every #leadership message to the leadership group', () => {
    // Arrange
    const inputLeadership = records.filter((record) => record.metadata.channel === 'leadership');

    // Act
    const actualAcls = new Set(inputLeadership.map((record) => JSON.stringify(record.acl)));

    // Assert
    expect(inputLeadership.length).toBeGreaterThan(0);
    expect([...actualAcls]).toEqual([JSON.stringify(['group:slack:leadership'])]);
  });

  it('carries the restricted HR docs ACL and the stale refund doc date', () => {
    // Arrange
    const byId = (externalId: string) => records.find((record) => record.externalId === externalId);

    // Act
    const actualComp = byId('doc-hr-q4-comp-bands');
    const actualRefund = byId('doc-refund-policy');

    // Assert
    expect(actualComp?.acl).toEqual(expect.arrayContaining(['group:dept:exec']));
    expect(actualRefund?.acl ?? null).toBeNull();
    expect(actualRefund?.body).toContain('Last updated: 2026-04-20');
  });

  it('links issues with blocks relations', () => {
    // Arrange
    const inputIssue = records.find((record) => record.externalId === 'ATL-212');

    // Act
    const actualRelations = inputIssue?.relations ?? [];

    // Assert
    expect(actualRelations).toEqual(expect.arrayContaining([{ predicate: 'blocks', targetExternalId: 'ATL-200' }]));
  });

  it('parses YAML flow lists and nulls in front-matter', () => {
    // Arrange
    const inputRaw = '---\nid: doc-x\nproject: null\nacl: [group:dept:exec, group:dept:people]\n---\n\n# Body';

    // Act
    const actualParsed = parseFrontMatter(inputRaw);

    // Assert
    expect(actualParsed.attrs).toEqual({ id: 'doc-x', project: null, acl: ['group:dept:exec', 'group:dept:people'] });
    expect(actualParsed.body).toBe('# Body');
  });
});
