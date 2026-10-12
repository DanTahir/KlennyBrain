import type { SourceType } from '@app-starter/shared';
import { NormalizedRecord } from './normalized-record';

export interface SourceAdapterContext {
  organizationId: string;
  /** Non-secret per-source configuration from `Source.config`. */
  config: Record<string, unknown>;
}

/**
 * A connector that pulls records from one system. New sources (Gmail, Drive,
 * Notion, GitHub...) only need to implement this interface.
 */
export interface SourceAdapter {
  readonly type: SourceType;
  fetch(context: SourceAdapterContext): Promise<NormalizedRecord[]>;
}
