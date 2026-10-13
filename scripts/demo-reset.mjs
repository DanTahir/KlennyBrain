// Resets the Northwind demo to its "before" state so the fix-it flow can be shown again:
//   1. deletes the org's insights and agent actions (Postgres, via the docker container)
//   2. re-syncs the DEMO source, which re-upserts every item (restoring the stale 14-day
//      refund policy doc that an approved UPDATE_KNOWLEDGE_DOC action rewrote)
//   3. re-runs insight analysis (contradictions, stale docs, decisions, action items)
// Requires `pnpm dev` (API on :3001) and the app-starter-postgres container.
//   node scripts/demo-reset.mjs [--skip-analyze]
// GitHub issues and Slack messages created by earlier runs are left in place.
import { execFileSync } from 'node:child_process';

const API = (process.env.SMOKE_API_URL || 'http://localhost:3001').replace(/\/$/, '');
const PASSWORD = process.env.SMOKE_PASSWORD || 'Password123!';
const ORG_SLUG = process.env.SMOKE_ORG_SLUG || 'northwind';
const PG_CONTAINER = process.env.PG_CONTAINER || 'app-starter-postgres';
const skipAnalyze = process.argv.includes('--skip-analyze');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function request(path, { token, method = 'GET', body } = {}) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${path} -> ${response.status}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

function psql(sql) {
  return execFileSync('docker', ['exec', PG_CONTAINER, 'psql', '-U', 'app_starter', '-d', 'app_starter', '-Atc', sql], {
    encoding: 'utf8',
  }).trim();
}

async function main() {
  const { accessToken: token } = await request('/api/auth/login', {
    method: 'POST',
    body: { email: 'elena@northwind.dev', password: PASSWORD },
  });
  const orgs = await request('/api/organizations/user', { token });
  const list = (Array.isArray(orgs) ? orgs : (orgs?.organizations ?? orgs?.items ?? [])).map((e) => e.organization ?? e);
  const org = list.find((entry) => entry.slug === ORG_SLUG);
  if (!org) throw new Error(`Organization ${ORG_SLUG} not found`);
  if (!/^[0-9a-f-]{36}$/i.test(org.id)) throw new Error('Unexpected organization id format');
  const base = `/api/organizations/${org.id}`;

  // 1. Clear insights and actions.
  const actions = psql(`DELETE FROM agent_actions WHERE organization_id = '${org.id}' RETURNING id`);
  const insights = psql(`DELETE FROM insights WHERE organization_id = '${org.id}' RETURNING id`);
  console.log(`cleared ${actions ? actions.split('\n').length : 0} actions, ${insights ? insights.split('\n').length : 0} insights`);

  // 2. Re-sync the demo source.
  const sources = await request(`${base}/sources`, { token });
  const demo = sources.find((source) => source.type === 'DEMO');
  if (!demo) throw new Error('No DEMO source - load the demo company from the Sources page first');
  const job = await request(`${base}/sources/${demo.id}/sync`, { token, method: 'POST', body: {} });
  console.log(`demo re-sync started (job ${job.id})`);
  const syncStarted = Date.now();
  for (;;) {
    await sleep(5000);
    const jobs = await request(`${base}/sources/${demo.id}/jobs`, { token });
    const current = jobs.find((entry) => entry.id === job.id) ?? jobs[0];
    process.stdout.write(`\r  ${current.status} ${current.processed}/${current.total} (${Math.round((Date.now() - syncStarted) / 1000)}s)   `);
    if (current.status === 'SUCCEEDED') break;
    if (current.status === 'FAILED') throw new Error(`sync failed: ${current.error ?? 'unknown error'}`);
  }
  console.log('\ndemo re-sync done');

  if (skipAnalyze) return;

  // 3. Re-run insight analysis.
  await request(`${base}/insights/analyze`, { token, method: 'POST', body: {} });
  const analyzeStarted = Date.now();
  for (;;) {
    await sleep(5000);
    const analysis = await request(`${base}/insights/analysis`, { token });
    process.stdout.write(`\r  analysis ${analysis.status} (${Math.round((Date.now() - analyzeStarted) / 1000)}s)   `);
    const idleTooLong = analysis.status === 'IDLE' && Date.now() - analyzeStarted > 20000;
    if (analysis.status === 'SUCCEEDED' || idleTooLong) {
      console.log(`\nanalysis done: ${JSON.stringify(analysis.counts ?? {})}`);
      break;
    }
    if (analysis.status === 'FAILED') throw new Error(`analysis failed: ${analysis.error ?? 'unknown error'}`);
  }
}

main().catch((error) => {
  console.error(`demo reset failed: ${error.message}`);
  process.exitCode = 1;
});
