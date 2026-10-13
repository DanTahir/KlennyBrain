import type { NormalizedRecord } from './normalized-record';
import { describeRedactions, passesLuhn, redactRecord, redactSensitive } from './redaction';

// Fake credentials are assembled at runtime so no token-shaped literal lives in the repo.
const FAKE_SLACK_TOKEN = ['xo', 'xb-', '1234567890-', 'abcdefghijklmnop'].join('');
const FAKE_AWS_KEY = ['AK', 'IA', 'ABCDEFGHIJKLMNOP'].join('');
const FAKE_GITHUB_TOKEN = ['gh', 'p_', 'a'.repeat(36)].join('');
const FAKE_OPENROUTER_KEY = ['sk', '-or', '-v1-', 'f'.repeat(48)].join('');

function record(overrides: Partial<NormalizedRecord> = {}): NormalizedRecord {
  return {
    externalId: 'ticket-1',
    provider: 'zendesk',
    kind: 'ticket',
    sourceSystem: 'ticket',
    title: 'Refund request',
    body: 'Customer asked about the refund window.',
    occurredAt: '2026-10-12T17:00:00.000Z',
    metadata: {},
    ...overrides,
  };
}

describe('passesLuhn', () => {
  it('accepts a valid test card number and rejects a mistyped one', () => {
    // Arrange
    const inputValid = '4111111111111111';
    const inputInvalid = '4111111111111112';

    // Act
    const actualValid = passesLuhn(inputValid);
    const actualInvalid = passesLuhn(inputInvalid);

    // Assert
    expect(actualValid).toBe(true);
    expect(actualInvalid).toBe(false);
  });
});

describe('redactSensitive', () => {
  it.each([
    ['a dashed SSN', 'My SSN is 123-45-6789, please update payroll.', 'My SSN is [REDACTED SSN], please update payroll.', 'ssn'],
    ['a spaced SSN', 'ssn 123 45 6789', 'ssn [REDACTED SSN]', 'ssn'],
    ['a labelled bare SSN', 'Social Security Number: 123456789', 'Social Security Number: [REDACTED SSN]', 'ssn'],
    ['a spaced card number', 'Card 4111 1111 1111 1111 exp 09/28', 'Card [REDACTED CARD ending 1111] exp 09/28', 'card'],
    ['a dashed card number', 'use 5555-5555-5555-4444 for the PO', 'use [REDACTED CARD ending 4444] for the PO', 'card'],
    ['a bare card number', 'amex 378282246310005 on file', 'amex [REDACTED CARD ending 0005] on file', 'card'],
    ['a parenthesised phone', 'Call me at (415) 555-0134 today', 'Call me at [REDACTED PHONE] today', 'phone'],
    ['a dashed phone', 'cell: 415-555-0134.', 'cell: [REDACTED PHONE].', 'phone'],
    ['a +1 phone', 'Reach Globex on +1 415 555 0134', 'Reach Globex on [REDACTED PHONE]', 'phone'],
    ['an international phone', 'UK office +44 20 7946 0958 ext 2', 'UK office [REDACTED PHONE] ext 2', 'phone'],
  ])('redacts %s', (_label, inputText, expectedText, expectedKind) => {
    // Act
    const actualResult = redactSensitive(inputText);

    // Assert
    expect(actualResult.text).toBe(expectedText);
    expect(actualResult.counts).toEqual({ [expectedKind]: 1 });
  });

  it('redacts credentials', () => {
    // Arrange
    const inputText = `slack ${FAKE_SLACK_TOKEN} aws ${FAKE_AWS_KEY} gh ${FAKE_GITHUB_TOKEN} or ${FAKE_OPENROUTER_KEY}`;

    // Act
    const actualResult = redactSensitive(inputText);

    // Assert
    expect(actualResult.text).toBe(
      'slack [REDACTED SECRET] aws [REDACTED SECRET] gh [REDACTED SECRET] or [REDACTED SECRET]',
    );
    expect(actualResult.counts).toEqual({ secret: 4 });
  });

  it('redacts a private key block', () => {
    // Arrange
    const inputText = ['key:', '-----BEGIN RSA PRIVATE KEY-----', 'MIIEabc', '-----END RSA PRIVATE KEY-----', 'done'].join(
      '\n',
    );

    // Act
    const actualResult = redactSensitive(inputText);

    // Assert
    expect(actualResult.text).toBe('key:\n[REDACTED SECRET]\ndone');
  });

  it.each([
    ['an ISO date', 'GA moved to 2026-10-14 after the replan.'],
    ['ticket and issue ids', 'ATL-212 blocks ATL-200; see ZD-1042 and BIL-77.'],
    ['money and ARR', 'Globex is $480,000 ARR with 120 robots, renewal 2026-11-30.'],
    ['a Slack timestamp', 'message ts 1760300000.000100 in C0C8LQJRZ8W'],
    ['a door code and times', 'Door code 7342, standup at 09:30, Q3 2026.'],
    ['a non-Luhn 16-digit number', 'order 4111 1111 1111 1112 shipped'],
    ['an unlabelled 9-digit number', 'invoice 123456789 is paid'],
    ['an SSN-shaped number the SSA never issues', 'ref 900-12-3456'],
    ['a version string', 'upgraded to 1.24.3 and 415.555.0134.2'],
    ['an email address', 'Contact sam@northwind.dev for the launch plan.'],
  ])('leaves %s alone', (_label, inputText) => {
    // Act
    const actualResult = redactSensitive(inputText);

    // Assert
    expect(actualResult.text).toBe(inputText);
    expect(actualResult.counts).toEqual({});
  });

  it('handles empty input', () => {
    // Act
    const actualResult = redactSensitive(undefined);

    // Assert
    expect(actualResult).toEqual({ text: '', counts: {} });
  });
});

describe('redactRecord', () => {
  it('returns the same record object when nothing is sensitive', () => {
    // Arrange
    const inputRecord = record();

    // Act
    const actualResult = redactRecord(inputRecord);

    // Assert
    expect(actualResult.record).toBe(inputRecord);
    expect(actualResult.counts).toEqual({});
  });

  it('redacts title, body and string fields without mutating the input', () => {
    // Arrange
    const inputRecord = record({
      title: 'Callback (415) 555-0134',
      body: 'Requester SSN 123-45-6789 paid with 4111 1111 1111 1111.',
      fields: { requester_phone: '415-555-0199', priority: 2 },
      extra: { customer: 'Globex' },
    });

    // Act
    const actualResult = redactRecord(inputRecord);

    // Assert
    expect(actualResult.record.title).toBe('Callback [REDACTED PHONE]');
    expect(actualResult.record.body).toBe('Requester SSN [REDACTED SSN] paid with [REDACTED CARD ending 1111].');
    expect(actualResult.record.fields).toEqual({ requester_phone: '[REDACTED PHONE]', priority: 2 });
    expect(actualResult.record.extra).toEqual({ customer: 'Globex', redacted: { phone: 2, ssn: 1, card: 1 } });
    expect(actualResult.counts).toEqual({ phone: 2, ssn: 1, card: 1 });
    expect(inputRecord.body).toBe('Requester SSN 123-45-6789 paid with 4111 1111 1111 1111.');
  });

  it('describes redaction counts for logs', () => {
    // Arrange
    const inputCounts = { ssn: 1, phone: 2 };

    // Act
    const actualDescription = describeRedactions(inputCounts);

    // Assert
    expect(actualDescription).toBe('1 ssn, 2 phone');
  });
});
