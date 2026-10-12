import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import { NormalizedRecord, NormalizedRelation } from '../normalized-record';
import { SourceAdapter, SourceAdapterContext } from '../source-adapter.interface';

interface BiblePerson {
  id: string;
  name: string;
  email: string;
  slackId: string;
  title: string;
  department: string;
}

interface Bible {
  company: { name: string; domain: string };
  people: BiblePerson[];
  externalContacts?: { name: string; email: string; company?: string; title?: string }[];
  customers?: { id: string; name: string }[];
  projects?: { id: string; name: string }[];
}

interface SlackChannel {
  id: string;
  name: string;
  is_private?: boolean;
}

interface SlackMessage {
  id: string;
  user: string;
  iso: string;
  text: string;
  thread_id?: string | null;
  reactions?: { name: string; count: number }[];
}

interface EmailThread {
  thread_id: string;
  subject: string;
  labels?: string[];
  acl?: string[] | null;
  customer?: string | null;
  project?: string | null;
  messages: {
    id: string;
    from: string;
    to: string[];
    cc?: string[];
    date: string;
    body: string;
    in_reply_to?: string | null;
  }[];
}

interface Meeting {
  id: string;
  title: string;
  date: string;
  duration_minutes?: number;
  attendees: string[];
  project?: string | null;
  acl?: string[] | null;
  transcript?: { speaker: string; t: string; text: string }[];
  summary?: string;
  decisions?: string[];
  action_items?: { owner: string; text: string; due?: string; status?: string }[];
}

interface Ticket {
  id: string;
  subject: string;
  requester: { name: string; email: string };
  customer?: string | null;
  status: string;
  priority: string;
  tags?: string[];
  assignee?: string | null;
  created_at: string;
  updated_at?: string;
  linked_issue_ids?: string[];
  comments?: { author: string; created_at: string; body: string; public?: boolean }[];
}

interface Issue {
  id: string;
  title: string;
  project?: string | null;
  state: string;
  assignee?: string | null;
  reporter?: string | null;
  labels?: string[];
  priority?: string;
  created_at: string;
  updated_at?: string;
  blocked_by?: string[];
  blocks?: string[];
  related?: string[];
  description?: string;
  comments?: { author: string; created_at: string; body: string }[];
}

const CHANNEL_PROJECTS: Record<string, string> = { 'atlas-launch': 'atlas' };

const truncate = (text: string, length: number) =>
  text.length > length ? `${text.slice(0, length - 1).trimEnd()}...` : text;

const day = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : 'unknown date');

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
}

function parseScalar(raw: string): unknown {
  const value = raw.trim();
  if (value === '' || value === 'null' || value === '~') return null;
  const unquote = (text: string) => text.replace(/^['"]|['"]$/g, '');
  if (value.startsWith('[') && value.endsWith(']')) {
    return value
      .slice(1, -1)
      .split(',')
      .map((entry) => unquote(entry.trim()))
      .filter(Boolean);
  }
  return unquote(value);
}

/** Minimal YAML front-matter parser (flat `key: value` and flow lists). */
export function parseFrontMatter(raw: string): { attrs: Record<string, unknown>; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  if (!match) return { attrs: {}, body: raw.trim() };
  const attrs: Record<string, unknown> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const pair = /^([A-Za-z0-9_]+):\s*(.*)$/.exec(line);
    if (pair) attrs[pair[1]] = parseScalar(pair[2]);
  }
  return { attrs, body: match[2].trim() };
}

/** Locates `data/demo` from the API's working directory or an explicit override. */
export function findDemoDataDir(override?: string | null): string {
  const candidates = [
    override,
    path.resolve(process.cwd(), 'data', 'demo'),
    path.resolve(process.cwd(), '..', '..', 'data', 'demo'),
    path.resolve(__dirname, '..', '..', '..', '..', '..', 'data', 'demo'),
    path.resolve(__dirname, '..', '..', '..', '..', '..', '..', 'data', 'demo'),
  ].filter((candidate): candidate is string => Boolean(candidate));
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, 'company.json'))) return candidate;
  }
  throw new Error(`Demo dataset not found (looked in: ${candidates.join(', ')})`);
}

