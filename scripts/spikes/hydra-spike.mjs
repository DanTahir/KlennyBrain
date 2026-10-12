#!/usr/bin/env node
/**
 * HydraDB spike: provisions a throwaway `brain_spike` database, ingests a few
 * app_knowledge items (with relations + ACL), measures indexing latency, and
 * probes query / graphContext / subgraph / relations / ACL behaviour.
 *
 * Usage: node scripts/spikes/hydra-spike.mjs [--skip-ingest]
 * Never touches the `default-tenant` database. Never prints the API key.
 */
import { apiRequire, describeError, loadApiEnv, sleep } from './_env.mjs';

const env = loadApiEnv();
if (!env.HYDRA_DB_API_KEY) {
  console.error('HYDRA_DB_API_KEY missing in apps/api/.env');
  process.exit(1);
}

const sdk = apiRequire('@hydradb/sdk');
const { HydraDBClient } = sdk;
const client = new HydraDBClient({ token: env.HYDRA_DB_API_KEY, timeoutInSeconds: 120, maxRetries: 2 });

const database = 'brain_spike';
const collection = 'default';
const skipIngest = process.argv.includes('--skip-ingest');
const unwrap = (r) => (r && typeof r === 'object' && 'data' in r ? r.data : r);
const log = (label, value) => console.log(`\n=== ${label} ===\n${typeof value === 'string' ? value : JSON.stringify(value, null, 2)}`);

const schema = ['source_system', 'channel', 'department', 'project', 'author', 'doc_type'].map((name) => ({
  name,
  dataType: 'VARCHAR',
  enableMatch: true,
  maxLength: 128,
}));

async function ensureDatabase() {
  try {
    const status = unwrap(await client.databases.status({ database }));
    log('database exists, status', status);
    if (status?.infra?.readyForIngestion) return;
  } catch (e) {
    log('status (expected 404 if new)', describeError(e));
    const t0 = Date.now();
    try {
      const created = unwrap(await client.databases.create({ database, databaseMetadataSchema: schema }));
      log('create', created);
    } catch (ce) {
      log('create FAILED', describeError(ce));
      throw ce;
    }
    for (let i = 0; i < 60; i++) {
      await sleep(3000);
      try {
        const s = unwrap(await client.databases.status({ database }));
        if (s?.infra?.readyForIngestion) {
          log(`ready for ingestion after ${Date.now() - t0}ms`, s);
          return;
        }
      } catch (pe) {
        console.log('poll error', describeError(pe).message);
      }
    }
    throw new Error('database not ready after 3 minutes');
  }
}

const P = 'spike';
const items = [
  {
    id: 'spike-doc-refund',
    title: 'Refund Policy',
    kind: 'knowledge_base',
    provider: P,
    external_id: 'doc-refund',
    url: 'https://example.dev/docs/refund-policy',
    timestamp: '2026-05-01T10:00:00Z',
    fields: {
      kind: 'knowledge_base',
      body: 'Northwind Robotics refund policy: customers may request a full refund within 14 days of delivery. Owner: Priya Shah (Support).',
      author: 'priya@northwind.dev',
    },
    metadata: { source_system: 'doc', department: 'support', doc_type: 'policy', author: 'priya@northwind.dev' },
    additional_metadata: { people: ['priya@northwind.dev'] },
  },
  {
    id: 'spike-slack-refund',
    title: '#support message',
    kind: 'message',
    provider: P,
    external_id: 'slack-support-1',
    url: 'https://example.dev/slack/support/1',
    timestamp: '2026-09-20T16:00:00Z',
    fields: {
      kind: 'message',
      body: 'Reminder team: since the August policy review, the refund window is 30 days, not 14. Please use the updated macro.',
      author: 'marco@northwind.dev',
      thread_id: 'support-t1',
    },
    metadata: { source_system: 'slack', channel: 'support', department: 'support', author: 'marco@northwind.dev' },
  },
  {
    id: 'spike-ticket-212',
    title: 'ATL-212: SSO via Okta for Atlas',
    kind: 'ticket',
    provider: P,
    external_id: 'ATL-212',
    url: 'https://example.dev/issues/ATL-212',
    timestamp: '2026-09-28T09:00:00Z',
    fields: {
      kind: 'ticket',
      body: 'SSO login for Project Atlas. Blocked: waiting on AuthCo to enable SAML metadata endpoint. Assignee: Devon Lee. Launch moved from Sep 30 to Oct 14 because of this.',
      author: 'devon@northwind.dev',
      status: 'blocked',
    },
    metadata: { source_system: 'ticket', project: 'atlas', department: 'engineering', author: 'devon@northwind.dev' },
    relations: [{ predicate: 'blocks', target: { external_id: 'atlas-launch', provider: P } }],
  },
  {
    id: 'spike-doc-atlas',
    title: 'Project Atlas launch plan',
    kind: 'knowledge_base',
    provider: P,
    external_id: 'atlas-launch',
    url: 'https://example.dev/docs/atlas-launch',
    timestamp: '2026-09-01T09:00:00Z',
    fields: {
      kind: 'knowledge_base',
      body: 'Project Atlas is the Northwind fleet-management launch. Requires SSO (ATL-212) for enterprise customer Globex. Launch owner: Sam Rivera.',
      author: 'sam@northwind.dev',
    },
    metadata: { source_system: 'doc', project: 'atlas', department: 'product', doc_type: 'plan', author: 'sam@northwind.dev' },
  },
  {
    id: 'spike-leadership-comp',
    title: '#leadership message',
    kind: 'message',
    provider: P,
    external_id: 'slack-leadership-1',
    url: 'https://example.dev/slack/leadership/1',
    timestamp: '2026-10-01T18:00:00Z',
    fields: {
      kind: 'message',
      body: 'Confidential: Q4 reorg will merge the Support and Success teams under Ana Gomez; comp bands move up 6%.',
      author: 'ceo@northwind.dev',
    },
    metadata: { source_system: 'slack', channel: 'leadership', department: 'exec', author: 'ceo@northwind.dev' },
    acl: ['group:slack:leadership'],
  },
];

