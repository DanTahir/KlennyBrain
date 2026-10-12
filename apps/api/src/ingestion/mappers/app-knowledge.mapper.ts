import { HydraAppKnowledgeItem } from '../../hydra/hydra.types';
import { NormalizedRecord } from '../normalized-record';

const MAX_METADATA_LENGTH = 128;
const MAX_TITLE_LENGTH = 250;

/** Stable, URL-safe HydraDB id: `<provider>-<externalId>`. */
export function hydraIdFor(provider: string, externalId: string): string {
  return `${provider}-${externalId}`
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Unique, trimmed ACL entries, or null when the item is org-public. */
export function normalizeAcl(acl: string[] | null | undefined): string[] | null {
  if (!acl || acl.length === 0) return null;
  const values = [...new Set(acl.map((entry) => entry?.trim()).filter((entry): entry is string => Boolean(entry)))];
  return values.length ? values : null;
}

function uniqueEmails(values: (string | null | undefined)[]): string[] {
  return [
    ...new Set(
      values
        .map((value) => value?.trim().toLowerCase())
        .filter((value): value is string => Boolean(value && value.includes('@'))),
    ),
  ];
}

export function toAppKnowledgeItem(record: NormalizedRecord): HydraAppKnowledgeItem {
  const metadata: Record<string, string> = {};
  const put = (key: string, value: string | null | undefined) => {
    const text = value?.toString().trim();
    if (text) metadata[key] = text.slice(0, MAX_METADATA_LENGTH);
  };
  put('source_system', record.sourceSystem);
  put('channel', record.metadata.channel);
  put('department', record.metadata.department);
  put('project', record.metadata.project);
  put('author', record.authorEmail?.toLowerCase());
  put('doc_type', record.metadata.docType);

  const fields: Record<string, unknown> = {
    kind: record.kind,
    body: record.body,
    ...(record.authorEmail ? { author: record.authorEmail.toLowerCase() } : {}),
    ...(record.threadId ? { thread_id: record.threadId } : {}),
    ...(record.replyToId ? { reply_to_id: record.replyToId } : {}),
    ...(record.fields ?? {}),
  };

  const item: HydraAppKnowledgeItem = {
    id: hydraIdFor(record.provider, record.externalId),
    title: record.title.slice(0, MAX_TITLE_LENGTH),
    kind: record.kind,
    provider: record.provider,
    external_id: record.externalId,
    timestamp: record.occurredAt,
    fields,
    metadata,
    additional_metadata: {
      people: uniqueEmails([record.authorEmail, ...(record.people ?? [])]),
      ...(record.extra ?? {}),
    },
  };

  if (record.url) item.url = record.url;

  const acl = normalizeAcl(record.acl);
  if (acl) item.acl = acl;

  if (record.relations?.length) {
    item.relations = record.relations.map((relation) => ({
      predicate: relation.predicate,
      target: { external_id: relation.targetExternalId, provider: relation.targetProvider ?? record.provider },
    }));
  }

  return item;
}