/**
 * Reads the committed Northwind Robotics dataset (`data/demo`, see FORMAT.md)
 * and normalizes every Slack message, email, doc, meeting, ticket and issue.
 */
@Injectable()
export class DemoAdapter implements SourceAdapter {
  readonly type = 'DEMO' as const;

  constructor(private readonly config: ConfigService) {}

  async fetch(context: SourceAdapterContext): Promise<NormalizedRecord[]> {
    const configured = typeof context.config?.dataDir === 'string' ? context.config.dataDir : null;
    const dir = findDemoDataDir(configured ?? this.config.get<string>('DEMO_DATA_DIR') ?? null);
    return this.readAll(dir);
  }

  readAll(dir: string): NormalizedRecord[] {
    const bible = readJson<Bible>(path.join(dir, 'company.json'));
    const directory = new Directory(bible);
    return [
      ...this.readSlack(dir, directory),
      ...this.readEmail(dir, directory),
      ...this.readDocs(dir, directory),
      ...this.readMeetings(dir, directory),
      ...this.readTickets(dir, directory),
      ...this.readIssues(dir, directory),
    ];
  }

  private readSlack(dir: string, directory: Directory): NormalizedRecord[] {
    const slackDir = path.join(dir, 'slack');
    const channelsFile = path.join(slackDir, 'channels.json');
    if (!fs.existsSync(channelsFile)) return [];
    const channels = readJson<SlackChannel[]>(channelsFile);

    const all: { channel: SlackChannel; message: SlackMessage }[] = [];
    for (const channel of channels) {
      const channelDir = path.join(slackDir, channel.name);
      if (!fs.existsSync(channelDir)) continue;
      for (const file of fs.readdirSync(channelDir).filter((name) => name.endsWith('.json')).sort()) {
        for (const message of readJson<SlackMessage[]>(path.join(channelDir, file))) {
          all.push({ channel, message });
        }
      }
    }
    const byId = new Map(all.map((entry) => [entry.message.id, entry.message]));

    return all.map(({ channel, message }) => {
      const person = directory.bySlack(message.user);
      const authorName = person?.name ?? message.user;
      const text = directory.resolveMentions(message.text);
      const parent = message.thread_id ? byId.get(message.thread_id) : undefined;
      const parentLine = parent
        ? `, replying in a thread started by ${directory.bySlack(parent.user)?.name ?? parent.user}: "${truncate(
            directory.resolveMentions(parent.text),
            160,
          )}"`
        : '';
      const header = `${authorName}${person ? ` (${person.title})` : ''} in #${channel.name} on ${day(
        message.iso,
      )}${parentLine}:`;
      return {
        externalId: message.id,
        provider: 'slack',
        kind: 'message',
        sourceSystem: 'slack',
        title: `#${channel.name} - ${authorName}: ${truncate(text.replace(/\s+/g, ' '), 80)}`,
        body: `${header}\n${text}`,
        url: `https://northwind.slack.com/archives/${channel.id}/p${message.id}`,
        authorEmail: person?.email ?? null,
        occurredAt: message.iso,
        acl: channel.is_private ? [`group:slack:${channel.name}`] : null,
        metadata: {
          channel: channel.name,
          department: person?.department ?? null,
          project: CHANNEL_PROJECTS[channel.name] ?? null,
        },
        threadId: message.thread_id ?? message.id,
        replyToId: message.thread_id ?? null,
        people: directory.mentionedEmails(message.text),
        extra: {
          channel_id: channel.id,
          ...(message.reactions?.length
            ? { reactions: message.reactions.map((reaction) => `${reaction.name}:${reaction.count}`) }
            : {}),
        },
      } satisfies NormalizedRecord;
    });
  }

