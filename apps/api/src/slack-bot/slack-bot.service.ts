import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OrgRole } from '@prisma/client';
import { App, LogLevel } from '@slack/bolt';
import type { PersonaDto } from '@app-starter/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AclService, BrainIdentity } from '../acl/acl.service';
import { AskService } from '../ask/ask.service';
import { IngestionService } from '../ingestion/ingestion.service';
import { RawSlackMessage, shouldIngestSlackMessage, toLiveSlackRecord } from './live-ingest';
import {
  buildAnswerMessage,
  buildErrorMessage,
  cleanSlackText,
  HELP_TEXT,
  parseSlackUserMap,
  SlackMessage,
} from './blocks';

type SlackClient = App['client'];

interface SlackAuthor {
  name: string;
  email: string | null;
  title: string | null;
  department: string | null;
}

interface SlackChannel {
  name: string;
  isPrivate: boolean;
}

interface AskOptions {
  /** Echo the question in the reply (slash commands hide the original text). */
  echoQuestion?: boolean;
}

/**
 * Slack front door to the brain: `@Brain` mentions and DMs are answered in-thread,
 * `/brain` replies in-channel. Runs over Socket Mode, so no public URL is needed.
 *
 * Permissions: the Slack user is mapped to a directory person (SLACK_USER_MAP,
 * DirectoryPerson.slackUserId, then their Slack profile email). Unmapped users get
 * an ACL that matches no restricted item, so they only see public knowledge.
 *
 * Live ingestion: new human messages in channels the bot is in are upserted into
 * the brain (HydraDB + Postgres mirror) under a SLACK source, so they become
 * searchable within about a minute. Private channels keep a `group:slack:<name>` ACL.
 */
