import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OrgRole } from '@prisma/client';
import { App, LogLevel } from '@slack/bolt';
import type { PersonaDto } from '@app-starter/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AclService, BrainIdentity } from '../acl/acl.service';
import { AskService } from '../ask/ask.service';
import {
  buildAnswerMessage,
  buildErrorMessage,
  cleanSlackText,
  HELP_TEXT,
  parseSlackUserMap,
  SlackMessage,
} from './blocks';

type SlackClient = App['client'];

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
 */
@Injectable()
export class SlackBotService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(SlackBotService.name);
  private app: App | null = null;
  private botUserId: string | null = null;
  private organization: { id: string; slug: string } | null = null;
  private readonly seen = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly acl: AclService,
    private readonly ask: AskService,
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
      this.app = app;
      this.logger.log(`Slack bot connected over Socket Mode as ${auth.user ?? 'bot'} (${auth.team ?? 'team'})`);
    } catch (error) {
      this.logger.warn(`Slack bot failed to start: ${(error as Error).message}`);
      await app.stop().catch(() => undefined);
    }
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
