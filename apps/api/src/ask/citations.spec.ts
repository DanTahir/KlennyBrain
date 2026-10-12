import { CitationRegistry, extractCitedNumbers, normalizeCitationMarkers, selectCitations } from './citations';

const input = (hydraId: string, score: number | null = 0.5) => ({
  hydraId,
  title: hydraId,
  kind: 'message',
  sourceSystem: 'slack',
  provider: 'slack',
  url: null,
  author: null,
  occurredAt: null,
  snippet: 'text',
  score,
});

describe('citations', () => {
  describe('CitationRegistry', () => {
    it('numbers new sources in order and keeps numbers stable for repeats', () => {
      // Arrange
      const registry = new CitationRegistry();

      // Act
      const actualFirst = registry.add(input('a', 0.4));
      const actualSecond = registry.add(input('b'));
      const actualRepeat = registry.add(input('a', 0.9));

      // Assert
      expect(actualFirst.n).toBe(1);
      expect(actualSecond.n).toBe(2);
      expect(actualRepeat.n).toBe(1);
      expect(actualRepeat.score).toBe(0.9);
      expect(registry.size).toBe(2);
    });
  });

  describe('extractCitedNumbers', () => {
    it('reads single and grouped markers', () => {
      // Arrange
      const inputAnswer = 'Atlas moved to Oct 14 [2]. SSO blocks it [3, 5][2].';

      // Act
      const actualNumbers = extractCitedNumbers(inputAnswer);

      // Assert
      expect(actualNumbers).toEqual([2, 3, 5]);
    });
  });

  describe('normalizeCitationMarkers', () => {
    it('splits grouped markers', () => {
      // Arrange
      const inputAnswer = 'Refunds are 30 days [1, 4].';

      // Act
      const actualAnswer = normalizeCitationMarkers(inputAnswer);

      // Assert
      expect(actualAnswer).toBe('Refunds are 30 days [1][4].');
    });
  });

  describe('selectCitations', () => {
    it('keeps only cited sources with their original numbers', () => {
      // Arrange
      const registry = new CitationRegistry();
      ['a', 'b', 'c'].forEach((id) => registry.add(input(id)));

      // Act
      const actualCitations = selectCitations(registry.list(), 'See [3] and [1].');

      // Assert
      expect(actualCitations.map((citation) => citation.n)).toEqual([1, 3]);
    });

    it('falls back to the top sources when nothing is cited', () => {
      // Arrange
      const registry = new CitationRegistry();
      ['a', 'b', 'c'].forEach((id) => registry.add(input(id)));

      // Act
      const actualCitations = selectCitations(registry.list(), 'No markers here.', 2);

      // Assert
      expect(actualCitations.map((citation) => citation.hydraId)).toEqual(['a', 'b']);
    });
  });
});
