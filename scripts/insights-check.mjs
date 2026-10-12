// Live checks for insights + agent actions against a running API (pnpm dev).
//   node scripts/insights-check.mjs analyze            # run analysis as elena and wait
//   node scripts/insights-check.mjs list [user] [type] # list insights as a persona (default elena)
//   node scripts/insights-check.mjs fix <insightId>    # agent proposes remediation actions
//   node scripts/insights-check.mjs actions [user]     # action log
//   node scripts/insights-check.mjs approve <actionId> [user]
//   node scripts/insights-check.mjs reject <actionId> [user]
const API = (process.env.SMOKE_API_URL || 'http://localhost:3001').replace(/\/$/, '');
const PASSWORD = process.env.SMOKE_PASSWORD || 'Password123!';
const ORG_SLUG = process.env.SMOKE_ORG_SLUG || 'northwind';

async function request(path, { token, method = 'GET', body } = {}) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!response.ok) throw new Error(`${method} ${path} -> ${response.status}: ${text.slice(0, 300)}`);
  return json;
}

async function login(user) {
  const data = await request('/api/auth/login', {
    method: 'POST',
    body: { email: `${user}@northwind.dev`, password: PASSWORD },
  });
  return data.accessToken;
}

async function organizationId(token) {
  const data = await request('/api/organizations/user', { token });
  const list = (Array.isArray(data) ? data : (data?.organizations ?? data?.items ?? [])).map(
    (entry) => entry.organization ?? entry,
  );
  const org = list.find((entry) => entry.slug === ORG_SLUG) ?? list[0];
  if (!org) throw new Error(`Organization ${ORG_SLUG} not found`);
  return org.id;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function printInsight(insight) {
  const due = insight.dueAt ? ` due ${insight.dueAt.slice(0, 10)}` : '';
  console.log(`- [${insight.type}/${insight.severity}/${insight.status}] ${insight.title}${due}  (${insight.id})`);
  console.log(`    ${insight.summary.replace(/\n/g, '\n    ')}`);
  console.log(`    evidence: ${insight.evidence.map((c) => c.hydraId).join(', ')}`);
}

function printAction(action) {
  const result = action.result?.url ? ` -> ${action.result.url}` : '';
  const error = action.error ? ` !! ${action.error}` : '';
  console.log(`- [${action.type}/${action.status}] ${action.title}${result}${error}  (${action.id})`);
}

async function main() {
  const [command = 'list', arg1, arg2] = process.argv.slice(2);
  const user = ['list', 'actions'].includes(command) ? arg1 || 'elena' : arg2 || 'elena';
  const token = await login(user);
  const org = await organizationId(token);
  const base = `/api/organizations/${org}`;

  if (command === 'analyze') {
    let status = await request(`${base}/insights/analyze`, { token, method: 'POST' });
    const started = Date.now();
    while (status.status === 'RUNNING') {
      console.log(`[${Math.round((Date.now() - started) / 1000)}s] ${status.message ?? ''}`);
      await sleep(5000);
      status = await request(`${base}/insights/analysis`, { token });
    }
    console.log(JSON.stringify(status, null, 2));
    return;
  }
  if (command === 'list') {
    const query = arg2 ? `?type=${arg2}` : '';
    const insights = await request(`${base}/insights${query}`, { token });
    console.log(`${insights.length} insights visible to ${user}`);
    insights.forEach(printInsight);
    return;
  }
  if (command === 'fix') {
    const started = Date.now();
    const response = await request(`${base}/insights/${arg1}/fix`, { token, method: 'POST' });
    console.log(`Proposed in ${Math.round((Date.now() - started) / 1000)}s:`);
    response.actions.forEach((action) => {
      printAction(action);
      console.log(`    ${JSON.stringify(action.payload).slice(0, 400)}`);
    });
    return;
  }
  if (command === 'actions') {
    const actions = await request(`${base}/actions`, { token });
    actions.forEach(printAction);
    return;
  }
  if (command === 'approve' || command === 'reject') {
    const action = await request(`${base}/actions/${arg1}/${command}`, { token, method: 'POST' });
    printAction(action);
    console.log(JSON.stringify(action.result ?? {}, null, 2));
    return;
  }
  throw new Error(`Unknown command ${command}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
