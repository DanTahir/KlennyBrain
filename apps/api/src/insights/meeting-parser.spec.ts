import { daysOverdue, daysUntilDue, parseMeetingBody } from './meeting-parser';

const MEETING_BODY = [
  'Meeting "Support & Finance policy review" on 2026-08-18 (45 min).',
  'Attendees: Priya Shah <priya@northwind.dev>',
  '',
  '## Summary',
  'Reviewed the refund window.',
  '',
  '## Decisions',
  '- Extend the refund window from 14 to 30 days',
  '',
  '## Action items',
  '- [open] Priya Shah (priya@northwind.dev): Update the Refund Policy doc to 30 days (due 2026-08-25)',
  '- [done] Omar Haddad (omar@northwind.dev): Schedule a Globex check-in for 2026-10-15 (due 2026-10-07)',
  '- [open] Lena Fischer (lena@northwind.dev): Send Globex a written SSO timeline',
  '',
  '## Transcript',
  '- this bullet belongs to the transcript',
].join('\n');

describe('parseMeetingBody', () => {
  it('extracts decisions from the Decisions section only', () => {
    // Arrange
    const inputBody = MEETING_BODY;

    // Act
    const actual = parseMeetingBody(inputBody);

    // Assert
    expect(actual.decisions).toEqual(['Extend the refund window from 14 to 30 days']);
  });

  it('extracts action items with owner, status and due date', () => {
    // Arrange
    const inputBody = MEETING_BODY;

    // Act
    const actual = parseMeetingBody(inputBody);

    // Assert
    expect(actual.actionItems).toEqual([
      {
        status: 'open',
        ownerName: 'Priya Shah',
        ownerEmail: 'priya@northwind.dev',
        text: 'Update the Refund Policy doc to 30 days',
        due: '2026-08-25',
        open: true,
      },
      {
        status: 'done',
        ownerName: 'Omar Haddad',
        ownerEmail: 'omar@northwind.dev',
        text: 'Schedule a Globex check-in for 2026-10-15',
        due: '2026-10-07',
        open: false,
      },
      {
        status: 'open',
        ownerName: 'Lena Fischer',
        ownerEmail: 'lena@northwind.dev',
        text: 'Send Globex a written SSO timeline',
        due: null,
        open: true,
      },
    ]);
  });

  it('ignores the "none recorded" placeholder', () => {
    // Arrange
    const inputBody = '## Decisions\n- none recorded\n\n## Action items\n- none recorded';

    // Act
    const actual = parseMeetingBody(inputBody);

    // Assert
    expect(actual).toEqual({ decisions: [], actionItems: [] });
  });
});

describe('daysOverdue', () => {
  const inputNow = new Date('2026-10-12T22:00:00Z');

  it('counts whole days past the due date', () => {
    // Act
    const actual = daysOverdue('2026-10-09', inputNow);

    // Assert
    expect(actual).toBe(3);
  });

  it('is zero on the due date itself and for undated items', () => {
    // Act
    const actualToday = daysOverdue('2026-10-12', inputNow);
    const actualUndated = daysOverdue(null, inputNow);

    // Assert
    expect(actualToday).toBe(0);
    expect(actualUndated).toBe(0);
  });

  it('reports days remaining for future due dates', () => {
    // Act
    const actual = daysUntilDue('2026-10-14', inputNow);

    // Assert
    expect(actual).toBe(2);
  });
});
