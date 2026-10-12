/** A factual claim made by one source, e.g. "refund window = 14 days" in the refund policy doc. */
export interface Claim {
  subject: string;
  attribute: string;
  value: string;
  hydraId: string;
  title: string;
  kind: string;
  occurredAt: string | null;
}

export interface ClaimGroup {
  key: string;
  subject: string;
  attribute: string;
  claims: Claim[];
}

export interface ClaimConflict {
  key: string;
  subject: string;
  attribute: string;
  /** The most recent claim; its value is treated as the current truth. */
  current: Claim;
  currentValue: string;
  /** Claims whose normalized value differs from the current one. */
  conflicting: Claim[];
  /** Knowledge-base docs that state an older, superseded value. */
  staleDocs: Claim[];
}

const STOPWORDS = new Set([
  'a', 'an', 'the', 'our', 'of', 'for', 'to', 'in', 'on', 'and', 'is', 'are', 'at', 'by', 'current', 'northwind',
]);

const UNITS: Record<string, string> = {
  day: 'day',
  days: 'day',
  week: 'week',
  weeks: 'week',
  month: 'month',
  months: 'month',
  year: 'year',
  years: 'year',
  hour: 'hour',
  hours: 'hour',
  '%': '%',
  percent: '%',
};

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

const pad = (value: number) => String(value).padStart(2, '0');

function singular(token: string): string {
  return token.length > 3 && token.endsWith('s') && !token.endsWith('ss') ? token.slice(0, -1) : token;
}

/** Order-insensitive key for "what the claim is about", so paraphrases group together. */
export function normalizeKey(subject: string, attribute: string): string {
  const tokens = `${subject} ${attribute}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .map(singular)
    .filter((token) => token && !STOPWORDS.has(token));
  return [...new Set(tokens)].sort().join(' ');
}

/** Canonical form of a value: dates as `date:MM-DD`, quantities as `<n> <unit>`, else cleaned text. */
export function normalizeValue(value: string): string {
  const text = value.toLowerCase().trim();
  const iso = /\b\d{4}-(\d{2})-(\d{2})\b/.exec(text);
  if (iso) return `date:${iso[1]}-${iso[2]}`;
  const named = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b/.exec(text);
  if (named) return `date:${pad(MONTHS[named[1]])}-${pad(Number(named[2]))}`;
  const quantity = /(\d+(?:\.\d+)?)\s*-?\s*(days?|weeks?|months?|years?|hours?|%|percent)(?![a-z])/.exec(text);
  if (quantity) return `${Number(quantity[1])} ${UNITS[quantity[2]]}`;
  return text
    .replace(/[^a-z0-9%.\s-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const timeOf = (claim: Claim): number => (claim.occurredAt ? Date.parse(claim.occurredAt) || 0 : 0);

export function groupClaims(claims: Claim[]): ClaimGroup[] {
  const groups = new Map<string, ClaimGroup>();
  for (const claim of claims) {
    const key = normalizeKey(claim.subject, claim.attribute);
    if (!key) continue;
    const group = groups.get(key) ?? { key, subject: claim.subject, attribute: claim.attribute, claims: [] };
    group.claims.push(claim);
    groups.set(key, group);
  }
  return [...groups.values()];
}

/** Groups claims by topic and reports topics where sources disagree, newest value first. */
export function findConflicts(claims: Claim[]): ClaimConflict[] {
  return groupClaims(claims).flatMap((group): ClaimConflict[] => {
    const values = new Set(group.claims.map((claim) => normalizeValue(claim.value)));
    if (values.size < 2) return [];
    const current = [...group.claims].sort((a, b) => timeOf(b) - timeOf(a))[0];
    const currentValue = normalizeValue(current.value);
    const conflicting = group.claims.filter((claim) => normalizeValue(claim.value) !== currentValue);
    const seen = new Set<string>();
    const staleDocs = conflicting.filter((claim) => {
      if (claim.kind !== 'knowledge_base' || timeOf(claim) >= timeOf(current) || seen.has(claim.hydraId)) return false;
      seen.add(claim.hydraId);
      return true;
    });
    return [
      { key: group.key, subject: group.subject, attribute: group.attribute, current, currentValue, conflicting, staleDocs },
    ];
  });
}