  private readEmail(dir: string, directory: Directory): NormalizedRecord[] {
    const file = path.join(dir, 'email', 'threads.json');
    if (!fs.existsSync(file)) return [];
    const records: NormalizedRecord[] = [];
    for (const thread of readJson<EmailThread[]>(file)) {
      for (const message of thread.messages) {
        const sender = directory.byEmail(message.from);
        const cc = message.cc?.length ? `Cc: ${message.cc.map((email) => directory.label(email)).join(', ')}\n` : '';
        const customer = thread.customer ? `Customer: ${directory.customerName(thread.customer)}\n` : '';
        records.push({
          externalId: message.id,
          provider: 'email',
          kind: 'email',
          sourceSystem: 'email',
          title: `${message.in_reply_to ? 'Re: ' : ''}${thread.subject} (from ${directory.name(message.from)})`,
          body:
            `Subject: ${thread.subject}\nFrom: ${directory.label(message.from)}\n` +
            `To: ${message.to.map((email) => directory.label(email)).join(', ')}\n${cc}` +
            `Date: ${message.date}\n${customer}\n${message.body}`,
          url: `https://mail.northwind.dev/thread/${thread.thread_id}#${message.id}`,
          authorEmail: message.from,
          occurredAt: message.date,
          acl: thread.acl ?? null,
          metadata: { department: sender?.department ?? null, project: thread.project ?? null },
          threadId: thread.thread_id,
          replyToId: message.in_reply_to ?? null,
          people: [message.from, ...message.to, ...(message.cc ?? [])],
          extra: {
            ...(thread.customer ? { customer: thread.customer } : {}),
            ...(thread.labels?.length ? { labels: thread.labels } : {}),
          },
        });
      }
    }
    return records;
  }

  private readDocs(dir: string, directory: Directory): NormalizedRecord[] {
    const docsDir = path.join(dir, 'docs');
    if (!fs.existsSync(docsDir)) return [];
    return fs
      .readdirSync(docsDir)
      .filter((name) => name.endsWith('.md'))
      .sort()
      .map((name) => {
        const { attrs, body } = parseFrontMatter(fs.readFileSync(path.join(docsDir, name), 'utf8'));
        const slug = name.replace(/\.md$/, '');
        const str = (key: string) => (typeof attrs[key] === 'string' ? (attrs[key] as string) : null);
        const owner = str('owner');
        const updatedAt = str('updated_at') ?? str('created_at') ?? '2026-04-12T00:00:00Z';
        const title = str('title') ?? slug;
        const acl = Array.isArray(attrs.acl) ? (attrs.acl as string[]) : null;
        return {
          externalId: str('id') ?? `doc-${slug}`,
          provider: 'docs',
          kind: 'knowledge_base',
          sourceSystem: 'doc',
          title,
          body:
            `${title} (${str('doc_type') ?? 'doc'}). Owner: ${owner ? directory.label(owner) : 'unknown'}. ` +
            `Last updated: ${day(updatedAt)}.\n\n${body}`,
          url: str('url') ?? `https://wiki.northwind.dev/${slug}`,
          authorEmail: owner,
          occurredAt: updatedAt,
          acl,
          metadata: { department: str('department'), project: str('project'), docType: str('doc_type') },
          people: owner ? [owner] : [],
          extra: {
            slug,
            ...(str('created_at') ? { created_at: str('created_at') } : {}),
            updated_at: updatedAt,
          },
        } satisfies NormalizedRecord;
      });
  }

