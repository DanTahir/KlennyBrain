import type { KnowledgeKind, SourceSystem } from '@app-starter/shared';

export interface NormalizedRelation {
  predicate: string;
  targetExternalId: string;
  /** Defaults to the record's own provider. */
  targetProvider?: string;
}

/**
 * Source-agnostic record produced by a SourceAdapter. The app_knowledge mapper
 * turns it into a HydraDB item; the ingestion service mirrors it in Postgres.
 */
export interface NormalizedRecord {
  externalId: string;
  provider: string;
  kind: KnowledgeKind;
  sourceSystem: SourceSystem;
  title: string;
  body: string;
  url?: string | null;
  authorEmail?: string | null;
  occurredAt: string;
  /** null/empty = visible to the whole organization. */
  acl?: string[] | null;
  metadata: {
    channel?: string | null;
    department?: string | null;
    project?: string | null;
    docType?: string | null;
  };
  threadId?: string | null;
  replyToId?: string | null;
  people?: string[];
  relations?: NormalizedRelation[];
  /** Extra typed fields for HydraDB (`fields`). */
  fields?: Record<string, unknown>;
  /** Extra context for HydraDB `additional_metadata`. */
  extra?: Record<string, unknown>;
}
