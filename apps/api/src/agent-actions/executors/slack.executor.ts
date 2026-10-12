import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WebClient } from '@slack/web-api';
import { DEFAULT_SLACK_ACTIONS_CHANNEL, ExecutionContext } from '../constants';

const str = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

export type SlackPostResult = { url: string | null; channel: string; channelName: string; ts: string };

/** Posts approved messages with the bot token. Unknown channels fall back to SLACK_ACTIONS_CHANNEL. */
@Injectable()
export class SlackExecutor {
  private client: WebClient | null = null;
  private channels: Map<string, string> | null = null;

  constructor(private readonly config: ConfigService) {}

  isConfigured(): boolean {
    return Boolean(this.config.get<string>('SLACK_BOT_TOKEN'));
  }

  async postMessage(payload: Record<string, unknown>, context: ExecutionContext): Promise<SlackPostResult> {
    const text = str(payload.text);
    if (!text) throw new Error('Slack message text is required');
    const requested = str(payload.channel)?.replace(/^#/, '');
    const fallback = (this.config.get<string>('SLACK_ACTIONS_CHANNEL') || DEFAULT_SLACK_ACTIONS_CHANNEL).replace(/^#/, '');
    const target = (await this.resolveChannel(requested)) ?? (await this.resolveChannel(fallback));
    if (!target) throw new Error(`Slack channel #${requested ?? fallback} was not found`);

    const client = this.getClient();
    const response = await client.chat.postMessage({
      channel: target.id,
      text,
      unfurl_links: false,
      blocks: [
        { type: 'section', text: { type: 'mrkdwn', text: text.slice(0, 2900) } },
        {
          type: 'context',
          elements: [{ type: 'mrkdwn', text: `:brain: Proposed by KlennyBrain · approved by ${context.approvedBy}` }],
        },
      ],
    });
    if (!response.ok || !response.ts) throw new Error(`Slack chat.postMessage failed: ${response.error ?? 'unknown error'}`);
    const permalink = await client.chat
      .getPermalink({ channel: target.id, message_ts: response.ts })
      .then((result) => result.permalink ?? null)
      .catch(() => null);
    return { url: permalink, channel: target.id, channelName: target.name, ts: response.ts };
  }

  private getClient(): WebClient {
    if (!this.client) {
      const token = this.config.get<string>('SLACK_BOT_TOKEN');
      if (!token) throw new Error('Slack is not configured (SLACK_BOT_TOKEN is empty)');
      this.client = new WebClient(token);
    }
    return this.client;
  }

  private async resolveChannel(nameOrId?: string): Promise<{ id: string; name: string } | null> {
    if (!nameOrId) return null;
    if (/^[CG][A-Z0-9]{6,}$/.test(nameOrId)) return { id: nameOrId, name: nameOrId };
    if (!this.channels) {
      const result = await this.getClient().conversations.list({
        types: 'public_channel',
        exclude_archived: true,
        limit: 500,
      });
      this.channels = new Map(
        (result.channels ?? [])
          .filter((channel): channel is { id: string; name: string } => Boolean(channel.id && channel.name))
          .map((channel) => [channel.name.toLowerCase(), channel.id]),
      );
    }
    const name = nameOrId.toLowerCase();
    const id = this.channels.get(name);
    return id ? { id, name } : null;
  }
}
