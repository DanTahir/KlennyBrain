import { InsightType as PrismaInsightType, AgentActionType, Prisma } from '@prisma/client';
import type { AgentActionDto, Citation, GraphPath } from '@app-starter/shared';
import type { ChatCompletionTool } from 'openai/resources/chat/completions';
import { PrismaService } from '../../prisma/prisma.service';
import { HydraService } from '../../hydra/hydra.service';
import { HydraSearchHit, HydraSearchResult } from '../../hydra/hydra.types';
import { BrainIdentity } from '../../acl/acl.service';
import { ACTION_PEOPLE_INCLUDE, toAgentActionDto } from '../../agent-actions/agent-action.mapper';
import { CitationInput, CitationRegistry, cleanSnippet } from '../citations';
import { filterVisibleInsights } from '../../insights/insight-visibility';

const SOURCE_SYSTEMS = ['slack', 'email', 'doc', 'meeting', 'ticket', 'issue'];
const INSIGHT_TYPES = ['CONTRADICTION', 'STALE_DOC', 'DECISION', 'ACTION_ITEM'];
const MAX_PROPOSALS = 3;
const NOT_FOUND = 'No matching sources found. The brain may not contain this, or the asker may not have access to it.';

export const AGENT_TOOLS: ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'search_knowledge',
      description:
        'Hybrid semantic + knowledge-graph search over the company brain (Slack, email, docs/policies, meeting notes, support tickets, engineering issues). Returns numbered sources to cite as [n].',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Focused natural-language search query' },
          source_system: {
            type: 'string',
            enum: SOURCE_SYSTEMS,
            description: 'Optional: only search one system',
          },
        },
        required: ['query'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'explore_entity',
      description:
        'Follow the knowledge graph around an issue id, customer, project, person or document (e.g. "ATL-212", "Globex SSO escalation"). Returns linked items and relationships such as blocks / related_to. Use for blockers and dependency chains.',
      parameters: {
        type: 'object',
        properties: { name: { type: 'string', description: 'Entity, item id or title to explore' } },
        required: ['name'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'find_experts',
      description: 'Rank the people who know most about a topic, with evidence (authored messages, tickets, docs, listed expertise).',
      parameters: {
        type: 'object',
        properties: { topic: { type: 'string' } },
        required: ['topic'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_insights',
      description: 'List open insights the brain already detected: contradictions, stale docs, decisions and overdue action items.',
      parameters: {
        type: 'object',
        properties: { type: { type: 'string', enum: INSIGHT_TYPES } },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'propose_github_issue',
      description: 'Propose a GitHub issue (requires human approval before it is created).',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          body: { type: 'string', description: 'Markdown body; reference sources by title' },
          labels: { type: 'array', items: { type: 'string' } },
        },
        required: ['title', 'body'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'propose_slack_message',
      description: 'Propose a Slack message to a channel (requires human approval before it is posted).',
      parameters: {
        type: 'object',
        properties: {
          channel: { type: 'string', description: 'Channel name without #' },
          text: { type: 'string' },
        },
        required: ['channel', 'text'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'propose_doc_update',
      description:
        'Propose replacing the body of a knowledge-base doc you found via search (requires human approval; then the brain is updated in place).',
      parameters: {
        type: 'object',
        properties: {
          source_number: { type: 'integer', description: 'The [n] number of the doc in your sources' },
          corrected_body: { type: 'string', description: 'Full corrected Markdown body of the doc' },
          reason: { type: 'string', description: 'Why the change is needed, citing the newer sources' },
        },
        required: ['source_number', 'corrected_body', 'reason'],
        additionalProperties: false,
      },
    },
  },
];

export interface ToolContext {
  organizationId: string;
  conversationId: string | null;
  identity: BrainIdentity;
  database: string;
  collection: string;
  registry: CitationRegistry;
  githubRepo: string;
  onSources: () => void;
  onGraph: (paths: GraphPath[]) => void;
  onAction: (action: AgentActionDto) => void;
}

export interface ToolResult {
  ok: boolean;
  content: string;
  summary: string;
}

const MIRROR_SELECT = {
  hydraId: true,
  externalId: true,
  kind: true,
  sourceSystem: true,
  provider: true,
  title: true,
  url: true,
  authorEmail: true,
  occurredAt: true,
  body: true,
  acl: true,
  additional: true,
} as const;

type MirrorRow = Prisma.KnowledgeItemGetPayload<{ select: typeof MIRROR_SELECT }>;

interface DirectoryEntry {
  name: string;
  title: string | null;
  department: string | null;
  expertise: string[];
}

const str = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

const truncate = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 3)}...` : text);

function aclOf(row: MirrorRow): string[] | null {
  return Array.isArray(row.acl) ? (row.acl as unknown[]).filter((entry): entry is string => typeof entry === 'string') : null;
}

function relationsOf(row: MirrorRow): { predicate: string; target: string }[] {
  const relations = (row.additional as { relations?: unknown } | null)?.relations;
  if (!Array.isArray(relations)) return [];
  return relations.filter(
    (relation): relation is { predicate: string; target: string } =>
      typeof relation?.predicate === 'string' && typeof relation?.target === 'string',
  );
}

function pathKey(path: GraphPath): string {
  return `${path.source}|${path.predicate}|${path.target}`.toLowerCase();
}

/** Executes agent tools for one Ask run; all searches carry the asker's ACL. */
export class AgentToolbox {
  readonly paths: GraphPath[] = [];
  readonly requestIds: string[] = [];
  readonly actions: AgentActionDto[] = [];
  private people: Map<string, DirectoryEntry> | null = null;
  private readonly pathKeys = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly hydra: HydraService,
    private readonly ctx: ToolContext,
  ) {}

  async execute(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    await this.loadPeople();
    switch (name) {
      case 'search_knowledge':
        return this.searchKnowledge(str(args.query) ?? '', str(args.source_system));
      case 'explore_entity':
        return this.exploreEntity(str(args.name) ?? '');
      case 'find_experts':
        return this.findExperts(str(args.topic) ?? '');
      case 'list_insights':
        return this.listInsights(str(args.type));
      case 'propose_github_issue':
        return this.proposeGithubIssue(args);
      case 'propose_slack_message':
        return this.proposeSlackMessage(args);
      case 'propose_doc_update':
        return this.proposeDocUpdate(args);
      default:
        return { ok: false, content: `Unknown tool ${name}`, summary: 'unknown tool' };
    }
  }

  // ---------------------------------------------------------------- retrieval

  private async searchKnowledge(query: string, sourceSystem?: string): Promise<ToolResult> {
    if (!query) return { ok: false, content: 'query is required', summary: 'missing query' };
    const filters: Record<string, string> = {};
    if (sourceSystem && SOURCE_SYSTEMS.includes(sourceSystem)) filters.source_system = sourceSystem;

    let result = await this.search(query, 10, filters);
    if (result.hits.length === 0 && Object.keys(filters).length) result = await this.search(query, 10, {});

    const rows = await this.mirrorFor(result.hits);
    const blocks: string[] = [];
    for (const hit of result.hits) {
      const row = this.rowFor(rows, hit);
      if (row && !this.visible(row)) continue;
      const citation = this.registerHit(hit, row);
      blocks.push(`${this.header(citation)}\n${truncate(hit.text || row?.body || '', 1400)}`);
      if (blocks.length >= 8) break;
    }
    this.addPaths(result.paths);
    this.ctx.onSources();

    const graph = result.paths
      .slice(0, 8)
      .map((path) => `- ${path.source} -[${path.predicate}]-> ${path.target}`)
      .join('\n');
    return {
      ok: true,
      content: blocks.length
        ? `Sources:\n\n${blocks.join('\n\n')}${graph ? `\n\nKnowledge-graph paths:\n${graph}` : ''}`
        : NOT_FOUND,
      summary: `${blocks.length} sources in ${result.durationMs}ms (${result.mode} mode)`,
    };
  }

  private async exploreEntity(name: string): Promise<ToolResult> {
    if (!name) return { ok: false, content: 'name is required', summary: 'missing name' };
    const people = this.peopleMatching(name);
    const seed = await this.resolveSeed(name);
    if (!seed) {
      return people.length
        ? { ok: true, content: `People:\n${people.join('\n')}`, summary: `${people.length} people` }
        : { ok: true, content: NOT_FOUND, summary: 'nothing found' };
    }
    const { citation: topCitation, hydraId: topId, text: seedText } = seed;

    let subgraph: Awaited<ReturnType<HydraService['subgraph']>> = { sources: [], paths: [] };
    try {
      subgraph = await this.hydra.subgraph(this.ctx.database, this.ctx.collection, topId, 2, 12);
    } catch {
      // Graph exploration is best-effort; fall back to the seed item only.
    }

    const linkedIds = subgraph.sources.map((source) => source.hydraId).filter((id) => id !== topId);
    const linkedRows = linkedIds.length
      ? await this.prisma.knowledgeItem.findMany({
          where: { organizationId: this.ctx.organizationId, hydraId: { in: linkedIds } },
          select: MIRROR_SELECT,
        })
      : [];
    const rowsById = new Map(linkedRows.map((row) => [row.hydraId, row]));
    const titleById = new Map<string, string>([[topId, topCitation.title]]);
    for (const row of linkedRows) titleById.set(row.hydraId, row.title);

    // Subgraph is not ACL-filtered by HydraDB, so only surface items the asker may see.
    let everythingVisible = true;
    const linkedLines: string[] = [];
    const itemPaths: GraphPath[] = [];
    for (const source of subgraph.sources) {
      if (source.hydraId === topId) continue;
      const row = rowsById.get(source.hydraId);
      if (!row || !this.visible(row)) {
        everythingVisible = false;
        continue;
      }
      const citation = this.ctx.registry.add(this.rowToCitation(row));
      const predicate = source.discoveredRelation ?? 'related_to';
      const via = source.discoveredVia && titleById.has(source.discoveredVia) ? source.discoveredVia : topId;
      linkedLines.push(`${this.header(citation)} - linked via ${predicate} (depth ${source.depth})`);
      itemPaths.push({
        source: titleById.get(via) ?? topCitation.title,
        predicate,
        target: citation.title,
        sourceType: 'SOURCE',
        targetType: 'SOURCE',
        evidence: [via, row.hydraId],
      });
    }
    // Explicit relations from the source systems (issue links, blockers) mirrored in Postgres.
    const neighborhood = await this.mirrorNeighborhood(topId);
    for (const link of neighborhood.links.slice(0, 24)) {
      const fromRow = neighborhood.rows.get(link.from);
      const toRow = neighborhood.rows.get(link.to);
      if (!fromRow || !toRow || !this.visible(fromRow) || !this.visible(toRow)) continue;
      const from = this.ctx.registry.add(this.rowToCitation(fromRow));
      const to = this.ctx.registry.add(this.rowToCitation(toRow));
      linkedLines.push(`[${from.n}] ${from.title} -[${link.predicate}]-> [${to.n}] ${to.title} (depth ${link.depth})`);
      itemPaths.push({
        source: from.title,
        predicate: link.predicate,
        target: to.title,
        sourceType: 'SOURCE',
        targetType: 'SOURCE',
        evidence: [link.from, link.to],
      });
    }

    this.addPaths(itemPaths);
    const entityPaths = everythingVisible ? subgraph.paths.slice(0, 15) : [];
    this.addPaths(entityPaths);
    this.ctx.onSources();

    const relationLines = entityPaths.map((path) => `- ${path.source} -[${path.predicate}]-> ${path.target}`);
    return {
      ok: true,
      content: [
        `Seed item: ${this.header(topCitation)}`,
        truncate(seedText, 700),
        '',
        'Linked items:',
        linkedLines.join('\n') || '- none visible',
        '',
        'Relationships:',
        relationLines.join('\n') || '- none',
        ...(people.length ? ['', 'People:', ...people] : []),
      ].join('\n'),
      summary: `${linkedLines.length} linked items, ${entityPaths.length + itemPaths.length} relationships`,
    };
  }

  private async findExperts(topic: string): Promise<ToolResult> {
    if (!topic) return { ok: false, content: 'topic is required', summary: 'missing topic' };
    const result = await this.search(topic, 15, {});
    const rows = await this.mirrorFor(result.hits);
    const people = this.people ?? new Map<string, DirectoryEntry>();
    const scores = new Map<string, { score: number; cites: Set<number>; reasons: Set<string> }>();
    const bump = (email: string | undefined | null, amount: number, cite?: number, reason?: string) => {
      const key = email?.toLowerCase();
      if (!key || !people.has(key)) return;
      const entry = scores.get(key) ?? { score: 0, cites: new Set<number>(), reasons: new Set<string>() };
      entry.score += amount;
      if (cite) entry.cites.add(cite);
      if (reason) entry.reasons.add(reason);
      scores.set(key, entry);
    };

    for (const hit of result.hits) {
      const row = this.rowFor(rows, hit);
      if (row && !this.visible(row)) continue;
      const citation = this.registerHit(hit, row);
      const weight = hit.score ?? 0.5;
      const author = row?.authorEmail ?? (typeof hit.metadata.author === 'string' ? hit.metadata.author : null);
      bump(author, weight, citation.n, `wrote ${citation.sourceSystem ?? citation.kind}`);
      const mentioned = (row?.additional as { people?: unknown } | null)?.people;
      if (Array.isArray(mentioned)) {
        for (const email of mentioned) {
          if (typeof email === 'string' && email !== author) bump(email, weight * 0.3, citation.n);
        }
      }
    }
    const words = topic
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length > 3);
    for (const [email, person] of people) {
      if (person.expertise.some((skill) => words.some((word) => skill.toLowerCase().includes(word)))) {
        bump(email, 1.5, undefined, 'listed expertise');
      }
    }
    this.ctx.onSources();

    const ranked = [...scores.entries()].sort((a, b) => b[1].score - a[1].score).slice(0, 4);
    if (!ranked.length) return { ok: true, content: NOT_FOUND, summary: 'no experts found' };
    const lines = ranked.map(([email, entry]) => {
      const person = people.get(email)!;
      const role = [person.title, person.department].filter(Boolean).join(', ');
      const cites = [...entry.cites].map((n) => `[${n}]`).join('');
      return `- ${person.name} <${email}> (${role}) - score ${entry.score.toFixed(2)}; ${[...entry.reasons].join(', ')}${
        cites ? `; evidence ${cites}` : ''
      }${person.expertise.length ? `; expertise: ${person.expertise.join(', ')}` : ''}`;
    });
    return { ok: true, content: `People ranked by evidence:\n${lines.join('\n')}`, summary: `${ranked.length} people ranked` };
  }

  private async listInsights(type?: string): Promise<ToolResult> {
    const candidates = await this.prisma.insight.findMany({
      where: {
        organizationId: this.ctx.organizationId,
        status: 'OPEN',
        ...(type && INSIGHT_TYPES.includes(type) ? { type: type as PrismaInsightType } : {}),
      },
      orderBy: [{ severity: 'desc' }, { dueAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }],
      take: 40,
    });
    // Insights inherit their evidence's ACL, so the asker only sees ones built from sources they can read.
    const insights = (
      await filterVisibleInsights(this.prisma, this.ctx.organizationId, this.ctx.identity.acl, candidates)
    ).slice(0, 12);
    if (!insights.length) return { ok: true, content: 'No open insights.', summary: '0 insights' };
    const lines = insights.map((insight) => {
      const evidence = Array.isArray(insight.evidence) ? (insight.evidence as unknown as Citation[]) : [];
      const numbers = evidence
        .filter((citation) => citation?.hydraId)
        .map((citation) => this.ctx.registry.add({ ...citation, n: undefined } as unknown as CitationInput).n);
      const due = insight.dueAt ? ` (due ${insight.dueAt.toISOString().slice(0, 10)})` : '';
      const owner = insight.ownerEmail ? ` owner: ${this.nameOf(insight.ownerEmail)}` : '';
      return `- [${insight.type}] ${insight.title}: ${insight.summary}${due}${owner} ${numbers.map((n) => `[${n}]`).join('')}`;
    });
    this.ctx.onSources();
    return { ok: true, content: lines.join('\n'), summary: `${insights.length} insights` };
  }

  // ---------------------------------------------------------------- proposals

  private proposeGithubIssue(args: Record<string, unknown>): Promise<ToolResult> {
    const title = str(args.title);
    const body = str(args.body);
    if (!title || !body) return Promise.resolve({ ok: false, content: 'title and body are required', summary: 'invalid' });
    const labels = Array.isArray(args.labels)
      ? args.labels.filter((label): label is string => typeof label === 'string').slice(0, 5)
      : [];
    return this.propose(
      AgentActionType.CREATE_GITHUB_ISSUE,
      `GitHub issue: ${truncate(title, 120)}`,
      `Open an issue in ${this.ctx.githubRepo}`,
      { repo: this.ctx.githubRepo, title, body, labels },
    );
  }

  private proposeSlackMessage(args: Record<string, unknown>): Promise<ToolResult> {
    const channel = str(args.channel)?.replace(/^#/, '');
    const text = str(args.text);
    if (!channel || !text) return Promise.resolve({ ok: false, content: 'channel and text are required', summary: 'invalid' });
    return this.propose(AgentActionType.POST_SLACK_MESSAGE, `Slack message to #${channel}`, truncate(text, 240), {
      channel,
      text,
    });
  }

  private async proposeDocUpdate(args: Record<string, unknown>): Promise<ToolResult> {
    const number = Number(args.source_number);
    const correctedBody = str(args.corrected_body);
    const reason = str(args.reason);
    const citation = Number.isInteger(number) ? this.ctx.registry.byNumber(number) : undefined;
    if (!citation || !correctedBody || !reason) {
      return { ok: false, content: 'source_number must be a [n] from your sources; corrected_body and reason are required', summary: 'invalid' };
    }
    const row = await this.prisma.knowledgeItem.findUnique({
      where: { organizationId_hydraId: { organizationId: this.ctx.organizationId, hydraId: citation.hydraId } },
      select: MIRROR_SELECT,
    });
    if (!row || !this.visible(row) || row.kind !== 'knowledge_base') {
      return { ok: false, content: `[${number}] is not a knowledge-base doc that can be updated`, summary: 'not a doc' };
    }
    return this.propose(AgentActionType.UPDATE_KNOWLEDGE_DOC, `Update doc: ${row.title}`, reason, {
      hydraId: row.hydraId,
      externalId: row.externalId,
      title: row.title,
      correctedBody,
      reason,
      previousBody: truncate(row.body, 6000),
    });
  }

  private async propose(
    type: AgentActionType,
    title: string,
    summary: string,
    payload: Record<string, unknown>,
  ): Promise<ToolResult> {
    if (this.actions.length >= MAX_PROPOSALS) {
      return { ok: false, content: 'Proposal limit reached for this answer.', summary: 'limit reached' };
    }
    const action = await this.prisma.agentAction.create({
      data: {
        organizationId: this.ctx.organizationId,
        type,
        title,
        summary,
        payload: payload as Prisma.InputJsonValue,
        conversationId: this.ctx.conversationId,
        requestedById: this.ctx.identity.userId || null,
      },
      include: ACTION_PEOPLE_INCLUDE,
    });
    const dto = toAgentActionDto(action);
    this.actions.push(dto);
    this.ctx.onAction(dto);
    return {
      ok: true,
      content: `Proposed action ${action.id} (${type}). It runs only after a human approves it in the Actions panel.`,
      summary: `proposed ${type.toLowerCase()}`,
    };
  }

  // ---------------------------------------------------------------- helpers

  /** Seed item for graph exploration: exact id match (e.g. ATL-212) first, then search. */
  private async resolveSeed(name: string): Promise<{ hydraId: string; citation: Citation; text: string } | null> {
    const direct = await this.prisma.knowledgeItem.findFirst({
      where: {
        organizationId: this.ctx.organizationId,
        OR: [{ externalId: { equals: name, mode: 'insensitive' } }, { hydraId: name.toLowerCase() }],
      },
      select: MIRROR_SELECT,
    });
    if (direct && this.visible(direct)) {
      return { hydraId: direct.hydraId, citation: this.ctx.registry.add(this.rowToCitation(direct)), text: direct.body };
    }
    const result = await this.search(name, 5, {});
    const rows = await this.mirrorFor(result.hits);
    for (const hit of result.hits) {
      const row = this.rowFor(rows, hit);
      if (row && !this.visible(row)) continue;
      return { hydraId: row?.hydraId ?? hit.hydraId, citation: this.registerHit(hit, row), text: hit.text || row?.body || '' };
    }
    return null;
  }

  /** Breadth-first walk (depth 2, both directions) over mirrored explicit relations. */
  private async mirrorNeighborhood(seedId: string): Promise<{
    links: { from: string; to: string; predicate: string; depth: number }[];
    rows: Map<string, MirrorRow>;
  }> {
    const { organizationId } = this.ctx;
    const rows = new Map<string, MirrorRow>();
    const links = new Map<string, { from: string; to: string; predicate: string; depth: number }>();
    const seen = new Set<string>([seedId]);
    let frontier = [seedId];
    for (let depth = 1; depth <= 2 && frontier.length; depth += 1) {
      const [forward, reverse] = await Promise.all([
        this.prisma.knowledgeItem.findMany({ where: { organizationId, hydraId: { in: frontier } }, select: MIRROR_SELECT }),
        this.prisma.knowledgeItem.findMany({
          where: {
            organizationId,
            OR: frontier.map((id) => ({ additional: { path: ['relations'], array_contains: [{ target: id }] } })),
          },
          select: MIRROR_SELECT,
          take: 40,
        }),
      ]);
      const next = new Set<string>();
      const record = (from: string, to: string, predicate: string) => {
        const key = `${from}|${predicate}|${to}`;
        if (!links.has(key)) links.set(key, { from, to, predicate, depth });
      };
      for (const row of [...forward, ...reverse]) rows.set(row.hydraId, row);
      for (const row of forward) {
        for (const relation of relationsOf(row)) {
          record(row.hydraId, relation.target, relation.predicate);
          if (!seen.has(relation.target)) next.add(relation.target);
        }
      }
      for (const row of reverse) {
        for (const relation of relationsOf(row)) {
          if (!frontier.includes(relation.target)) continue;
          record(row.hydraId, relation.target, relation.predicate);
          if (!seen.has(row.hydraId)) next.add(row.hydraId);
        }
      }
      next.forEach((id) => seen.add(id));
      frontier = [...next].slice(0, 12);
    }
    const missing = [...seen].filter((id) => !rows.has(id));
    if (missing.length) {
      const extra = await this.prisma.knowledgeItem.findMany({
        where: { organizationId, hydraId: { in: missing } },
        select: MIRROR_SELECT,
      });
      for (const row of extra) rows.set(row.hydraId, row);
    }
    return { links: [...links.values()], rows };
  }

  private async search(query: string, maxResults: number, filters: Record<string, string>): Promise<HydraSearchResult> {
    const result = await this.hydra.search({
      database: this.ctx.database,
      collection: this.ctx.collection,
      query,
      acl: this.ctx.identity.acl,
      mode: 'thinking',
      maxResults,
      metadataFilters: filters,
    });
    if (result.requestId) this.requestIds.push(result.requestId);
    return result;
  }

  private async mirrorFor(hits: HydraSearchHit[]): Promise<Map<string, MirrorRow>> {
    const rows = new Map<string, MirrorRow>();
    if (!hits.length) return rows;
    const found = await this.prisma.knowledgeItem.findMany({
      where: {
        organizationId: this.ctx.organizationId,
        OR: [{ hydraId: { in: hits.map((hit) => hit.hydraId) } }, { title: { in: hits.map((hit) => hit.title) } }],
      },
      select: MIRROR_SELECT,
    });
    for (const row of found) {
      rows.set(row.hydraId, row);
      if (!rows.has(`title:${row.title}`)) rows.set(`title:${row.title}`, row);
    }
    return rows;
  }

  private rowFor(rows: Map<string, MirrorRow>, hit: HydraSearchHit): MirrorRow | undefined {
    return rows.get(hit.hydraId) ?? rows.get(`title:${hit.title}`);
  }

  /** Defense in depth: re-check the item ACL against the asker even though HydraDB already filtered. */
  private visible(row: MirrorRow): boolean {
    const acl = aclOf(row);
    if (!acl || acl.length === 0) return true;
    return acl.some((entry) => this.ctx.identity.acl.includes(entry));
  }

  private registerHit(hit: HydraSearchHit, row?: MirrorRow): Citation {
    if (row) {
      return this.ctx.registry.add({ ...this.rowToCitation(row), snippet: cleanSnippet(hit.text || row.body), score: hit.score });
    }
    const metadata = hit.metadata ?? {};
    return this.ctx.registry.add({
      hydraId: hit.hydraId,
      title: hit.title,
      kind: hit.kind ?? 'knowledge_base',
      sourceSystem: typeof metadata.source_system === 'string' ? metadata.source_system : null,
      provider: hit.hydraId.split('-')[0] ?? 'unknown',
      url: hit.url,
      author: typeof metadata.author === 'string' ? metadata.author : null,
      occurredAt: null,
      snippet: cleanSnippet(hit.text),
      score: hit.score,
    });
  }

  private rowToCitation(row: MirrorRow): CitationInput {
    return {
      hydraId: row.hydraId,
      title: row.title,
      kind: row.kind,
      sourceSystem: row.sourceSystem,
      provider: row.provider,
      url: row.url,
      author: row.authorEmail,
      occurredAt: row.occurredAt ? row.occurredAt.toISOString() : null,
      snippet: cleanSnippet(row.body),
      score: null,
    };
  }

  private header(citation: Citation): string {
    const parts = [citation.sourceSystem ?? citation.kind];
    if (citation.author) parts.push(`by ${this.nameOf(citation.author)}`);
    if (citation.occurredAt) parts.push(citation.occurredAt.slice(0, 10));
    return `[${citation.n}] ${citation.title} (${parts.join(', ')})`;
  }

  private addPaths(paths: GraphPath[]): void {
    let added = false;
    for (const path of paths) {
      const key = pathKey(path);
      if (this.pathKeys.has(key) || this.paths.length >= 60) continue;
      this.pathKeys.add(key);
      this.paths.push(path);
      added = true;
    }
    if (added) this.ctx.onGraph(this.paths);
  }

  private async loadPeople(): Promise<void> {
    if (this.people) return;
    const rows = await this.prisma.directoryPerson.findMany({ where: { organizationId: this.ctx.organizationId } });
    this.people = new Map(
      rows.map((row) => [
        row.email.toLowerCase(),
        { name: row.name, title: row.title, department: row.department, expertise: row.expertise },
      ]),
    );
  }

  private nameOf(email: string): string {
    return this.people?.get(email.toLowerCase())?.name ?? email;
  }

  private peopleMatching(name: string): string[] {
    const needle = name.toLowerCase();
    return [...(this.people ?? new Map<string, DirectoryEntry>()).entries()]
      .filter(([email, person]) => person.name.toLowerCase().includes(needle) || email.startsWith(needle))
      .slice(0, 3)
      .map(([email, person]) => {
        const role = [person.title, person.department].filter(Boolean).join(', ');
        return `- ${person.name} <${email}> (${role})${person.expertise.length ? `; expertise: ${person.expertise.join(', ')}` : ''}`;
      });
  }
}
