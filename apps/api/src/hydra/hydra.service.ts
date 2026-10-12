// HydraDB responses are parsed defensively (`any`), since envelope shapes vary by endpoint.
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HydraDBClient } from '@hydradb/sdk';
import type { GraphPath } from '@app-starter/shared';
import {
  HydraAppKnowledgeItem,
  HydraIngestResult,
  HydraNotConfiguredError,
  HydraSearchHit,
  HydraSearchMode,
  HydraSearchOptions,
  HydraSearchResult,
  HydraSubgraphResult,
  MissingAclError,
} from './hydra.types';

/** Declared metadata schema for every brain database (`source_type` is reserved by HydraDB). */
export const BRAIN_METADATA_FIELDS = [
  'source_system',
  'channel',
  'department',
  'project',
  'author',
  'doc_type',
] as const;

/** Indexing states in which an item is already returned by search. */
export const SEARCHABLE_STATUSES = new Set(['graph_creation', 'completed']);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** SDK calls return either the envelope `{ success, data, meta }` or the payload itself. */
function unwrap(response: any): any {
  if (response && typeof response === 'object' && 'data' in response && response.data !== undefined) {
    return response.data;
  }
  return response;
}

function tripletToPath(triplet: any): GraphPath | null {
  const source = triplet?.source?.name ?? triplet?.source?.identifier;
  const target = triplet?.target?.name ?? triplet?.target?.identifier;
  if (!source || !target) return null;
  const relation = triplet?.relation ?? (Array.isArray(triplet?.relations) ? triplet.relations[0] : undefined);
  const predicate =
    relation?.canonical_predicate ??
    relation?.canonicalPredicate ??
    relation?.raw_predicate ??
    relation?.rawPredicate ??
    'related_to';
  const path: GraphPath = { source: String(source), predicate: String(predicate), target: String(target) };
  if (triplet?.source?.type) path.sourceType = String(triplet.source.type);
  if (triplet?.target?.type) path.targetType = String(triplet.target.type);
  if (triplet?.chunkId) path.evidence = [String(triplet.chunkId)];
  return path;
}

export function dedupePaths(paths: GraphPath[]): GraphPath[] {
  const seen = new Map<string, GraphPath>();
  for (const path of paths) {
    const key = `${path.source}|${path.predicate}|${path.target}`.toLowerCase();
    if (!seen.has(key)) seen.set(key, path);
  }
  return [...seen.values()];
}

@Injectable()
export class HydraService {
  private readonly logger = new Logger(HydraService.name);
  private client: HydraDBClient | null = null;

  constructor(private readonly config: ConfigService) {}

  /** `brain_<slug>` with underscores, as required by HydraDB database names. */
  static databaseNameFor(orgSlug: string): string {
    const slug = orgSlug
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
    return `brain_${slug || 'org'}`.slice(0, 60);
  }

  isConfigured(): boolean {
    return Boolean(this.config.get<string>('HYDRA_DB_API_KEY'));
  }

  private getClient(): HydraDBClient {
    if (!this.client) {
      const token = this.config.get<string>('HYDRA_DB_API_KEY');
      if (!token) throw new HydraNotConfiguredError();
      this.client = new HydraDBClient({ token, timeoutInSeconds: 60, maxRetries: 2 });
    }
    return this.client;
  }

  /** true = ready, false = exists but still provisioning, null = does not exist. */
  async databaseReady(database: string): Promise<boolean | null> {
    try {
      const status = unwrap(await this.getClient().databases.status({ database } as any));
      return Boolean(status?.infra?.readyForIngestion);
    } catch (error) {
      const code = (error as { statusCode?: number })?.statusCode;
      if (typeof code === 'number' && code >= 400 && code < 500) return null;
      throw error;
    }
  }

