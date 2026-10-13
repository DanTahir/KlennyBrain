import type { NormalizedRecord } from '../ingestion/normalized-record';
import { todayInPacific } from '../ask/agent/prompts';
import { cleanSlackText } from './blocks';

const MIN_TEXT_LENGTH = 3;
const TITLE_SNIPPET_LENGTH = 80;
/** Subtypes that still carry a real user message worth remembering. */
const INGESTIBLE_SUBTYPES = new Set(['thread_broadcast']);

/** The subset of a Slack `message` event the live ingester reads. */
export interface RawSlackMessage {
  channel: string;
  ts: string;
  thread_ts?: string;
  text?: string;
  user?: string;
  bot_id?: string;
  subtype?: string;
  channel_type?: string;
}

export interface LiveSlackMessage {
  channelId: string;
  channelName: string;
  isPrivate: boolean;
  ts: string;
  threadTs?: string | null;
  text: string;
  botUserId?: string | null;
  authorName: string;
  authorEmail?: string | null;
  authorTitle?: string | null;
  department?: string | null;
  permalink?: string | null;
  teamId?: string | null;
}

/**
 * Live ingestion keeps human channel messages only: no bot posts, no edits/joins,
 * and no questions addressed to the bot (those are asks, not knowledge).
 */
export function shouldIngestSlackMessage(message: RawSlackMessage, botUserId: string | null): boolean {
  if (message.channel_type !== 'channel' && message.channel_type !== 'group') return false;
  if (message.subtype && !INGESTIBLE_SUBTYPES.has(message.subtype)) return false;
  if (message.bot_id || !message.user) return false;
  if (botUserId && (message.user === botUserId || (message.text ?? '').includes(`<@${botUserId}`))) return false;
  return (message.text ?? '').trim().length >= MIN_TEXT_LENGTH;
}

export function slackTsToIso(ts: string): string {
  const seconds = Number.parseFloat(ts);
  if (!Number.isFinite(seconds)) throw new Error(`Invalid Slack timestamp "${ts}"`);
  return new Date(Math.round(seconds * 1000)).toISOString();
}

export function liveSlackExternalId(channelId: string, ts: string): string {
  return `live-${channelId}-${ts}`;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Maps a live Slack message to the same record shape the demo adapter produces for Slack exports. */
export function toLiveSlackRecord(message: LiveSlackMessage): NormalizedRecord | null {
  // A non-empty bot id keeps cleanSlackText from stripping a leading mention of a real user.
  const text = cleanSlackText(message.text, message.botUserId || 'UNKNOWN_BOT').trim();
  if (text.length < MIN_TEXT_LENGTH) return null;

  const occurredAt = slackTsToIso(message.ts);
  const isReply = Boolean(message.threadTs && message.threadTs !== message.ts);
  const threadExternalId = isReply ? liveSlackExternalId(message.channelId, message.threadTs as string) : null;
  const authorLabel = `${message.authorName}${message.authorTitle ? ` (${message.authorTitle})` : ''}`;

  return {
    externalId: liveSlackExternalId(message.channelId, message.ts),
    provider: 'slack',
    kind: 'message',
    sourceSystem: 'slack',
    title: `#${message.channelName} - ${message.authorName}: ${truncate(text.replace(/\s+/g, ' '), TITLE_SNIPPET_LENGTH)}`,
    // Same calendar (Pacific) the agent prompt uses for "today", so evening posts aren't dated tomorrow.
    body: `${authorLabel} in #${message.channelName} on ${todayInPacific(new Date(occurredAt))} (live from Slack):\n${text}`,
    url: message.permalink ?? null,
    authorEmail: message.authorEmail ?? null,
    occurredAt,
    acl: message.isPrivate ? [`group:slack:${message.channelName}`] : null,
    metadata: {
      channel: message.channelName,
      department: message.department ?? null,
      project: null,
    },
    threadId: threadExternalId ?? liveSlackExternalId(message.channelId, message.ts),
    replyToId: threadExternalId,
    people: message.authorEmail ? [message.authorEmail] : [],
    extra: {
      live: true,
      channel_id: message.channelId,
      slack_ts: message.ts,
      author_name: message.authorName,
      ...(message.teamId ? { slack_team_id: message.teamId } : {}),
    },
  };
}
