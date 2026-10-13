// End-to-end check for live Slack ingestion. Posts a human-authored message (Slack
// user token) with a unique fact into a channel the bot is in, waits for HydraDB to
// index it, then asks the brain about it. Requires `pnpm dev` with the Slack bot on.
//   node scripts/slack-live-check.mjs [--channel all-klennyspace] [--wait 75]
// The user token (needs the chat:write user scope) comes from SLACK_USER_TOKEN or the
// "User OAuth token" line of the gitignored SlackTokens.txt; it is never printed.
// Without a posting token, type the message in Slack yourself and verify it with:
//   node scripts/slack-live-check.mjs --code 1234 --wait 0
//   (message: "Facilities update: the door code for the Oakland HQ demo room is now 1234, effective today.")
import { existsSync, readFileSync } from 'node:fs';

const API = (process.env.SMOKE_API_URL || 'http://localhost:3001').replace(/\/$/, '');
const PASSWORD = process.env.SMOKE_PASSWORD || 'Password123!';

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index > -1 ? process.argv[index + 1] : fallback;
}

const CHANNEL = arg('channel', 'all-klennyspace');
const WAIT_SECONDS = Number(arg('wait', '75'));
const RETRIES = 3;
const RETRY_GAP_MS = 30_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function userToken() {
  if (process.env.SLACK_USER_TOKEN) return process.env.SLACK_USER_TOKEN.trim();
  if (!existsSync('SlackTokens.txt')) throw new Error('Set SLACK_USER_TOKEN or provide SlackTokens.txt');
  const line = readFileSync('SlackTokens.txt', 'utf8')
    .split(/\r?\n/)
    .find((entry) => /^user\s+[0o]auth\s+token\s*:/i.test(entry.trim()));
  const value = line ? line.slice(line.indexOf(':') + 1).trim() : '';
  if (!value.startsWith('xoxp-')) throw new Error('No Slack user token (xoxp-) found in SlackTokens.txt');
  return value;
}

async function request(pathname, { token, method = 'GET', body } = {}) {
  const response = await fetch(`${API}${pathname}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${pathname} -> ${response.status}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

async function postAsUser(text) {
  const response = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8', authorization: `Bearer ${userToken()}` },
    body: JSON.stringify({ channel: CHANNEL, text }),
  });
  const result = await response.json();
  if (result.error === 'missing_scope') {
    throw new Error(
      'the Slack user token lacks chat:write. Post the message in Slack by hand, then re-run with --code <n> --wait 0',
    );
  }
  if (!result.ok) throw new Error(`chat.postMessage failed: ${result.error}`);
  return result;
}

async function main() {
  const manualCode = arg('code', null);
  const code = manualCode ?? String(1000 + Math.floor(Math.random() * 9000));
  if (manualCode) {
    console.log(`checking a hand-posted message with door code ${code}; waiting ${WAIT_SECONDS}s`);
  } else {
    const fact = `Facilities update: the door code for the Oakland HQ demo room is now ${code}, effective today. The old code is retired.`;
    const posted = await postAsUser(fact);
    console.log(`posted to #${CHANNEL} (ts ${posted.ts}) with door code ${code}; waiting ${WAIT_SECONDS}s for indexing`);
  }
  await sleep(WAIT_SECONDS * 1000);

  const { accessToken } = await request('/api/auth/login', {
    method: 'POST',
    body: { email: 'elena@northwind.dev', password: PASSWORD },
  });
  const orgs = await request('/api/organizations/user', { token: accessToken });
  const list = (Array.isArray(orgs) ? orgs : (orgs?.organizations ?? orgs?.items ?? [])).map((e) => e.organization ?? e);
  const org = list.find((entry) => entry.slug === 'northwind') ?? list[0];
  if (!org) throw new Error('Organization northwind not found');

  const question = 'What was the latest facilities update posted in Slack about the Oakland HQ demo room?';
  for (let attempt = 1; attempt <= RETRIES; attempt += 1) {
    const started = Date.now();
    const result = await request(`/api/organizations/${org.id}/ask`, {
      token: accessToken,
      method: 'POST',
      body: { question },
    });
    const answer = (result.answer ?? '').replace(/\s+/g, ' ');
    const live = (result.citations ?? []).filter((citation) => String(citation.hydraId).startsWith('slack-live-'));
    console.log(`attempt ${attempt} (${((Date.now() - started) / 1000).toFixed(1)}s): live citations=${live.length}`);
    if (answer.includes(code)) {
      console.log(`PASS: the brain answered with the live Slack fact ${code}`);
      for (const citation of live) console.log(`  [${citation.n}] ${citation.title}`);
      console.log(`  answer: ${answer.slice(0, 300)}`);
      return;
    }
    console.log(`  not yet: ${answer.slice(0, 200)}`);
    if (attempt < RETRIES) await sleep(RETRY_GAP_MS);
  }
  throw new Error(`the brain never returned door code ${code}`);
}

main().catch((error) => {
  console.error(`slack-live-check failed: ${error.message}`);
  process.exitCode = 1;
});
