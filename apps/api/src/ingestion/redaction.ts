import type { NormalizedRecord } from './normalized-record';

/**
 * Sensitive-data redaction applied to every record before it reaches HydraDB or the
 * Postgres mirror. ACLs decide who may see an item; redaction keeps values nobody
 * should retrieve from a company brain (government ids, card numbers, phone numbers,
 * credentials) out of the index entirely. Patterns favour precision over recall so
 * dates, ticket ids, amounts and Slack timestamps are left alone.
 */
export type RedactionKind = 'secret' | 'card' | 'ssn' | 'phone';

export type RedactionCounts = Partial<Record<RedactionKind, number>>;

export interface RedactionResult {
  text: string;
  counts: RedactionCounts;
}

const SECRET_PATTERNS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\bAKIA[0-9A-Z]{16}\b/g, // AWS access key id
  /\bxox[abposr]-[A-Za-z0-9-]{10,}/g, // Slack tokens
  /\bxapp-[A-Za-z0-9-]{10,}/g, // Slack app-level tokens
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g, // GitHub tokens
  /\bgithub_pat_[A-Za-z0-9_]{30,}\b/g, // GitHub fine-grained tokens
  /\bsk-(?:or-v1-|ant-|proj-)?[A-Za-z0-9_-]{20,}/g, // OpenAI / OpenRouter / Anthropic keys
  /\bAIza[0-9A-Za-z_-]{35}\b/g, // Google API keys
];

/** 13-19 digits, optionally grouped by spaces or dashes; confirmed with a Luhn check. */
const CARD_CANDIDATE = /(?<![\w.-])\d(?:[ -]?\d){12,18}(?![\w-]|\.\d)/g;

/** 123-45-6789 / 123 45 6789, excluding numbers the SSA never issues. */
const SSN_FORMATTED = /(?<![\w.-])(?!000|666|9\d\d)\d{3}([- ])(?!00)\d{2}\1(?!0000)\d{4}(?![\w-]|\.\d)/g;

/** Bare 9-digit SSNs only when labelled as such. */
const SSN_LABELLED = /\b(ssn|social security(?: number| no\.?)?)(\s*(?:#|no\.?|number)?\s*[:=]?\s*)(\d{9})\b/gi;

/** North American numbers with separators: (415) 555-0134, 415-555-0134, +1 415 555 0134. */
const PHONE_NANP =
  /(?<![\w+.-])(?:\+?1[\s.-]?)?(?:\([2-9]\d{2}\)\s?|[2-9]\d{2}[\s.-])[2-9]\d{2}[\s.-]\d{4}(?![\w-]|\.\d)/g;

/** International numbers written with a leading +: +44 20 7946 0958. */
const PHONE_INTL = /(?<![\w+])\+[2-9]\d{0,2}(?:[\s.-]?\d{1,4}){2,5}(?![\w-]|\.\d)/g;

function digitsOf(value: string): string {
  return value.replace(/\D/g, '');
}

export function passesLuhn(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let digit = Number(digits[index]);
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return digits.length > 0 && sum % 10 === 0;
}

export function redactSensitive(input: string | null | undefined): RedactionResult {
  const counts: RedactionCounts = {};
  const bump = (kind: RedactionKind) => {
    counts[kind] = (counts[kind] ?? 0) + 1;
  };
  let text = input ?? '';
  if (!text) return { text, counts };

  for (const pattern of SECRET_PATTERNS) {
    text = text.replace(pattern, () => {
      bump('secret');
      return '[REDACTED SECRET]';
    });
  }

  text = text.replace(CARD_CANDIDATE, (match) => {
    const digits = digitsOf(match);
    if (digits.length < 13 || digits.length > 19 || !passesLuhn(digits)) return match;
    bump('card');
    return `[REDACTED CARD ending ${digits.slice(-4)}]`;
  });

  text = text.replace(SSN_FORMATTED, () => {
    bump('ssn');
    return '[REDACTED SSN]';
  });
  text = text.replace(SSN_LABELLED, (_match, label: string, separator: string) => {
    bump('ssn');
    return `${label}${separator}[REDACTED SSN]`;
  });

  text = text.replace(PHONE_NANP, () => {
    bump('phone');
    return '[REDACTED PHONE]';
  });
  text = text.replace(PHONE_INTL, (match) => {
    const length = digitsOf(match).length;
    if (length < 8 || length > 15) return match;
    bump('phone');
    return '[REDACTED PHONE]';
  });

  return { text, counts };
}

function mergeCounts(target: RedactionCounts, source: RedactionCounts): void {
  for (const [kind, count] of Object.entries(source) as [RedactionKind, number][]) {
    target[kind] = (target[kind] ?? 0) + count;
  }
}

/**
 * Returns a redacted copy of the record (title, body and string `fields`) and the
 * counts per kind. The input is never mutated. Redacted records carry
 * `extra.redacted` so the brain can say a value was withheld.
 */
export function redactRecord(record: NormalizedRecord): { record: NormalizedRecord; counts: RedactionCounts } {
  const counts: RedactionCounts = {};
  const clean = (value: string): string => {
    const result = redactSensitive(value);
    mergeCounts(counts, result.counts);
    return result.text;
  };

  const title = clean(record.title);
  const body = clean(record.body);
  const fields = record.fields
    ? Object.fromEntries(
        Object.entries(record.fields).map(([key, value]) => [key, typeof value === 'string' ? clean(value) : value]),
      )
    : undefined;

  if (Object.keys(counts).length === 0) return { record, counts };
  return {
    record: {
      ...record,
      title,
      body,
      ...(fields ? { fields } : {}),
      extra: { ...(record.extra ?? {}), redacted: counts },
    },
    counts,
  };
}

export function describeRedactions(counts: RedactionCounts): string {
  return (Object.entries(counts) as [RedactionKind, number][]).map(([kind, count]) => `${count} ${kind}`).join(', ');
}
