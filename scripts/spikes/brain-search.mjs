// Verifies the ingested Northwind brain: indexing status, ACL-scoped search and
// the chunk/source id shapes the HydraService parser relies on.
//   node scripts/spikes/brain-search.mjs [database]
import { apiRequire, describeError, loadApiEnv } from './_env.mjs';

const env = loadApiEnv();
const { HydraDBClient } = apiRequire('@hydradb/sdk');
const client = new HydraDBClient({ token: env.HYDRA_DB_API_KEY, timeoutInSeconds: 60, maxRetries: 1 });
const database = process.argv[2] || 'brain_northwind';
const collection = 'default';
const unwrap = (r) => (r && typeof r === 'object' && 'data' in r && r.data !== undefined ? r.data : r);

const ELENA = ['elena@northwind.dev', 'group:slack:leadership', 'group:dept:exec'];
const OLLIE = ['ollie@northwind.dev', 'group:dept:engineering'];

async function status() {
  const ids = [
    'docs-doc-refund-policy',
    'docs-doc-leadership-q4-reorg-plan',
    'linear-atl-212',
    'linear-atl-200',
    'zendesk-zd-1042',
  ];
  const res = unwrap(await client.context.status({ database, collection, ids }));
  const list = res?.statuses ?? [];
  console.log('status keys:', Object.keys(list[0] ?? {}).join(','));
  for (const s of list) {
    console.log('  ', s.id ?? s.sourceId, s.indexingStatus ?? s.status, s.errorCode ?? '', s.errorMessage ?? '');
  }
}

async function search(label, query, acl) {
  const started = Date.now();
  const raw = await client.query({
    database,
    collection,
    query,
    type: 'knowledge',
    mode: 'fast',
    queryApps: true,
    graphContext: true,
    maxResults: 8,
    acl,
  });
  const data = unwrap(raw);
  const chunks = data?.chunks ?? [];
  const sources = data?.sources ?? [];
  console.log(`\n== ${label}: "${query}" (${Date.now() - started}ms, requestId=${raw?.meta?.requestId ?? 'n/a'})`);
  console.log('chunk keys:', Object.keys(chunks[0] ?? {}).join(','));
  console.log('source keys:', Object.keys(sources[0] ?? {}).join(','));
  for (const c of chunks.slice(0, 8)) {
    console.log(`  chunk id=${c.id} sourceId=${c.sourceId ?? '-'} score=${c.relevancyScore?.toFixed?.(3)} title=${c.sourceTitle}`);
  }
  console.log('  source ids:', sources.slice(0, 8).map((s) => `${s.id}${s.url ? '' : '(no url)'}`).join(', '));
  const paths = data?.graphContext?.queryPaths ?? [];
  console.log(`  queryPaths=${paths.length} chunkRelations=${(data?.graphContext?.chunkRelations ?? []).length}`);
}

try {
  await status();
  await search('elena', 'Q4 reorg plan for customer experience', ELENA);
  await search('ollie', 'Q4 reorg plan for customer experience', OLLIE);
  await search('ollie', 'What is blocking the Atlas launch?', OLLIE);
} catch (error) {
  console.error('failed:', describeError(error));
  process.exitCode = 1;
}
