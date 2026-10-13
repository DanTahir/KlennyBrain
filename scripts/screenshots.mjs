// Captures the README screenshots into docs/screenshots/ with the Playwright CLI.
// Logs in as elena, hands the session to Playwright through a temporary storage
// state file (deleted afterwards), and screenshots Home, Ask (with a live answer),
// Insights and Actions. Requires `pnpm dev`.
//   node scripts/screenshots.mjs [--only home,ask]
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const API = (process.env.SMOKE_API_URL || 'http://localhost:3001').replace(/\/$/, '');
const WEB = (process.env.WEB_URL || 'http://localhost:3000').replace(/\/$/, '');
const PLAYWRIGHT = process.env.PLAYWRIGHT_PACKAGE || 'playwright@latest';
const TOKEN_KEY = 'app_starter_access_token';
const OUT_DIR = path.resolve('docs/screenshots');

const only = (() => {
  const index = process.argv.indexOf('--only');
  return index > -1 ? new Set(process.argv[index + 1].split(',')) : null;
})();

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

async function main() {
  const { accessToken } = await request('/api/auth/login', {
    method: 'POST',
    body: { email: 'elena@northwind.dev', password: process.env.SMOKE_PASSWORD || 'Password123!' },
  });
  const orgs = await request('/api/organizations/user', { token: accessToken });
  const list = (Array.isArray(orgs) ? orgs : (orgs?.organizations ?? orgs?.items ?? [])).map((e) => e.organization ?? e);
  const org = list.find((entry) => entry.slug === 'northwind') ?? list[0];
  if (!org) throw new Error('Organization northwind not found');

  const tmp = mkdtempSync(path.join(os.tmpdir(), 'klennybrain-shots-'));
  const statePath = path.join(tmp, 'state.json');
  writeFileSync(
    statePath,
    JSON.stringify({
      cookies: [
        { name: TOKEN_KEY, value: accessToken, domain: 'localhost', path: '/', expires: -1, httpOnly: false, secure: false, sameSite: 'Lax' },
      ],
      origins: [{ origin: WEB, localStorage: [{ name: TOKEN_KEY, value: accessToken }] }],
    }),
  );

  const base = `${WEB}/organizations/${org.id}`;
  const shots = [
    { name: 'home', url: base, waitMs: 8000, fullPage: true },
    { name: 'ask', url: `${base}/ask?q=${encodeURIComponent('What is blocking the Atlas launch?')}`, waitMs: 75000, fullPage: true },
    { name: 'insights', url: `${base}/insights`, waitMs: 8000, fullPage: false },
    { name: 'actions', url: `${base}/actions`, waitMs: 8000, fullPage: false },
  ].filter((shot) => !only || only.has(shot.name));

  mkdirSync(OUT_DIR, { recursive: true });
  try {
    for (const shot of shots) {
      const out = path.join(OUT_DIR, `${shot.name}.png`);
      console.log(`capturing ${shot.name} (waiting ${shot.waitMs / 1000}s)`);
      execFileSync(
        'npx',
        [
          '-y',
          PLAYWRIGHT,
          'screenshot',
          '--browser=chromium',
          `--load-storage=${statePath}`,
          '--viewport-size=1440,900',
          `--wait-for-timeout=${shot.waitMs}`,
          ...(shot.fullPage ? ['--full-page'] : []),
          shot.url,
          out,
        ],
        { stdio: 'inherit', shell: process.platform === 'win32' },
      );
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`screenshots failed: ${error.message}`);
  process.exitCode = 1;
});
