// Shared helpers for spike scripts: load apps/api/.env without printing values,
// and resolve packages installed in apps/api.
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export function loadApiEnv() {
  const path = join(root, 'apps', 'api', '.env');
  const env = {};
  if (!existsSync(path)) return env;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    env[m[1]] = m[2].trim().replace(/^"(.*)"$/, '$1');
  }
  return { ...env, ...Object.fromEntries(Object.entries(process.env).filter(([k]) => k in env && process.env[k])) };
}

export const apiRequire = createRequire(join(root, 'apps', 'api', 'package.json'));

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const describeError = (e) => ({
  name: e?.name,
  message: e?.message,
  statusCode: e?.statusCode ?? e?.status,
  body: e?.body ?? e?.error,
});
