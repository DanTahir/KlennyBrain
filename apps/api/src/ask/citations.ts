import type { Citation } from '@app-starter/shared';

export type CitationInput = Omit<Citation, 'n'>;

/** Plain-text preview of a chunk or document body for source cards. */
export function cleanSnippet(text: string, max = 320): string {
  const flat = text
    .replace(/^#+\s.*$/gm, ' ')
    .replace(/\*\*|__|`/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return flat.length > max ? `${flat.slice(0, max - 3).trimEnd()}...` : flat;
}

/**
 * Numbers sources in the order the agent first sees them so the model can
 * cite them as [n]; the same hydraId always keeps its number.
 */
export class CitationRegistry {
  private readonly byId = new Map<string, Citation>();

  get size(): number {
    return this.byId.size;
  }

  add(input: CitationInput): Citation {
    const existing = this.byId.get(input.hydraId);
    if (existing) {
      if (input.score !== null && (existing.score ?? -Infinity) < input.score) existing.score = input.score;
      if (!existing.snippet && input.snippet) existing.snippet = input.snippet;
      return existing;
    }
    const citation: Citation = { ...input, n: this.byId.size + 1 };
    this.byId.set(input.hydraId, citation);
    return citation;
  }

  get(hydraId: string): Citation | undefined {
    return this.byId.get(hydraId);
  }

  byNumber(n: number): Citation | undefined {
    return [...this.byId.values()].find((citation) => citation.n === n);
  }

  list(): Citation[] {
    return [...this.byId.values()].sort((a, b) => a.n - b.n);
  }
}

/** Source numbers referenced as [n] or [n, m] in an answer. */
export function extractCitedNumbers(answer: string): number[] {
  const numbers = new Set<number>();
  for (const match of answer.matchAll(/\[(\d+(?:\s*,\s*\d+)*)\]/g)) {
    for (const part of match[1].split(',')) {
      const n = Number(part.trim());
      if (Number.isInteger(n) && n > 0) numbers.add(n);
    }
  }
  return [...numbers].sort((a, b) => a - b);
}

/** Rewrites grouped markers like [1, 3] into [1][3] so the UI only handles one form. */
export function normalizeCitationMarkers(answer: string): string {
  return answer.replace(/\[(\d+(?:\s*,\s*\d+)+)\]/g, (_match, group: string) =>
    group
      .split(',')
      .map((part) => `[${part.trim()}]`)
      .join(''),
  );
}

/** Cited sources (keeping their numbers); falls back to the top sources when nothing is cited. */
export function selectCitations(all: Citation[], answer: string, fallback = 5): Citation[] {
  const cited = new Set(extractCitedNumbers(answer));
  const picked = all.filter((citation) => cited.has(citation.n));
  return picked.length ? picked : all.slice(0, fallback);
}