@Injectable()
export class SlackBotService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(SlackBotService.name);
  private app: App | null = null;
  private botUserId: string | null = null;
  private organization: { id: string; slug: string } | null = null;
  private teamId: string | null = null;
  private liveSourceId: string | null = null;
  private readonly seen = new Set<string>();
  private readonly channels = new Map<string, SlackChannel>();
  private readonly authors = new Map<string, SlackAuthor>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly acl: AclService,
    private readonly ask: AskService,
    private readonly ingestion: IngestionService,
    private readonly config: ConfigService,
  ) {}

  onApplicationBootstrap(): void {
    const botToken = this.config.get<string>('SLACK_BOT_TOKEN');
    const appToken = this.config.get<string>('SLACK_APP_TOKEN');
    if (!botToken || !appToken) {
      this.logger.log('Slack bot disabled (SLACK_BOT_TOKEN / SLACK_APP_TOKEN not set)');
      return;
    }
    if (this.config.get<string>('SLACK_BOT_ENABLED') === 'false' || process.env.NODE_ENV === 'test') {
      this.logger.log('Slack bot disabled by configuration');
      return;
    }
    // Never block API startup on the Slack socket.
    void this.start(botToken, appToken);
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.app) return;
    await this.app.stop().catch(() => undefined);
    this.app = null;
  }

  private async start(botToken: string, appToken: string): Promise<void> {
    const app = new App({ token: botToken, appToken, socketMode: true, logLevel: LogLevel.WARN });

    app.event('app_mention', async ({ event, client }) => {
      if (!event.user || this.isDuplicate(`${event.channel}:${event.ts}`)) return;
      await this.answerInThread(client, {
        channel: event.channel,
        threadTs: event.thread_ts ?? event.ts,
        slackUserId: event.user,
        text: event.text,
      });
    });

    app.message(async ({ message, client }) => {
      if (message.channel_type === 'channel' || message.channel_type === 'group') {
        await this.ingestLive(client, message as unknown as RawSlackMessage);
        return;
      }
      if (message.channel_type !== 'im' || message.subtype !== undefined) return;
      if (!('user' in message) || !message.user || ('bot_id' in message && message.bot_id)) return;
      if (this.isDuplicate(`${message.channel}:${message.ts}`)) return;
      await this.answerInThread(client, {
        channel: message.channel,
        threadTs: ('thread_ts' in message && message.thread_ts) || undefined,
        slackUserId: message.user,
        text: ('text' in message && message.text) || '',
      });
    });

    app.command('/brain', async ({ command, ack, respond, client }) => {
      const question = cleanSlackText(command.text ?? '', this.botUserId);
      if (!question) {
        await ack({ response_type: 'ephemeral', text: HELP_TEXT });
        return;
      }
      await ack({ response_type: 'ephemeral', text: `:mag: Searching the brain for "${question}"…` });
      const reply = await this.answer(client, command.user_id, question, { echoQuestion: true });
      await respond({ response_type: 'in_channel', replace_original: false, text: reply.text, blocks: reply.blocks });
    });

    // The "Open in KlennyBrain" button is a plain link; interactions still need an ack.
    app.action('open_in_brain', async ({ ack }) => {
      await ack();
    });

    app.error(async (error) => {
      this.logger.warn(`Slack bot error: ${error.message}`);
    });

    try {
      await app.start();
      const auth = await app.client.auth.test();
      this.botUserId = auth.user_id ?? null;
      this.teamId = auth.team_id ?? null;
      this.app = app;
      this.logger.log(
        `Slack bot connected over Socket Mode as ${auth.user ?? 'bot'} (${auth.team ?? 'team'}); live ingestion ${
          this.liveIngestEnabled() ? 'on' : 'off'
        }`,
      );
    } catch (error) {
      this.logger.warn(`Slack bot failed to start: ${(error as Error).message}`);
      await app.stop().catch(() => undefined);
    }
  }

  private liveIngestEnabled(): boolean {
    return this.config.get<string>('SLACK_LIVE_INGEST') !== 'false';
  }

  /** Upserts one channel message into the brain. Failures are logged and never reach Slack users. */
  private async ingestLive(client: SlackClient, message: RawSlackMessage): Promise<void> {
    if (!this.liveIngestEnabled() || !shouldIngestSlackMessage(message, this.botUserId)) return;
    if (this.isDuplicate(`ingest:${message.channel}:${message.ts}`)) return;
    try {
      const organization = await this.resolveOrganization();
      const [channel, author, permalink] = await Promise.all([
        this.channelFor(client, message.channel, message.channel_type),
        this.authorFor(client, organization.id, message.user as string),
        client.chat
          .getPermalink({ channel: message.channel, message_ts: message.ts })
          .then((result) => result.permalink ?? null)
          .catch(() => null),
      ]);
      const record = toLiveSlackRecord({
        channelId: message.channel,
        channelName: channel.name,
        isPrivate: channel.isPrivate,
        ts: message.ts,
        threadTs: message.thread_ts ?? null,
        text: message.text ?? '',
        botUserId: this.botUserId,
        authorName: author.name,
        authorEmail: author.email,
        authorTitle: author.title,
        department: author.department,
        permalink,
        teamId: this.teamId,
      });
      if (!record) return;

      const sourceId = await this.liveSourceIdFor(organization.id);
      const hydraId = await this.ingestion.upsertRecord(organization.id, sourceId, record);
      await this.prisma.source.update({
        where: { id: sourceId },
        data: {
          status: 'READY',
          error: null,
          lastSyncedAt: new Date(),
          itemCount: await this.prisma.knowledgeItem.count({ where: { sourceId } }),
        },
      });
      this.logger.log(`Live-ingested Slack message ${hydraId} from #${channel.name}`);
    } catch (error) {
      this.logger.warn(`Live Slack ingest failed for ${message.channel}:${message.ts}: ${(error as Error).message}`);
    }
  }

  /** The SLACK source that owns live-ingested messages (created on first use). */
  private async liveSourceIdFor(organizationId: string): Promise<string> {
    if (this.liveSourceId) return this.liveSourceId;
    const existing = await this.prisma.source.findFirst({
      where: { organizationId, type: 'SLACK', deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    const source =
      existing ??
      (await this.prisma.source.create({
        data: {
          organizationId,
          type: 'SLACK',
          name: 'Slack (live)',
          status: 'READY',
          config: { mode: 'live', ...(this.teamId ? { teamId: this.teamId } : {}) },
        },
      }));
    this.liveSourceId = source.id;
    return source.id;
  }

  /** Private channels stay private even when conversations.info is unavailable. */
  private async channelFor(client: SlackClient, channelId: string, channelType?: string): Promise<SlackChannel> {
    const cached = this.channels.get(channelId);
    if (cached) return cached;
    let channel: SlackChannel = { name: channelId.toLowerCase(), isPrivate: channelType === 'group' };
    try {
      const info = await client.conversations.info({ channel: channelId });
      channel = {
        name: info.channel?.name ?? channel.name,
        isPrivate: channel.isPrivate || Boolean(info.channel?.is_private),
      };
    } catch (error) {
      this.logger.warn(`conversations.info failed for ${channelId}: ${(error as Error).message}`);
    }
    this.channels.set(channelId, channel);
    return channel;
  }

  /** Message authors are attributed to directory people when possible; never to the default persona. */
  private async authorFor(client: SlackClient, organizationId: string, slackUserId: string): Promise<SlackAuthor> {
    const cached = this.authors.get(slackUserId);
    if (cached) return cached;

    let profileName: string | null = null;
    let profileEmail: string | null = null;
    try {
      const info = await client.users.info({ user: slackUserId });
      profileName = info.user?.profile?.real_name || info.user?.real_name || info.user?.name || null;
      profileEmail = info.user?.profile?.email?.trim().toLowerCase() || null;
    } catch (error) {
      this.logger.warn(`users.info failed for ${slackUserId}: ${(error as Error).message}`);
    }

    const mapped = parseSlackUserMap(this.config.get<string>('SLACK_USER_MAP')).get(slackUserId);
    const bySlackId = await this.prisma.directoryPerson.findFirst({ where: { organizationId, slackUserId } });
    const email = mapped ?? bySlackId?.email.toLowerCase() ?? profileEmail;
    const person =
      bySlackId && bySlackId.email.toLowerCase() === email
        ? bySlackId
        : email
          ? await this.prisma.directoryPerson.findFirst({ where: { organizationId, email } })
          : null;

    const author: SlackAuthor = {
      name: person?.name ?? profileName ?? slackUserId,
      email,
      title: person?.title ?? null,
      department: person?.department ?? null,
    };
    this.authors.set(slackUserId, author);
    return author;
  }

  private async answerInThread(
    client: SlackClient,
    input: { channel: string; threadTs?: string; slackUserId: string; text: string },
  ): Promise<void> {
    const question = cleanSlackText(input.text, this.botUserId);
    if (!question) {
      await client.chat.postMessage({ channel: input.channel, thread_ts: input.threadTs, text: HELP_TEXT });
      return;
    }

    const placeholder = await client.chat.postMessage({
      channel: input.channel,
      thread_ts: input.threadTs,
      text: ':mag: Searching Slack, docs, email, meetings and tickets…',
    });

    const reply = await this.answer(client, input.slackUserId, question);
    if (placeholder.ts) {
      await client.chat.update({ channel: input.channel, ts: placeholder.ts, text: reply.text, blocks: reply.blocks });
    } else {
      await client.chat.postMessage({
        channel: input.channel,
        thread_ts: input.threadTs,
        text: reply.text,
        blocks: reply.blocks,
      });
    }
  }

  private async answer(
    client: SlackClient,
    slackUserId: string,
    question: string,
    options: AskOptions = {},
  ): Promise<SlackMessage> {
    const startedAt = Date.now();
    try {
      const organization = await this.resolveOrganization();
      const identity = await this.identityFor(client, organization.id, slackUserId);
      const result = await this.ask.ask(identity, { question });
      this.logger.log(
        `Slack ask by ${slackUserId} as ${identity.effectiveEmail}: ${result.citations.length} citations in ${Date.now() - startedAt}ms`,
      );
      return buildAnswerMessage({
        answer: result.answer,
        citations: result.citations,
        question: options.echoQuestion ? question : undefined,
        askedAs: identity.person
          ? `${identity.person.name} (${identity.person.email})`
          : 'a guest (public knowledge only)',
        openUrl: `${this.frontendUrl()}/organizations/${organization.id}/ask`,
        actionsProposed: result.actions.length,
      });
    } catch (error) {
      this.logger.warn(`Slack ask failed: ${(error as Error).message}`);
      return buildErrorMessage((error as Error).message);
    }
  }

  /** Resolves the Slack user to a brain identity. Unknown users never see restricted items. */
  private async identityFor(client: SlackClient, organizationId: string, slackUserId: string): Promise<BrainIdentity> {
    const email = await this.resolveDirectoryEmail(client, organizationId, slackUserId);

    let acl: string[];
    let person: PersonaDto | null = null;
    let effectiveEmail: string;
    if (email) {
      const resolved = await this.acl.aclForEmail(organizationId, email);
      acl = resolved.acl;
      person = resolved.person;
      effectiveEmail = email;
    } else {
      effectiveEmail = `slack:${slackUserId.toLowerCase()}`;
      acl = [effectiveEmail];
    }

    return {
      userId: await this.persistenceUserId(organizationId, email),
      organizationId,
      email: effectiveEmail,
      role: OrgRole.MEMBER,
      person,
      viewAs: null,
      effectiveEmail,
      acl,
    };
  }

  private async resolveDirectoryEmail(
    client: SlackClient,
    organizationId: string,
    slackUserId: string,
  ): Promise<string | null> {
    const mapped = parseSlackUserMap(this.config.get<string>('SLACK_USER_MAP')).get(slackUserId);
    if (mapped) return mapped;

    const bySlackId = await this.prisma.directoryPerson.findFirst({ where: { organizationId, slackUserId } });
    if (bySlackId) return bySlackId.email.toLowerCase();

    try {
      const info = await client.users.info({ user: slackUserId });
      const slackEmail = info.user?.profile?.email?.trim().toLowerCase();
      if (slackEmail) {
        const byEmail = await this.prisma.directoryPerson.findFirst({ where: { organizationId, email: slackEmail } });
        if (byEmail) return slackEmail;
      }
    } catch (error) {
      this.logger.warn(`users.info failed for ${slackUserId}: ${(error as Error).message}`);
    }

    const fallback = this.config.get<string>('SLACK_DEFAULT_PERSONA_EMAIL')?.trim().toLowerCase();
    return fallback || null;
  }

  /**
   * Conversations belong to an app user. Prefer the matching member account;
   * otherwise file the Slack conversation under the organization owner.
   */
  private async persistenceUserId(organizationId: string, email: string | null): Promise<string> {
    if (email) {
      const member = await this.prisma.organizationMember.findFirst({
        where: { organizationId, user: { email } },
        select: { userId: true },
      });
      if (member) return member.userId;
    }
    const owner = await this.prisma.organizationMember.findFirst({
      where: { organizationId, role: OrgRole.OWNER },
      orderBy: { createdAt: 'asc' },
      select: { userId: true },
    });
    if (!owner) throw new Error('The Slack organization has no owner to store conversations under');
    return owner.userId;
  }

  private async resolveOrganization(): Promise<{ id: string; slug: string }> {
    if (this.organization) return this.organization;
    const slug = this.config.get<string>('SLACK_DEFAULT_ORG_SLUG') || 'northwind';
    const organization = await this.prisma.organization.findFirst({
      where: { slug },
      select: { id: true, slug: true },
    });
    if (!organization) throw new Error(`No organization with slug "${slug}" (SLACK_DEFAULT_ORG_SLUG)`);
    this.organization = organization;
    return organization;
  }

  private frontendUrl(): string {
    return (this.config.get<string>('FRONTEND_URL') || 'http://localhost:3000').replace(/\/$/, '');
  }

  /** Socket Mode can redeliver events; answer each message once. */
  private isDuplicate(key: string): boolean {
    if (this.seen.has(key)) return true;
    this.seen.add(key);
    if (this.seen.size > 500) {
      const oldest = this.seen.values().next().value;
      if (oldest !== undefined) this.seen.delete(oldest);
    }
    return false;
  }
}