async function ingest() {
  const t0 = Date.now();
  const res = unwrap(
    await client.context.ingest({
      database,
      collection,
      type: 'knowledge',
      appKnowledge: JSON.stringify(items.map((i) => ({ ...i, database, collection }))),
      upsert: 'true',
    }),
  );
  log(`ingest response (${Date.now() - t0}ms)`, res);
  const ids = (res?.results ?? []).map((r) => r.id).filter(Boolean);
  const pollIds = ids.length ? ids : items.map((i) => i.id);
  const firstSeen = {};
  for (let i = 0; i < 100; i++) {
    await sleep(5000);
    let statuses = [];
    try {
      statuses = unwrap(await client.context.status({ database, collection, ids: pollIds }))?.statuses ?? [];
    } catch (e) {
      console.log('status error', describeError(e));
      continue;
    }
    const elapsed = Date.now() - t0;
    for (const s of statuses) {
      const key = `${s.indexingStatus}`;
      firstSeen[key] ??= elapsed;
    }
    const summary = statuses.map((s) => s.indexingStatus).join(',');
    console.log(`t+${Math.round(elapsed / 1000)}s ${summary}`);
    if (statuses.length && statuses.every((s) => ['completed', 'errored'].includes(s.indexingStatus))) break;
  }
  log('first time each status was seen (ms)', firstSeen);
}

function summarizeQuery(label, data, ms) {
  if (typeof data === 'string') return log(`${label} (${ms}ms) string`, data.slice(0, 500));
  const chunks = data?.chunks ?? [];
  const paths = data?.graphContext?.queryPaths ?? [];
  log(`${label} (${ms}ms)`, {
    chunkCount: chunks.length,
    chunks: chunks.slice(0, 6).map((c) => ({
      id: c.id,
      title: c.sourceTitle,
      score: c.relevancyScore,
      text: String(c.chunkContent ?? '').slice(0, 90),
    })),
    sources: (data?.sources ?? []).slice(0, 6).map((s) => ({ id: s.id, title: s.title, kind: s.appKind, url: s.url })),
    queryPathCount: paths.length,
    samplePaths: paths.slice(0, 3).map((p) =>
      (p.triplets ?? []).map((t) => `${t.source?.name} -[${t.relation?.canonical_predicate}]-> ${t.target?.name}`),
    ),
    chunkRelationsCount: (data?.graphContext?.chunkRelations ?? []).length,
    topLevelKeys: Object.keys(data ?? {}),
  });
}

async function query(label, q, extra = {}) {
  const t0 = Date.now();
  try {
    const r = await client.query({
      database,
      collection,
      query: q,
      type: 'knowledge',
      mode: 'fast',
      queryApps: true,
      graphContext: true,
      maxResults: 8,
      ...extra,
    });
    summarizeQuery(label, unwrap(r), Date.now() - t0);
    return r;
  } catch (e) {
    log(`${label} FAILED (${Date.now() - t0}ms)`, describeError(e));
    return null;
  }
}

async function main() {
  await ensureDatabase();
  if (!skipIngest) await ingest();

  const raw = await query('refund, no acl', 'What is our refund window?');
  console.log('\nraw response keys:', Object.keys(raw ?? {}), 'meta:', JSON.stringify(raw?.meta ?? null));
  await query('refund, thinking mode', 'What is our refund window?', { mode: 'thinking' });
  await query('blocker, no acl', 'What is blocking the Atlas launch?');
  await query('reorg as intern acl', 'What is the Q4 reorg plan?', { acl: ['intern@northwind.dev'] });
  await query('reorg as leadership acl', 'What is the Q4 reorg plan?', {
    acl: ['ceo@northwind.dev', 'group:slack:leadership'],
  });
  await query('reorg, no acl', 'What is the Q4 reorg plan?');

  try {
    const sg = unwrap(await client.context.subgraph({ id: 'spike-ticket-212', database, collection, depth: 2, maxSources: 10 }));
    log('subgraph(spike-ticket-212)', JSON.stringify(sg).slice(0, 2000));
  } catch (e) {
    log('subgraph FAILED', describeError(e));
  }
  try {
    const rel = unwrap(await client.context.relations({ database, id: 'spike-ticket-212', limit: 20 }));
    log('relations(spike-ticket-212)', JSON.stringify(rel).slice(0, 2000));
  } catch (e) {
    log('relations FAILED', describeError(e));
  }
}

main().catch((e) => {
  log('SPIKE FAILED', describeError(e));
  process.exit(1);
});
