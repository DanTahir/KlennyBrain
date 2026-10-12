// Dumps the raw HydraDB subgraph / relations response for one item so the
// HydraService parser can be checked against the real shape.
//   node scripts/spikes/subgraph-check.mjs [hydraId] [database]
import { apiRequire, describeError, loadApiEnv } from './_env.mjs';

const env = loadApiEnv();
const { HydraDBClient } = apiRequire('@hydradb/sdk');
const client = new HydraDBClient({ token: env.HYDRA_DB_API_KEY, timeoutInSeconds: 60, maxRetries: 1 });
const id = process.argv[2] || 'linear-atl-212';
const database = process.argv[3] || 'brain_northwind';
const collection = 'default';
const unwrap = (r) => (r && typeof r === 'object' && 'data' in r && r.data !== undefined ? r.data : r);
const short = (value) => JSON.stringify(value)?.slice(0, 1500);

async function main() {
  for (const depth of [1, 2]) {
    try {
      const raw = await client.context.subgraph({ id, database, collection, depth, maxSources: 12 });
      const data = unwrap(raw);
      console.log(`== subgraph depth=${depth} keys:`, Object.keys(data ?? {}).join(','));
      console.log('  sources:', (data?.sources ?? []).length, short((data?.sources ?? []).slice(0, 4)));
      console.log('  relations:', (data?.relations ?? []).length, short((data?.relations ?? []).slice(0, 2)));
      console.log('  auxiliaryRelations:', (data?.auxiliaryRelations ?? []).length, short((data?.auxiliaryRelations ?? []).slice(0, 2)));
    } catch (error) {
      console.log(`subgraph depth=${depth} failed:`, describeError(error));
    }
  }
  if (client.context.relations) {
    try {
      const raw = await client.context.relations({ id, database, collection });
      const data = unwrap(raw);
      console.log('== relations keys:', Object.keys(data ?? {}).join(','), short(data).slice(0, 1200));
    } catch (error) {
      console.log('relations failed:', describeError(error));
    }
  }
  const status = unwrap(await client.context.status({ database, collection, ids: [id, 'zendesk-zd-1042'] }));
  console.log('== status', short(status?.statuses));
}

main().catch((error) => {
  console.error(describeError(error));
  process.exitCode = 1;
});
