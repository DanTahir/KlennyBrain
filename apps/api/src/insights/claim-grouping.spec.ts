import { Claim, findConflicts, groupClaims, normalizeKey, normalizeValue } from './claim-grouping';

const claim = (overrides: Partial<Claim>): Claim => ({
  subject: 'refund policy',
  attribute: 'refund window',
  value: '14 days',
  hydraId: 'docs-doc-refund-policy',
  title: 'Refund Policy',
  kind: 'knowledge_base',
  occurredAt: '2026-04-20T00:00:00.000Z',
  ...overrides,
});

describe('normalizeValue', () => {
  it('treats "30-day" and "30 days" as the same quantity', () => {
    // Act
    const actualHyphen = normalizeValue('a 30-day window');
    const actualPlural = normalizeValue('30 days');

    // Assert
    expect(actualHyphen).toBe('30 day');
    expect(actualPlural).toBe('30 day');
  });

  it('treats ISO and written dates as the same day', () => {
    // Act
    const actualIso = normalizeValue('2026-09-30');
    const actualWritten = normalizeValue('Sep 30, 2026');

    // Assert
    expect(actualIso).toBe('date:09-30');
    expect(actualWritten).toBe('date:09-30');
  });

  it('falls back to cleaned lowercase text', () => {
    // Act
    const actual = normalizeValue('  Devon   Lee! ');

    // Assert
    expect(actual).toBe('devon lee');
  });
});

describe('normalizeKey', () => {
  it('ignores word order, stopwords and plurals', () => {
    // Act
    const actualA = normalizeKey('The refund window', 'days');
    const actualB = normalizeKey('refund', 'window day');

    // Assert
    expect(actualA).toBe(actualB);
  });
});

describe('groupClaims', () => {
  it('groups paraphrased claims about the same topic', () => {
    // Arrange
    const inputClaims = [
      claim({}),
      claim({ subject: 'refund policy', attribute: 'refund windows', hydraId: 'slack-1', kind: 'message' }),
      claim({ subject: 'Atlas', attribute: 'launch date', hydraId: 'docs-doc-atlas-launch-plan' }),
    ];

    // Act
    const actual = groupClaims(inputClaims);

    // Assert
    expect(actual).toHaveLength(2);
    expect(actual[0].claims.map((item) => item.hydraId)).toEqual(['docs-doc-refund-policy', 'slack-1']);
  });
});

describe('findConflicts', () => {
  it('flags the older doc as stale when newer sources state a different value', () => {
    // Arrange
    const inputClaims = [
      claim({}),
      claim({
        value: '30 days',
        hydraId: 'meetings-2026-08-18',
        title: 'Support & Finance policy review',
        kind: 'meeting',
        occurredAt: '2026-08-18T17:00:00.000Z',
      }),
      claim({
        value: '30-day',
        hydraId: 'docs-doc-macro-refund-request',
        title: 'Macro: Refund Request Reply',
        occurredAt: '2026-08-21T00:00:00.000Z',
      }),
    ];

    // Act
    const actual = findConflicts(inputClaims);

    // Assert
    expect(actual).toHaveLength(1);
    expect(actual[0].current.hydraId).toBe('docs-doc-macro-refund-request');
    expect(actual[0].currentValue).toBe('30 day');
    expect(actual[0].conflicting.map((item) => item.hydraId)).toEqual(['docs-doc-refund-policy']);
    expect(actual[0].staleDocs.map((item) => item.hydraId)).toEqual(['docs-doc-refund-policy']);
  });

  it('reports no conflict when values only differ in formatting', () => {
    // Arrange
    const inputClaims = [claim({ value: '2026-10-14' }), claim({ value: 'Oct 14', hydraId: 'slack-2', kind: 'message' })];

    // Act
    const actual = findConflicts(inputClaims);

    // Assert
    expect(actual).toEqual([]);
  });

  it('does not mark a doc stale when the doc is the newest source', () => {
    // Arrange
    const inputClaims = [
      claim({ value: '30 days', occurredAt: '2026-09-01T00:00:00.000Z' }),
      claim({ value: '14 days', hydraId: 'slack-3', kind: 'message', occurredAt: '2026-05-01T00:00:00.000Z' }),
    ];

    // Act
    const actual = findConflicts(inputClaims);

    // Assert
    expect(actual).toHaveLength(1);
    expect(actual[0].current.hydraId).toBe('docs-doc-refund-policy');
    expect(actual[0].staleDocs).toEqual([]);
  });
});
