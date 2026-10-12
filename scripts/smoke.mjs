// End-to-end check of the golden questions in data/demo/GROUND_TRUTH.md
// against a running API (pnpm dev). Exits non-zero when any check fails.
//   node scripts/smoke.mjs                 # all questions
//   node scripts/smoke.mjs --only 3,5b     # a subset
//   SMOKE_API_URL=http://localhost:3001 node scripts/smoke.mjs
const API = (process.env.SMOKE_API_URL || 'http://localhost:3001').replace(/\/$/, '');
const PASSWORD = process.env.SMOKE_PASSWORD || 'Password123!';
const ORG_SLUG = process.env.SMOKE_ORG_SLUG || 'northwind';
const CONCURRENCY = Number(process.env.SMOKE_CONCURRENCY || 3);

const CASES = [
  { id: '1', as: 'elena', question: 'What is our refund window?', all: [/30[- ]days?/i, /14[- ]days?/i] },
  {
    id: '2',
    as: 'elena',
    question: 'When does Atlas launch and why did it move?',
    all: [/(oct(ober)?\.?\s*14|2026-10-14|10-14)/i, /ATL-212/i],
  },
  { id: '3', as: 'jordan', question: 'What is blocking the Atlas launch?', all: [/ATL-212/i, /KeyGate/i, /Globex/i] },
  { id: '4', as: 'marco', question: 'Who knows the billing service?', all: [/Mei Chen/i] },
  { id: '5a', as: 'elena', question: 'What is the Q4 reorg plan?', all: [/\bAna\b/i, /(Customer Experience|merg)/i] },
  {
    id: '5b',
    as: 'ollie',
    question: 'What is the Q4 reorg plan?',
    none: [/Ana Gomez/i, /\bmerg(e|ing|er)\b/i, /\b6 ?%/],
    allowNoCitations: true,
  },
  {
    id: '6',
    as: 'marco',
    question: "What are customers' most common support problems right now?",
    all: [/Wi-?Fi/i, /2\.8/, /FW-77/i],
  },
  { id: '7', as: 'elena', question: 'What action items are overdue?', all: [/Priya/i, /Devon/i, /Lena/i] },
];

const only = (() => {
  const index = process.argv.indexOf('--only');
  return index > -1 ? new Set(process.argv[index + 1].split(',')) : null;
})();

async function request(path, { token, method = 'GET', body } = {}) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!response.ok) throw new Error(`${method} ${path} -> ${response.status}: ${text.slice(0, 200)}`);
  return json;
}

const tokens = new Map();
async function tokenFor(user) {
  if (!tokens.has(user)) {
    const data = await request('/api/auth/login', {
      method: 'POST',
      body: { email: `${user}@northwind.dev`, password: PASSWORD },
    });
    tokens.set(user, data.accessToken);
  }
  return tokens.get(user);
}

async function organizationId() {
  const token = await tokenFor('elena');
  const data = await request('/api/organizations/user', { token });
  const list = (Array.isArray(data) ? data : (data?.organizations ?? data?.items ?? [])).map(
    (entry) => entry.organization ?? entry,
  );
  const org = list.find((entry) => entry.slug === ORG_SLUG) ?? list[0];
  if (!org) throw new Error(`Organization ${ORG_SLUG} not found`);
  return org.id;
}

async function runCase(orgId, testCase) {
  const started = Date.now();
  const failures = [];
  let result = null;
  try {
    const token = await tokenFor(testCase.as);
    result = await request(`/api/organizations/${orgId}/ask`, {
      token,
      method: 'POST',
      body: { question: testCase.question },
    });
    const answer = result.answer ?? '';
    for (const pattern of testCase.all ?? []) if (!pattern.test(answer)) failures.push(`missing ${pattern}`);
    for (const pattern of testCase.none ?? []) if (pattern.test(answer)) failures.push(`LEAKED ${pattern}`);
    if (!testCase.allowNoCitations && !(result.citations?.length > 0)) failures.push('no citations');
  } catch (error) {
    failures.push(error.message);
  }
  return { testCase, result, failures, ms: Date.now() - started };
}

async function main() {
  const orgId = await organizationId();
  const cases = CASES.filter((testCase) => !only || only.has(testCase.id));
  console.log(`Smoke: ${cases.length} golden questions against ${API} (org ${orgId})\n`);

  const results = [];
  for (let index = 0; index < cases.length; index += CONCURRENCY) {
    const batch = cases.slice(index, index + CONCURRENCY);
    results.push(...(await Promise.all(batch.map((testCase) => runCase(orgId, testCase)))));
  }

  for (const { testCase, result, failures, ms } of results) {
    const status = failures.length ? 'FAIL' : 'PASS';
    const tools = (result?.toolTrace ?? []).map((call) => call.name).join(', ');
    console.log(`[${status}] Q${testCase.id} as ${testCase.as}: ${testCase.question} (${(ms / 1000).toFixed(1)}s)`);
    console.log(`       citations=${result?.citations?.length ?? 0} graph=${result?.graphPaths?.length ?? 0} tools=[${tools}]`);
    if (failures.length) {
      console.log(`       ${failures.join('; ')}`);
      console.log(`       answer: ${(result?.answer ?? '').replace(/\s+/g, ' ').slice(0, 400)}`);
    }
  }
  const failed = results.filter((entry) => entry.failures.length).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  if (failed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
