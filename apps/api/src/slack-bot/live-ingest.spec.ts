import { hydraIdFor } from '../ingestion/mappers/app-knowledge.mapper';
import {
  LiveSlackMessage,
  RawSlackMessage,
  shouldIngestSlackMessage,
  slackTsToIso,
  toLiveSlackRecord,
} from './live-ingest';

const BOT_ID = 'UBOT';

function rawMessage(overrides: Partial<RawSlackMessage> = {}): RawSlackMessage {
  return {
    channel: 'C123',
    ts: '1760300000.000100',
    text: 'Refund window is 30 days now',
    user: 'U111',
    channel_type: 'channel',
    ...overrides,
  };
}

function liveMessage(overrides: Partial<LiveSlackMessage> = {}): LiveSlackMessage {
  return {
    channelId: 'C123',
    channelName: 'support',
    isPrivate: false,
    ts: '1760300000.000100',
    text: 'Refund window is 30 days now, per <@U222|priya>',
    botUserId: BOT_ID,
    authorName: 'Ana Silva',
    authorEmail: 'ana@northwind.dev',
    authorTitle: 'Support Lead',
    department: 'Support',
    permalink: 'https://klennyspace.slack.com/archives/C123/p1760300000000100',
    teamId: 'T1',
    ...overrides,
  };
}

describe('shouldIngestSlackMessage', () => {
  it('accepts a human message in a public or private channel', () => {
    // Arrange
    const inputPublic = rawMessage();
    const inputPrivate = rawMessage({ channel_type: 'group' });

    // Act
    const actualPublic = shouldIngestSlackMessage(inputPublic, BOT_ID);
    const actualPrivate = shouldIngestSlackMessage(inputPrivate, BOT_ID);

    // Assert
    expect(actualPublic).toBe(true);
    expect(actualPrivate).toBe(true);
  });

  it.each([
    ['a DM', rawMessage({ channel_type: 'im' })],
    ['a bot post', rawMessage({ bot_id: 'B1' })],
    ['the bot itself', rawMessage({ user: BOT_ID })],
    ['a question to the bot', rawMessage({ text: `<@${BOT_ID}> what is our refund window?` })],
    ['an edit', rawMessage({ subtype: 'message_changed' })],
    ['a channel join', rawMessage({ subtype: 'channel_join' })],
    ['a too-short message', rawMessage({ text: 'ok' })],
    ['a message without a user', rawMessage({ user: undefined })],
  ])('skips %s', (_label, inputMessage) => {
    // Act
    const actualResult = shouldIngestSlackMessage(inputMessage, BOT_ID);

    // Assert
    expect(actualResult).toBe(false);
  });

  it('keeps thread broadcasts', () => {
    // Arrange
    const inputMessage = rawMessage({ subtype: 'thread_broadcast', thread_ts: '1760299999.000001' });

    // Act
    const actualResult = shouldIngestSlackMessage(inputMessage, BOT_ID);

    // Assert
    expect(actualResult).toBe(true);
  });
});

describe('slackTsToIso', () => {
  it('converts a Slack ts to an ISO timestamp', () => {
    // Arrange
    const inputTs = '1760300000.000100';

    // Act
    const actualIso = slackTsToIso(inputTs);

    // Assert
    expect(actualIso).toBe('2025-10-12T20:13:20.000Z');
  });

  it('rejects a malformed ts', () => {
    // Arrange
    const inputTs = 'not-a-ts';

    // Act + Assert
    expect(() => slackTsToIso(inputTs)).toThrow('Invalid Slack timestamp');
  });
});

describe('toLiveSlackRecord', () => {
  it('maps a public channel message like the demo Slack adapter does', () => {
    // Arrange
    const inputMessage = liveMessage();

    // Act
    const actualRecord = toLiveSlackRecord(inputMessage);

    // Assert
    expect(actualRecord).not.toBeNull();
    expect(actualRecord?.provider).toBe('slack');
    expect(actualRecord?.kind).toBe('message');
    expect(actualRecord?.sourceSystem).toBe('slack');
    expect(actualRecord?.externalId).toBe('live-C123-1760300000.000100');
    expect(hydraIdFor(actualRecord!.provider, actualRecord!.externalId)).toBe('slack-live-c123-1760300000-000100');
    expect(actualRecord?.acl).toBeNull();
    expect(actualRecord?.metadata.channel).toBe('support');
    expect(actualRecord?.metadata.department).toBe('Support');
    expect(actualRecord?.title).toBe('#support - Ana Silva: Refund window is 30 days now, per @priya');
    expect(actualRecord?.body).toContain('Ana Silva (Support Lead) in #support on 2025-10-12 (live from Slack):');
    expect(actualRecord?.threadId).toBe('live-C123-1760300000.000100');
    expect(actualRecord?.replyToId).toBeNull();
    expect(actualRecord?.people).toEqual(['ana@northwind.dev']);
    expect(actualRecord?.extra).toMatchObject({ live: true, channel_id: 'C123', slack_team_id: 'T1' });
  });

  it('dates the body on the Pacific calendar the agent uses for today', () => {
    // Arrange (2026-10-13T02:15:52Z is the evening of 2026-10-12 in Pacific time)
    const inputMessage = liveMessage({ ts: '1791857752.146169' });

    // Act
    const actualRecord = toLiveSlackRecord(inputMessage);

    // Assert
    expect(actualRecord?.occurredAt).toBe('2026-10-13T02:15:52.146Z');
    expect(actualRecord?.body).toContain('in #support on 2026-10-12 (live from Slack):');
  });

  it('restricts private channel messages to the channel group', () => {
    // Arrange
    const inputMessage = liveMessage({ isPrivate: true, channelName: 'leadership' });

    // Act
    const actualRecord = toLiveSlackRecord(inputMessage);

    // Assert
    expect(actualRecord?.acl).toEqual(['group:slack:leadership']);
  });

  it('links thread replies to their parent message', () => {
    // Arrange
    const inputMessage = liveMessage({ ts: '1760300100.000200', threadTs: '1760300000.000100' });

    // Act
    const actualRecord = toLiveSlackRecord(inputMessage);

    // Assert
    expect(actualRecord?.threadId).toBe('live-C123-1760300000.000100');
    expect(actualRecord?.replyToId).toBe('live-C123-1760300000.000100');
  });

  it('keeps a leading mention of a real user', () => {
    // Arrange
    const inputMessage = liveMessage({ text: '<@U222|priya> the macro still says 14 days' });

    // Act
    const actualRecord = toLiveSlackRecord(inputMessage);

    // Assert
    expect(actualRecord?.body).toContain('@priya the macro still says 14 days');
  });

  it('returns null when nothing meaningful is left after cleanup', () => {
    // Arrange
    const inputMessage = liveMessage({ text: `<@${BOT_ID}>  ` });

    // Act
    const actualRecord = toLiveSlackRecord(inputMessage);

    // Assert
    expect(actualRecord).toBeNull();
  });
});
