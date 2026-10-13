import type { Citation } from '@app-starter/shared';
import {
  buildAnswerMessage,
  chunkText,
  cleanSlackText,
  MAX_SOURCES,
  parseSlackUserMap,
  toSlackMrkdwn,
} from './blocks';

function makeCitation(n: number): Citation {
  return {
    n,
    hydraId: `doc-${n}`,
    title: `Source ${n}`,
    kind: 'knowledge_base',
    sourceSystem: 'docs',
    provider: 'docs',
    url: null,
    author: 'elena@northwind.dev',
    occurredAt: '2026-10-01T10:00:00.000Z',
    snippet: 'snippet',
  } as Citation;
}

describe('toSlackMrkdwn', () => {
  it('converts bold, headings, bullets and links', () => {
    // Arrange
    const inputMarkdown = '## **Launch**\n- **Date:** Oct 14 [1]\n- See [tracker](https://example.com/x)';

    // Act
    const actual = toSlackMrkdwn(inputMarkdown);

    // Assert
    expect(actual).toBe('*Launch*\n• *Date:* Oct 14 [1]\n• See <https://example.com/x|tracker>');
  });

  it('escapes angle brackets and ampersands outside links', () => {
    // Arrange
    const inputMarkdown = 'R&D says latency < 5ms';

    // Act
    const actual = toSlackMrkdwn(inputMarkdown);

    // Assert
    expect(actual).toBe('R&amp;D says latency &lt; 5ms');
  });
});

describe('chunkText', () => {
  it('keeps every chunk within the limit and preserves all content', () => {
    // Arrange
    const inputText = ['a'.repeat(30), 'b'.repeat(30), 'c'.repeat(75)].join('\n\n');

    // Act
    const actual = chunkText(inputText, 64);

    // Assert
    expect(actual.every((chunk) => chunk.length <= 64)).toBe(true);
    expect(actual.join('').replace(/\n/g, '')).toBe(inputText.replace(/\n/g, ''));
  });
});

describe('buildAnswerMessage', () => {
  it('includes the question, a capped sources block, an open button and the permission footer', () => {
    // Arrange
    const inputCitations = Array.from({ length: MAX_SOURCES + 2 }, (_, index) => makeCitation(index + 1));

    // Act
    const actual = buildAnswerMessage({
      answer: 'Atlas moved to **Oct 14** [1].',
      citations: inputCitations,
      question: 'When does Atlas launch?',
      askedAs: 'Ollie (ollie@northwind.dev)',
      openUrl: 'http://localhost:3000/organizations/org-1/ask',
      actionsProposed: 2,
    });

    // Assert
    const actualJson = JSON.stringify(actual.blocks);
    expect(actual.text).toContain('Atlas moved');
    expect(actualJson).toContain('*Q:* When does Atlas launch?');
    expect(actualJson).toContain('*[6]* Source 6');
    expect(actualJson).not.toContain('*[7]* Source 7');
    expect(actualJson).toContain('+2 more in KlennyBrain');
    expect(actualJson).toContain('I proposed 2 actions');
    expect(actualJson).toContain('open_in_brain');
    expect(actualJson).toContain('permissions of Ollie (ollie@northwind.dev)');
  });
});

describe('parseSlackUserMap', () => {
  it('parses comma separated id=email pairs and lowercases emails', () => {
    // Arrange
    const inputRaw = 'U1=Elena@Northwind.dev, U2=ollie@northwind.dev,broken';

    // Act
    const actual = parseSlackUserMap(inputRaw);

    // Assert
    expect([...actual.entries()]).toEqual([
      ['U1', 'elena@northwind.dev'],
      ['U2', 'ollie@northwind.dev'],
    ]);
  });
});

describe('cleanSlackText', () => {
  it('removes the bot mention and decodes channel, link and entity markup', () => {
    // Arrange
    const inputText = '<@UBOT> what changed in <#C1|atlas-launch> &amp; <https://x.dev|the doc>?';

    // Act
    const actual = cleanSlackText(inputText, 'UBOT');

    // Assert
    expect(actual).toBe('what changed in #atlas-launch & the doc?');
  });
});
