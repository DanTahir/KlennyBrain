#!/usr/bin/env node
/**
 * Creates local env files from their committed examples and fills in secrets
 * from local, gitignored sources. Secret values are never printed.
 *
 * Secret sources (first match wins):
 *   1. Variables already present in the target env file (never overwritten
 *      unless --force is passed)
 *   2. Process environment (HYDRA_DB_API_KEY, OPENROUTER_API_KEY, SLACK_*, GITHUB_TOKEN)
 *   3. Root key files: HydraDBkey.txt, OpenRouterKey.txt, SlackTokens.txt
 *   4. `gh auth token` for GITHUB_TOKEN
 *
 * Usage: node scripts/init-env.mjs [--force]
 */
import { execSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const force = process.argv.includes('--force');

const rel = (p) => join(root, p);
const readIfExists = (p) => (existsSync(rel(p)) ? readFileSync(rel(p), 'utf8') : null);

const copyEnv = (example, target) => {
  if (existsSync(rel(target))) {
    console.log(`= ${target} exists, keeping it`);
    return;
  }
  copyFileSync(rel(example), rel(target));
  console.log(`+ created ${target}`);
};

const firstLine = (text) =>
  text
    ?.split(/\r?\n/)
    .map((l) => l.trim())
    .find(Boolean) ?? null;

const parseSlackTokens = (text) => {
  const result = {};
  if (!text) return result;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const idx = line.indexOf(':');
    const label = idx >= 0 ? line.slice(0, idx).trim().toLowerCase() : '';
    const value = (idx >= 0 ? line.slice(idx + 1) : line).trim();
    if (!value) continue;
    if (value.startsWith('xapp-')) result.SLACK_APP_TOKEN = value;
    else if (value.startsWith('xoxb-')) result.SLACK_BOT_TOKEN = value;
    else if (value.startsWith('xoxp-')) result.SLACK_USER_TOKEN = value;
    else if (label.includes('signing')) result.SLACK_SIGNING_SECRET = value;
    else if (label.includes('client id')) result.SLACK_CLIENT_ID = value;
    else if (label.includes('client secret')) result.SLACK_CLIENT_SECRET = value;
  }
  return result;
};

const ghToken = () => {
  try {
    return execSync('gh auth token', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return null;
  }
};

const getEnvValue = (content, key) => {
  const match = content.match(new RegExp(`^${key}=(.*)$`, 'm'));
  return match ? match[1].trim() : null;
};

const setEnvValue = (content, key, value) => {
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^#?\\s*${key}=.*$`, 'm');
  if (pattern.test(content)) return content.replace(pattern, line);
  return `${content.replace(/\s*$/, '')}\n${line}\n`;
};

const fillEnvFile = (target, values) => {
  let content = readFileSync(rel(target), 'utf8');
  for (const [key, value] of Object.entries(values)) {
    if (!value) {
      console.log(`  - ${key}: no source found, left as-is`);
      continue;
    }
    const existing = getEnvValue(content, key);
    if (existing && !force) {
      console.log(`  = ${key}: already set (len ${existing.length})`);
      continue;
    }
    content = setEnvValue(content, key, value);
    console.log(`  + ${key}: set (len ${String(value).length})`);
  }
  writeFileSync(rel(target), content);
};

copyEnv('.env.example', '.env');
copyEnv('apps/api/.env.example', 'apps/api/.env');
copyEnv('apps/api/.env.test.example', 'apps/api/.env.test');
copyEnv('apps/web/.env.example', 'apps/web/.env.local');

const slack = parseSlackTokens(readIfExists('SlackTokens.txt'));
const env = process.env;

const apiEnv = readFileSync(rel('apps/api/.env'), 'utf8');
const jwt = getEnvValue(apiEnv, 'JWT_SECRET');
const needsJwt = !jwt || jwt === 'your-secret-key-change-in-production';

console.log('apps/api/.env');
fillEnvFile('apps/api/.env', {
  JWT_SECRET: needsJwt ? randomBytes(32).toString('hex') : null,
  HYDRA_DB_API_KEY: env.HYDRA_DB_API_KEY || firstLine(readIfExists('HydraDBkey.txt')),
  OPENROUTER_API_KEY: env.OPENROUTER_API_KEY || firstLine(readIfExists('OpenRouterKey.txt')),
  SLACK_BOT_TOKEN: env.SLACK_BOT_TOKEN || slack.SLACK_BOT_TOKEN,
  SLACK_APP_TOKEN: env.SLACK_APP_TOKEN || slack.SLACK_APP_TOKEN,
  SLACK_SIGNING_SECRET: env.SLACK_SIGNING_SECRET || slack.SLACK_SIGNING_SECRET,
  SLACK_USER_TOKEN: env.SLACK_USER_TOKEN || slack.SLACK_USER_TOKEN,
  GITHUB_TOKEN: env.GITHUB_TOKEN || ghToken(),
});
console.log('Done. Secret values were not printed.');
