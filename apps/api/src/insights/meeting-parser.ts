export interface ParsedActionItem {
  status: string;
  ownerName: string;
  ownerEmail: string;
  text: string;
  due: string | null;
  open: boolean;
}

export interface ParsedMeeting {
  decisions: string[];
  actionItems: ParsedActionItem[];
}

const CLOSED_STATUSES = new Set(['done', 'closed', 'complete', 'completed', 'cancelled', 'canceled', 'resolved']);
const ACTION_LINE = /^\[([^\]]+)\]\s+(.+?)\s+\(([^()\s]+@[^()\s]+)\):\s+(.+?)(?:\s+\(due (\d{4}-\d{2}-\d{2})\))?$/;
const DAY_MS = 86_400_000;

function bulletSection(body: string, heading: string): string[] {
  const lines = body.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim().toLowerCase() === `## ${heading.toLowerCase()}`);
  if (start < 0) return [];
  const bullets: string[] = [];
  for (const line of lines.slice(start + 1)) {
    const trimmed = line.trim();
    if (/^##\s/.test(trimmed)) break;
    if (trimmed.startsWith('- ')) bullets.push(trimmed.slice(2).trim());
  }
  return bullets;
}

/**
 * Parses the meeting-note layout produced by the ingestion adapters
 * ("## Decisions" and "## Action items" bullet sections).
 */
export function parseMeetingBody(body: string): ParsedMeeting {
  const decisions = bulletSection(body, 'Decisions').filter((line) => line && !/^none recorded$/i.test(line));
  const actionItems = bulletSection(body, 'Action items').flatMap((line): ParsedActionItem[] => {
    const match = ACTION_LINE.exec(line);
    if (!match) return [];
    const status = match[1].trim().toLowerCase();
    return [
      {
        status,
        ownerName: match[2].trim(),
        ownerEmail: match[3].trim().toLowerCase(),
        text: match[4].trim(),
        due: match[5] ?? null,
        open: !CLOSED_STATUSES.has(status),
      },
    ];
  });
  return { decisions, actionItems };
}

function endOfDay(due: string): number {
  return Date.parse(`${due}T23:59:59.999Z`);
}

/** Whole days past the end of the due date (UTC); 0 when not overdue or undated. */
export function daysOverdue(due: string | null, now: Date): number {
  if (!due) return 0;
  const end = endOfDay(due);
  if (Number.isNaN(end) || now.getTime() <= end) return 0;
  return Math.ceil((now.getTime() - end) / DAY_MS);
}

/** Whole days until the end of the due date; null when undated. */
export function daysUntilDue(due: string | null, now: Date): number | null {
  if (!due) return null;
  const end = endOfDay(due);
  if (Number.isNaN(end)) return null;
  return Math.floor((end - now.getTime()) / DAY_MS);
}

export function dueDateToTimestamp(due: string | null): Date | null {
  if (!due) return null;
  const end = endOfDay(due);
  return Number.isNaN(end) ? null : new Date(end);
}