  private readMeetings(dir: string, directory: Directory): NormalizedRecord[] {
    const meetingsDir = path.join(dir, 'meetings');
    if (!fs.existsSync(meetingsDir)) return [];
    return fs
      .readdirSync(meetingsDir)
      .filter((name) => name.endsWith('.json'))
      .sort()
      .map((name) => {
        const meeting = readJson<Meeting>(path.join(meetingsDir, name));
        const decisions = (meeting.decisions ?? []).map((decision) => `- ${decision}`).join('\n') || '- none recorded';
        const actions =
          (meeting.action_items ?? [])
            .map(
              (item) =>
                `- [${item.status ?? 'open'}] ${directory.name(item.owner)} (${item.owner}): ${item.text}${
                  item.due ? ` (due ${item.due})` : ''
                }`,
            )
            .join('\n') || '- none recorded';
        const transcript = (meeting.transcript ?? [])
          .map((line) => `${directory.name(line.speaker)} [${line.t}]: ${line.text}`)
          .join('\n');
        return {
          externalId: meeting.id,
          provider: 'meetings',
          kind: 'meeting',
          sourceSystem: 'meeting',
          title: `Meeting: ${meeting.title} (${day(meeting.date)})`,
          body:
            `Meeting "${meeting.title}" on ${day(meeting.date)}` +
            `${meeting.duration_minutes ? ` (${meeting.duration_minutes} min)` : ''}.\n` +
            `Attendees: ${meeting.attendees.map((email) => directory.label(email)).join(', ')}\n\n` +
            `## Summary\n${meeting.summary ?? ''}\n\n## Decisions\n${decisions}\n\n## Action items\n${actions}` +
            (transcript ? `\n\n## Transcript\n${transcript}` : ''),
          url: `https://meet.northwind.dev/notes/${meeting.id}`,
          authorEmail: meeting.attendees[0] ?? null,
          occurredAt: meeting.date,
          acl: meeting.acl ?? null,
          metadata: { project: meeting.project ?? null, department: directory.byEmail(meeting.attendees[0])?.department },
          people: [...meeting.attendees, ...(meeting.action_items ?? []).map((item) => item.owner)],
          extra: { attendees: meeting.attendees },
        } satisfies NormalizedRecord;
      });
  }

  private readTickets(dir: string, directory: Directory): NormalizedRecord[] {
    const file = path.join(dir, 'tickets', 'tickets.json');
    if (!fs.existsSync(file)) return [];
    return readJson<Ticket[]>(file).map((ticket) => {
      const comments = (ticket.comments ?? [])
        .map(
          (comment) =>
            `**${directory.name(comment.author)}** (${day(comment.created_at)}${
              comment.public === false ? ', internal note' : ''
            }): ${comment.body}`,
        )
        .join('\n\n');
      const linked = ticket.linked_issue_ids ?? [];
      return {
        externalId: ticket.id,
        provider: 'zendesk',
        kind: 'ticket',
        sourceSystem: 'ticket',
        title: `${ticket.id}: ${ticket.subject}`,
        body:
          `Support ticket ${ticket.id} "${ticket.subject}". Status: ${ticket.status}. Priority: ${ticket.priority}.\n` +
          `Requester: ${ticket.requester.name} <${ticket.requester.email}>` +
          `${ticket.customer ? ` (customer: ${directory.customerName(ticket.customer)})` : ''}\n` +
          `Assignee: ${ticket.assignee ? directory.label(ticket.assignee) : 'unassigned'}\n` +
          `Opened: ${day(ticket.created_at)}. Tags: ${(ticket.tags ?? []).join(', ') || 'none'}. ` +
          `Linked issues: ${linked.join(', ') || 'none'}.\n\n${comments}`,
        url: `https://northwind.zendesk.com/agent/tickets/${ticket.id}`,
        authorEmail: ticket.assignee ?? null,
        occurredAt: ticket.updated_at ?? ticket.created_at,
        acl: null,
        metadata: { department: 'support' },
        people: [ticket.assignee, ...(ticket.comments ?? []).map((comment) => comment.author)].filter(
          (email): email is string => Boolean(email),
        ),
        relations: linked.map((issueId) => ({
          predicate: 'related_to',
          targetExternalId: issueId,
          targetProvider: 'linear',
        })),
        fields: { status: ticket.status, priority: ticket.priority },
        extra: {
          ...(ticket.customer ? { customer: ticket.customer } : {}),
          ...(ticket.tags?.length ? { tags: ticket.tags } : {}),
          ...(linked.length ? { linked_issue_ids: linked } : {}),
        },
      } satisfies NormalizedRecord;
    });
  }

