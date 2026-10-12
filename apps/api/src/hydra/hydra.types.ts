import type { GraphPath } from '@app-starter/shared';

/** Explicit edge from one app_knowledge item to another (resolved by HydraDB). */
export interface HydraRelation {
  predicate: string;
  target: { external_id: string; provider: string };
}

/** One `app_knowledge` item as accepted by `context.ingest` (snake_case wire format). */
export interface HydraAppKnowledgeItem {
  id: string;
  title: string;
  kind: string;
  provider: string;
  external_id: string;
  url?: string;
  timestamp: string;
  fields: Record<string, unknown>;
  /** Only keys declared in the database metadata schema (see BRAIN_METADATA_FIELDS). */
  metadata: Record<string, string>;
  additional_metadata?: Record<string, unknown>;
  /** Omitted for org-public items. */
  acl?: string[];
  relations?: HydraRelation[];
}

export type HydraSearchMode = 'fast' | 'thinking';

export interface HydraSearchOptions {
  database: string;
  collection: string;
  query: string;
  /** Required and non-empty: HydraDB only enforces ACLs when one is sent. */
  acl: string[];
  mode?: HydraSearchMode;
  maxResults?: number;
  metadataFilters?: Record<string, string>;
  graphContext?: boolean;
}

export interface HydraSearchHit {
  hydraId: string;
  title: string;
  kind: string | null;
  url: string | null;
  score: number | null;
  text: string;
  metadata: Record<string, unknown>;
  additionalMetadata: Record<string, unknown>;
}

export interface HydraSearchResult {
  hits: HydraSearchHit[];
  paths: GraphPath[];
  requestId: string | null;
  mode: HydraSearchMode;
  durationMs: number;
}

export interface HydraSubgraphSource {
  hydraId: string;
  title: string;
  kind: string | null;
  depth: number;
  discoveredRelation: string | null;
}

export interface HydraSubgraphResult {
  sources: HydraSubgraphSource[];
  paths: GraphPath[];
}

export interface HydraIngestResult {
  accepted: string[];
  failed: { id: string; error: string }[];
}

export class HydraNotConfiguredError extends Error {
  constructor() {
    super('HydraDB is not configured (HYDRA_DB_API_KEY is empty)');
    this.name = 'HydraNotConfiguredError';
  }
}

export class MissingAclError extends Error {
  constructor() {
    super('HydraService.search requires a non-empty ACL; refusing to run an unrestricted query');
    this.name = 'MissingAclError';
  }
}
