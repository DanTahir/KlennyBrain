import { aclAllows, evidenceHydraIds } from './insight-visibility';

describe('aclAllows', () => {
  it('allows org-public items', () => {
    // Act
    const actualNull = aclAllows(null, ['ollie@northwind.dev']);
    const actualEmpty = aclAllows([], ['ollie@northwind.dev']);

    // Assert
    expect(actualNull).toBe(true);
    expect(actualEmpty).toBe(true);
  });

  it('requires a matching ACL entry for restricted items', () => {
    // Arrange
    const inputItemAcl = ['group:slack:leadership', 'group:dept:exec'];

    // Act
    const actualIntern = aclAllows(inputItemAcl, ['ollie@northwind.dev', 'group:dept:engineering']);
    const actualCeo = aclAllows(inputItemAcl, ['elena@northwind.dev', 'group:slack:leadership']);

    // Assert
    expect(actualIntern).toBe(false);
    expect(actualCeo).toBe(true);
  });
});

describe('evidenceHydraIds', () => {
  it('returns citation hydraIds in order and skips malformed entries', () => {
    // Arrange
    const inputEvidence = [{ hydraId: 'docs-doc-refund-policy' }, { title: 'no id' }, null, { hydraId: 'slack-1' }];

    // Act
    const actual = evidenceHydraIds(inputEvidence);

    // Assert
    expect(actual).toEqual(['docs-doc-refund-policy', 'slack-1']);
  });

  it('returns an empty list for non-array evidence', () => {
    // Act
    const actual = evidenceHydraIds({ hydraId: 'x' });

    // Assert
    expect(actual).toEqual([]);
  });
});
