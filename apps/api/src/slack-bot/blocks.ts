import type { Citation } from '@app-starter/shared';

/** Structural Block Kit block; assignable to Slack's `Block` without importing @slack/types. */
export type KnownBlock = { type: string; block_id?: string } & Record<string, unknown>;

/** Slack rejects section text over 3000 chars; leave headroom. */
export const SECTION_LIMIT = 2900;
export const MAX_SOURCES = 6;

export interface SlackMessage {
  text: string;
  blocks: KnownBlock[];
}

export interface AnswerMessageInput {
  answer: string;
  citations: Citation[];
  /** Echoed at the top (slash commands, where the question is not visible). */
  question?: string;
  /** Human label for whose permissions were applied. */
  askedAs: string;
  openUrl: string;
  actionsProposed: number;
}

export const HELP_TEXT =
  'Ask me anything about the company - I answer from Slack, docs, email, meetings and tickets, with citations.\n' +
  'Try `@Brain what is blocking the Atlas launch?` or `/brain who knows the billing service?`';

export function escapeSlack(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

/** Converts the agent's GitHub-flavoured markdown into Slack mrkdwn. */
export function toSlackMrkdwn(markdown: string): string {
  const links: string[] = [];
  let text = markdown.replace(/\r\n/g, '\n');

  // Protect markdown links before escaping so their angle brackets survive.
  text = text.replace(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g, (_match, label: string, url: string) => {
    links.push(`<${url}|${escapeSlack(label)}>`);
    return `\uE000${links.length - 1}\uE000`;
  });

  text = escapeSlack(text)
    .replace(/^#{1,6}\s+(.+)$/gm, (_match, heading: string) => `*${heading.replace(/\*\*/g, '').trim()}*`)
    .replace(/\*\*(.+?)\*\*/g, '*$1*')
    .replace(/__(.+?)__/g, '*$1*')
    .replace(/^(\s*)[-*+]\s+/gm, '$1• ')
    .replace(/^\s*-{3,}\s*$/gm, '');

  return text.replace(/\uE000(\d+)\uE000/g, (_match, index: string) => links[Number(index)] ?? '');
}

/** Splits text into section-sized chunks, preferring paragraph boundaries. */
export function chunkText(text: string, limit = SECTION_LIMIT): string[] {
  const pieces: string[] = [];
  for (const paragraph of text.split(/\n{2,}/)) {
    for (let start = 0; start < paragraph.length; start += limit) {
      pieces.push(paragraph.slice(start, start + limit));
    }
  }

  const chunks: string[] = [];
  let current = '';
  for (const piece of pieces) {
    if (!piece.trim()) continue;
    if (!current) current = piece;
    else if (current.length + 2 + piece.length <= limit) current = `${current}\n\n${piece}`;
    else {
      chunks.push(current);
      current = piece;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

const KIND_LABELS: Record<string, string> = {
  message: 'Slack',
  email: 'Email',
  ticket: 'Ticket',
  meeting: 'Meeting',
  knowledge_base: 'Doc',
};

export function formatSourceLine(citation: Citation): string {
  const parts = [`*[${citation.n}]* ${escapeSlack(truncate(citation.title || citation.hydraId, 90))}`];
  parts.push(KIND_LABELS[citation.kind] ?? citation.kind);
  if (citation.author) parts.push(escapeSlack(citation.author));
  if (citation.occurredAt) parts.push(citation.occurredAt.slice(0, 10));
  return parts.join(' · ');
}

export function buildAnswerMessage(input: AnswerMessageInput): SlackMessage {
  const blocks: KnownBlock[] = [];

  if (input.question) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*Q:* ${escapeSlack(truncate(input.question, 500))}` },
    });
  }

  const answer = input.answer.trim() || '_The brain returned an empty answer._';
  for (const chunk of chunkText(toSlackMrkdwn(answer))) {
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: chunk } });
  }

  const sources = input.citations.slice(0, MAX_SOURCES);
  if (sources.length > 0) {
    const extra = input.citations.length - sources.length;
    const lines = sources.map(formatSourceLine);
    if (extra > 0) lines.push(`_+${extra} more in KlennyBrain_`);
    blocks.push({ type: 'divider' });
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: truncate(`*Sources*\n${lines.join('\n')}`, 2900) }],
    });
  }

  if (input.actionsProposed > 0) {
    const noun = input.actionsProposed === 1 ? 'action' : 'actions';
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `:clipboard: I proposed ${input.actionsProposed} ${noun}. Nothing runs until an owner or admin approves it in KlennyBrain.`,
      },
    });
  }

  blocks.push({
    type: 'actions',
    elements: [
      {
        type: 'button',
        action_id: 'open_in_brain',
        text: { type: 'plain_text', text: 'Open in KlennyBrain' },
        url: input.openUrl,
      },
    ],
  });
  blocks.push({
    type: 'context',
    elements: [{ type: 'mrkdwn', text: `:lock: Answered with the permissions of ${escapeSlack(input.askedAs)}` }],
  });

  return { text: truncate(answer, SECTION_LIMIT), blocks };
}

export function buildErrorMessage(message: string): SlackMessage {
  const text = `:warning: The brain could not answer: ${message}`;
  return { text, blocks: [{ type: 'section', text: { type: 'mrkdwn', text: escapeSlack(text) } }] };
}

/**
 * Parses `SLACK_USER_MAP` ("U123=elena@northwind.dev,U456=ollie@northwind.dev")
 * into Slack user id -> lowercased directory email.
 */
export function parseSlackUserMap(raw: string | undefined): Map<string, string> {
  const map = new Map<string, string>();
  for (const entry of (raw ?? '').split(/[,;\s]+/)) {
    const [slackId, email] = entry.split('=');
    if (slackId?.trim() && email?.trim()) map.set(slackId.trim(), email.trim().toLowerCase());
  }
  return map;
}

/** Strips the bot mention and decodes Slack's message markup into plain text. */
export function cleanSlackText(text: string, botUserId?: string | null): string {
  let cleaned = text;
  if (botUserId) cleaned = cleaned.replace(new RegExp(`<@${botUserId}(\\|[^>]*)?>`, 'g'), '');
  else cleaned = cleaned.replace(/^\s*<@[A-Z0-9]+(\|[^>]*)?>/, '');
  return cleaned
    .replace(/<#[A-Z0-9]+\|([^>]+)>/g, '#$1')
    .replace(/<@([A-Z0-9]+)\|([^>]+)>/g, '@$2')
    .replace(/<(https?:\/\/[^|>]+)\|([^>]+)>/g, '$2')
    .replace(/<(https?:\/\/[^>]+)>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}
