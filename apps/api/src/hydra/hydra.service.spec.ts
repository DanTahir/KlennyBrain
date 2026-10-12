import { HydraService } from './hydra.service';
import { MissingAclError } from './hydra.types';

describe('HydraService', () => {
  function buildService(queryResponse?: unknown) {
    const config = { get: jest.fn().mockReturnValue('test-key') };
    const service = new HydraService(config as never);
    const query = jest.fn().mockResolvedValue(queryResponse ?? { data: { chunks: [], sources: [] } });
    (service as unknown as { client: unknown }).client = { query };
    return { service, query };
  }

  describe('databaseNameFor', () => {
    it('builds an underscore database name from the org slug', () => {
      // Arrange
      const inputSlug = 'Northwind-Robotics';

      // Act
      const actualName = HydraService.databaseNameFor(inputSlug);

      // Assert
      expect(actualName).toBe('brain_northwind_robotics');
    });
  });

  describe('search', () => {
    it('refuses to search without an ACL', async () => {
      // Arrange
      const { service, query } = buildService();
      const inputOptions = { database: 'brain_x', collection: 'default', query: 'refund window', acl: [] };

      // Act
      const actualPromise = service.search(inputOptions);

      // Assert
      await expect(actualPromise).rejects.toBeInstanceOf(MissingAclError);
      expect(query).not.toHaveBeenCalled();
    });

    it('refuses blank ACL entries', async () => {
      // Arrange
      const { service, query } = buildService();
      const inputOptions = { database: 'brain_x', collection: 'default', query: 'q', acl: ['  ', ''] };

      // Act
      const actualPromise = service.search(inputOptions);

      // Assert
      await expect(actualPromise).rejects.toBeInstanceOf(MissingAclError);
      expect(query).not.toHaveBeenCalled();
    });

    it('sends the ACL and parses hits, graph paths and the request id', async () => {
      // Arrange
      const inputResponse = {
        success: true,
        meta: { requestId: 'req-123' },
        data: {
          chunks: [
            { id: 'docs-doc-refund-policy', sourceTitle: 'Refund Policy', chunkContent: '14 days', relevancyScore: 0.7 },
            { id: 'docs-doc-refund-policy', sourceTitle: 'Refund Policy', chunkContent: 'Owner: Priya', relevancyScore: 0.9 },
            { id: 'slack-support-1', sourceTitle: '#support', chunkContent: '30 days', relevancyScore: 0.8 },
          ],
          sources: [{ id: 'docs-doc-refund-policy', title: 'Refund Policy', appKind: 'knowledge_base', url: 'https://wiki' }],
          graphContext: {
            queryPaths: [
              {
                triplets: [
                  {
                    source: { name: 'Refund policy', type: 'CONCEPT' },
                    relation: { canonical_predicate: 'has_window' },
                    target: { name: '14 days' },
                  },
                ],
              },
            ],
          },
        },
      };
      const { service, query } = buildService(inputResponse);

      // Act
      const actualResult = await service.search({
        database: 'brain_x',
        collection: 'default',
        query: 'refund window',
        acl: ['marco@northwind.dev', 'group:dept:support'],
        mode: 'fast',
      });

      // Assert
      expect(query).toHaveBeenCalledWith(
        expect.objectContaining({ acl: ['marco@northwind.dev', 'group:dept:support'], queryApps: true, mode: 'fast' }),
        expect.anything(),
      );
      expect(actualResult.requestId).toBe('req-123');
      expect(actualResult.hits.map((hit) => hit.hydraId)).toEqual(['docs-doc-refund-policy', 'slack-support-1']);
      expect(actualResult.hits[0].score).toBe(0.9);
      expect(actualResult.hits[0].kind).toBe('knowledge_base');
      expect(actualResult.hits[0].text).toContain('Owner: Priya');
      expect(actualResult.paths).toEqual([
        { source: 'Refund policy', predicate: 'has_window', target: '14 days', sourceType: 'CONCEPT' },
      ]);
    });
  });
});