  private readIssues(dir: string, directory: Directory): NormalizedRecord[] {
    const file = path.join(dir, 'issues', 'issues.json');
    if (!fs.existsSync(file)) return [];
    return readJson<Issue[]>(file).map((issue) => {
      const relations: NormalizedRelation[] = [
        ...(issue.blocks ?? []).map((id) => ({ predicate: 'blocks', targetExternalId: id })),
        ...(issue.blocked_by ?? []).map((id) => ({ predicate: 'blocked_by', targetExternalId: id })),
        ...(issue.related ?? []).map((id) => ({ predicate: 'related_to', targetExternalId: id })),
      ];
      const comments = (issue.comments ?? [])
        .map((comment) => `**${directory.name(comment.author)}** (${day(comment.created_at)}): ${comment.body}`)
        .join('\n\n');
      const list = (values?: string[]) => (values?.length ? values.join(', ') : 'none');
      return {
        externalId: issue.id,
        provider: 'linear',
        kind: 'ticket',
        sourceSystem: 'issue',
        title: `${issue.id}: ${issue.title}`,
        body:
          `Engineering issue ${issue.id} "${issue.title}". State: ${issue.state}. Priority: ${issue.priority ?? 'none'}. ` +
          `Project: ${issue.project ?? 'none'}.\n` +
          `Assignee: ${issue.assignee ? directory.label(issue.assignee) : 'unassigned'}. ` +
          `Reporter: ${issue.reporter ? directory.label(issue.reporter) : 'unknown'}.\n` +
          `Blocks: ${list(issue.blocks)}. Blocked by: ${list(issue.blocked_by)}. Related: ${list(issue.related)}.\n` +
          `Last updated: ${day(issue.updated_at ?? issue.created_at)}.\n\n${issue.description ?? ''}` +
          (comments ? `\n\n## Comments\n${comments}` : ''),
        url: `https://linear.app/northwind/issue/${issue.id}`,
        authorEmail: issue.assignee ?? issue.reporter ?? null,
        occurredAt: issue.updated_at ?? issue.created_at,
        acl: null,
        metadata: { project: issue.project ?? null, department: 'engineering' },
        people: [issue.assignee, issue.reporter, ...(issue.comments ?? []).map((comment) => comment.author)].filter(
          (email): email is string => Boolean(email),
        ),
        relations,
        fields: { status: issue.state, priority: issue.priority ?? null },
        extra: { ...(issue.labels?.length ? { labels: issue.labels } : {}) },
      } satisfies NormalizedRecord;
    });
  }
}

/** Name/email lookups over the story bible. */
class Directory {
  private readonly people = new Map<string, BiblePerson>();
  private readonly slack = new Map<string, BiblePerson>();
  private readonly externals = new Map<string, { name: string; company?: string }>();
  private readonly customers = new Map<string, string>();

  constructor(bible: Bible) {
    for (const person of bible.people) {
      this.people.set(person.email.toLowerCase(), person);
      this.slack.set(person.slackId, person);
    }
    for (const contact of bible.externalContacts ?? []) {
      this.externals.set(contact.email.toLowerCase(), { name: contact.name, company: contact.company });
    }
    for (const customer of bible.customers ?? []) this.customers.set(customer.id, customer.name);
  }

  byEmail(email: string | null | undefined): BiblePerson | undefined {
    return email ? this.people.get(email.toLowerCase()) : undefined;
  }

  bySlack(slackId: string): BiblePerson | undefined {
    return this.slack.get(slackId);
  }

  name(email: string | null | undefined): string {
    if (!email) return 'unknown';
    const key = email.toLowerCase();
    return this.people.get(key)?.name ?? this.externals.get(key)?.name ?? email;
  }

  /** "Name <email>" with title for employees. */
  label(email: string): string {
    const person = this.byEmail(email);
    if (person) return `${person.name} (${person.title}) <${person.email}>`;
    const external = this.externals.get(email.toLowerCase());
    if (external) return `${external.name}${external.company ? ` (${external.company})` : ''} <${email}>`;
    return email;
  }

  customerName(id: string): string {
    return this.customers.get(id) ?? id;
  }

  resolveMentions(text: string): string {
    return text.replace(/<@([A-Z0-9]+)>/g, (match, id: string) => {
      const person = this.slack.get(id);
      return person ? `@${person.name}` : match;
    });
  }

  mentionedEmails(text: string): string[] {
    const emails: string[] = [];
    for (const match of text.matchAll(/<@([A-Z0-9]+)>/g)) {
      const person = this.slack.get(match[1]);
      if (person) emails.push(person.email);
    }
    return emails;
  }
}