  async ensureDatabase(database: string, timeoutMs = 180_000): Promise<void> {
    const ready = await this.databaseReady(database);
    if (ready) return;
    if (ready === null) {
      this.logger.log(`Creating HydraDB database ${database}`);
      await this.getClient().databases.create({
        database,
        databaseMetadataSchema: BRAIN_METADATA_FIELDS.map((name) => ({
          name,
          dataType: 'VARCHAR',
          enableMatch: true,
          maxLength: 128,
        })),
      } as any);
    }
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await sleep(3000);
      try {
        if (await this.databaseReady(database)) return;
      } catch (error) {
        this.logger.warn(`Polling ${database} status failed: ${(error as Error).message}`);
      }
    }
    throw new Error(`HydraDB database ${database} was not ready after ${Math.round(timeoutMs / 1000)}s`);
  }

  async ingest(database: string, collection: string, items: HydraAppKnowledgeItem[]): Promise<HydraIngestResult> {
    if (items.length === 0) return { accepted: [], failed: [] };
    const response = unwrap(
      await this.getClient().context.ingest({
        database,
        collection,
        type: 'knowledge',
        appKnowledge: JSON.stringify(items.map((item) => ({ ...item, database, collection }))),
        upsert: 'true',
      } as any),
    );
    const results: any[] = Array.isArray(response?.results) ? response.results : [];
    if (results.length === 0) return { accepted: items.map((item) => item.id), failed: [] };

    const accepted: string[] = [];
    const failed: { id: string; error: string }[] = [];
    results.forEach((result, index) => {
      const id = String(result?.id ?? result?.sourceId ?? items[index]?.id ?? '');
      const error = result?.error ?? (result?.success === false ? (result?.message ?? 'rejected') : null);
      if (error) failed.push({ id, error: String(error) });
      else if (id) accepted.push(id);
    });
    return { accepted, failed };
  }

  /** Map of hydraId -> indexing status (queued, processing, graph_creation, completed, errored). */
  async indexingStatuses(database: string, collection: string, ids: string[]): Promise<Map<string, string>> {
    const statuses = new Map<string, string>();
    for (let offset = 0; offset < ids.length; offset += 50) {
      const chunk = ids.slice(offset, offset + 50);
      const response = unwrap(await this.getClient().context.status({ database, collection, ids: chunk } as any));
      const list: any[] = Array.isArray(response?.statuses) ? response.statuses : [];
      list.forEach((status, index) => {
        const id = String(status?.id ?? status?.sourceId ?? chunk[index]);
        statuses.set(id, String(status?.indexingStatus ?? status?.status ?? 'unknown'));
      });
    }
    return statuses;
  }

  /**
   * Hybrid search over the org's app knowledge. `acl` is mandatory: without it
   * HydraDB would return restricted items.
   */
  async search(options: HydraSearchOptions): Promise<HydraSearchResult> {
    const acl = Array.isArray(options.acl) ? options.acl.map((entry) => entry?.trim()).filter(Boolean) : [];
    if (acl.length === 0) throw new MissingAclError();

    const startedAt = Date.now();
    const buildRequest = (mode: HydraSearchMode) => ({
      database: options.database,
      collection: options.collection,
      query: options.query,
      type: 'knowledge',
      mode,
      queryApps: true,
      graphContext: options.graphContext ?? true,
      maxResults: options.maxResults ?? 10,
      acl,
      ...(options.metadataFilters && Object.keys(options.metadataFilters).length
        ? { metadataFilters: options.metadataFilters }
        : {}),
    });

    let mode: HydraSearchMode = options.mode ?? 'thinking';
    let raw: any;
    try {
      raw = await this.getClient().query(buildRequest(mode) as any, {
        timeoutInSeconds: mode === 'thinking' ? 20 : 15,
        maxRetries: 1,
      });
    } catch (error) {
      if (mode !== 'thinking') throw error;
      this.logger.warn(`Thinking-mode search failed (${(error as Error).message}); retrying in fast mode`);
      mode = 'fast';
      raw = await this.getClient().query(buildRequest(mode) as any, { timeoutInSeconds: 15, maxRetries: 1 });
    }

    const data = unwrap(raw) ?? {};
    const requestId: string | null = raw?.meta?.requestId ?? raw?.meta?.request_id ?? data?.requestId ?? null;

    const sourceInfo = new Map<string, any>();
    for (const source of Array.isArray(data?.sources) ? data.sources : []) {
      if (source?.id) sourceInfo.set(String(source.id), source);
    }

    const hits = new Map<string, HydraSearchHit>();
    for (const chunk of Array.isArray(data?.chunks) ? data.chunks : []) {
      const hydraId = String(chunk?.sourceId ?? chunk?.id ?? '');
      if (!hydraId) continue;
      const source = sourceInfo.get(hydraId);
      const text = String(chunk?.chunkContent ?? '');
      const score = typeof chunk?.relevancyScore === 'number' ? chunk.relevancyScore : null;
      const existing = hits.get(hydraId);
      if (existing) {
        if (existing.text.length < 2400 && text && !existing.text.includes(text)) existing.text += `\n...\n${text}`;
        if (score !== null && (existing.score ?? 0) < score) existing.score = score;
        continue;
      }
      hits.set(hydraId, {
        hydraId,
        title: String(chunk?.sourceTitle ?? source?.title ?? hydraId),
        kind: source?.appKind ?? (chunk?.metadata?.kind as string | undefined) ?? null,
        url: source?.url ?? null,
        score,
        text,
        metadata: chunk?.metadata ?? source?.metadata ?? {},
        additionalMetadata: chunk?.additionalMetadata ?? {},
      });
    }

    const graph = data?.graphContext ?? {};
    const scoredPaths: any[] = [
      ...(Array.isArray(graph?.queryPaths) ? graph.queryPaths : []),
      ...(Array.isArray(graph?.chunkRelations) ? graph.chunkRelations : []),
    ];
    const paths = dedupePaths(
      scoredPaths
        .flatMap((path) => (Array.isArray(path?.triplets) ? path.triplets : []))
        .map(tripletToPath)
        .filter((path): path is GraphPath => path !== null),
    ).slice(0, 40);

    return {
      hits: [...hits.values()].sort((a, b) => (b.score ?? 0) - (a.score ?? 0)),
      paths,
      requestId,
      mode,
      durationMs: Date.now() - startedAt,
    };
  }

  /** Knowledge-graph neighbourhood of one item: linked sources plus entity triplets. */
  async subgraph(
    database: string,
    collection: string,
    hydraId: string,
    depth = 2,
    maxSources = 12,
  ): Promise<HydraSubgraphResult> {
    const data = unwrap(
      await this.getClient().context.subgraph({ id: hydraId, database, collection, depth, maxSources } as any),
    );
    const sources = (Array.isArray(data?.sources) ? data.sources : [])
      .map((source: any) => ({
        hydraId: String(source?.sourceId ?? ''),
        title: String(source?.title ?? source?.sourceId ?? ''),
        kind: source?.appKind ?? null,
        depth: Number(source?.depth ?? 0),
        discoveredRelation: source?.discoveredRelation ?? null,
      }))
      .filter((source: { hydraId: string }) => source.hydraId);
    const triplets: any[] = [
      ...(Array.isArray(data?.relations) ? data.relations : []),
      ...(Array.isArray(data?.auxiliaryRelations) ? data.auxiliaryRelations : []),
    ];
    const paths = dedupePaths(
      triplets.map(tripletToPath).filter((path): path is GraphPath => path !== null),
    ).slice(0, 60);
    return { sources, paths };
  }

  async submitFeedback(input: {
    database: string;
    collection: string;
    requestId: string;
    rating: 'positive' | 'negative';
    comment?: string;
    metadata?: Record<string, string>;
  }): Promise<void> {
    await this.getClient().feedback.submit({
      database: input.database,
      collection: input.collection,
      requestId: input.requestId,
      rating: input.rating,
      feedback:
        input.comment ||
        (input.rating === 'positive' ? 'User marked this answer as helpful' : 'User marked this answer as unhelpful'),
      source: 'user',
      metadata: input.metadata,
    } as any);
  }
}
