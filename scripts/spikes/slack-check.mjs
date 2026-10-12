// Verifies the Slack bot token (auth.test), lists channels and optionally posts
// one message. Never prints token values.
// Usage: node scripts/spikes/slack-check.mjs [--post <channel-name>]
import { apiRequire, loadApiEnv, describeError } from './_env.mjs';

const env = loadApiEnv();
const { WebClient } = apiRequire('@slack/web-api');
const client = new WebClient(env.SLACK_BOT_TOKEN);

try {
  const auth = await client.auth.test();
  console.log('auth.test ok:', { team: auth.team, team_id: auth.team_id, user: auth.user, bot_id: auth.bot_id });
  const scopes = auth.response_metadata?.scopes ?? [];
  console.log('scopes:', scopes.join(', ') || '(not reported)');

  const list = await client.conversations.list({ types: 'public_channel', limit: 200 });
  console.log('channels:', list.channels.map((c) => `#${c.name}${c.is_member ? '*' : ''}`).join(' '));

  const postIdx = process.argv.indexOf('--post');
  if (postIdx > 0) {
    const name = process.argv[postIdx + 1] ?? 'general';
    const channel = list.channels.find((c) => c.name === name);
    if (!channel) throw new Error(`channel #${name} not found`);
    const res = await client.chat.postMessage({
      channel: channel.id,
      text: 'KlennyBrain connectivity check: the brain is online. :brain:',
    });
    console.log('chat.postMessage ok:', { channel: res.channel, ts: res.ts });
  }
} catch (e) {
  console.error('slack check failed:', describeError(e), e?.data?.error, e?.data?.needed);
  process.exitCode = 1;
}
