// Prepares the Slack bot for the demo: makes the bot join every public channel
// (app_mention events only arrive from channels the bot is a member of) and
// prints the bot user id. Never prints token values.
// Usage: node scripts/slack-bot-check.mjs
import { apiRequire, loadApiEnv, describeError } from './spikes/_env.mjs';

const env = loadApiEnv();
const { WebClient } = apiRequire('@slack/web-api');
const client = new WebClient(env.SLACK_BOT_TOKEN);

try {
  const auth = await client.auth.test();
  console.log('bot:', { team: auth.team, user: auth.user, user_id: auth.user_id });

  const list = await client.conversations.list({ types: 'public_channel', exclude_archived: true, limit: 200 });
  for (const channel of list.channels ?? []) {
    if (channel.is_member) {
      console.log(`#${channel.name}: already a member`);
      continue;
    }
    await client.conversations.join({ channel: channel.id });
    console.log(`#${channel.name}: joined`);
  }
  console.log(`\nMention the bot with <@${auth.user_id}> (shown as @${auth.user}) or use /brain.`);
} catch (e) {
  console.error('slack bot check failed:', describeError(e), e?.data?.error, e?.data?.needed);
  process.exitCode = 1;
}
