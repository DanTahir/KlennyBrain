import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AgentActionType,
  BrainSpace,
  InsightSeverity,
  InsightStatus,
  InsightType,
  KnowledgeItem,
  Prisma,
} from '@prisma/client';
import type { Citation, FixInsightResponse, InsightAnalysisDto, InsightDto } from '@app-starter/shared';
import { PrismaService } from '../prisma/prisma.service';
import { HydraService } from '../hydra/hydra.service';
import { LlmJsonRequest, LlmService, LlmTier } from '../llm/llm.service';
import { AclService, ADMIN_ROLES } from '../acl/acl.service';
import { JobRunnerService } from '../ingestion/job-runner.service';
import { ActionProposal, AgentActionsService } from '../agent-actions/agent-actions.service';
import { DEFAULT_GITHUB_ACTIONS_REPO, DEFAULT_SLACK_ACTIONS_CHANNEL } from '../agent-actions/constants';
import { cleanSnippet } from '../ask/citations';
import { Claim, findConflicts } from './claim-grouping';
import { evidenceHydraIds, filterVisibleInsights } from './insight-visibility';
import { toInsightDto } from './insight.mapper';
import { daysOverdue, daysUntilDue, dueDateToTimestamp, parseMeetingBody } from './meeting-parser';
import {
  CLAIM_EXTRACTION_PROMPT,
  CLAIMS_SCHEMA,
  FIX_PROMPT,
  FIX_SCHEMA,
  VERDICTS_SCHEMA,
  VERIFY_PROMPT,
} from './prompts';

interface InsightInput {
  fingerprint: string;
  type: InsightType;
  title: string;
  summary: string;
  severity: InsightSeverity;
  evidence: Citation[];
  entities: string[];
  ownerEmail?: string | null;
  dueAt?: Date | null;
  occurredAt?: Date | null;
}

interface ExtractedClaim {
  subject: string;
  attribute: string;
  value: string;
  quote: string;
}

interface ClaimVerdict {
  claim_index: number;
  verdict: 'consistent' | 'contradicted' | 'unsupported';
  current_value: string;
  evidence_ids: string[];
  explanation: string;
}

interface FixPlan {
  doc_update: { needed: boolean; corrected_body: string; reason: string };
  slack_message: { text: string };
  github_issue: { title: string; body: string; labels: string[] };
}

interface Evidence {
  row: KnowledgeItem;
  text: string;
}

const MAX_CLAIMS_PER_DOC = 4;
const DOC_CONCURRENCY = 3;
const ALLOWED_LABELS = new Set(['docs', 'knowledge-gap', 'launch', 'support', 'follow-up']);

const str = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

const truncate = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 3)}...` : text);

const day = (value: Date | string | null | undefined): string => {
  if (!value) return 'unknown date';
  const date = typeof value === 'string' ? new Date(value) : value;
  return Number.isNaN(date.getTime()) ? 'unknown date' : date.toISOString().slice(0, 10);
};

const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);

const capitalize = (text: string) => (text ? text[0].toUpperCase() + text.slice(1) : text);

async function mapLimit<T>(items: T[], limit: number, fn: (item: T, index: number) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      await fn(items[index], index);
    }
  });
  await Promise.all(workers);
}

/**
 * Precomputed insights over the brain: decisions and action items from meeting
 * notes, and contradictions / stale docs found by checking each knowledge-base
 * doc's claims against newer evidence retrieved from HydraDB.
 */
@Injectable()
export class InsightsService {
  private readonly logger = new Logger(InsightsService.name);
  private readonly runs = new Map<string, InsightAnalysisDto>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly hydra: HydraService,
    private readonly llm: LlmService,
    private readonly acl: AclService,
    private readonly jobs: JobRunnerService,
    private readonly agentActions: AgentActionsService,
    private readonly config: ConfigService,
  ) {}

  // ------------------------------------------------------------------ queries

  async list(
    userId: string,
    organizationId: string,
    filters: { type?: InsightType; status?: InsightStatus; viewAsEmail?: string },
  ): Promise<InsightDto[]> {
    const identity = await this.acl.resolveIdentity(userId, organizationId, filters.viewAsEmail);
    const insights = await this.prisma.insight.findMany({
      where: {
        organizationId,
        ...(filters.type ? { type: filters.type } : {}),
        ...(filters.status ? { status: filters.status } : {}),
      },
      orderBy: [
        { severity: 'desc' },
        { dueAt: { sort: 'asc', nulls: 'last' } },
        { occurredAt: { sort: 'desc', nulls: 'last' } },
      ],
      take: 300,
    });
    const visible = await filterVisibleInsights(this.prisma, organizationId, identity.acl, insights);
    return visible.map(toInsightDto);
  }

  async update(userId: string, organizationId: string, insightId: string, status: InsightStatus): Promise<InsightDto> {
    await this.acl.requireRole(userId, organizationId, ADMIN_ROLES);
    const insight = await this.prisma.insight.findFirst({ where: { id: insightId, organizationId } });
    if (!insight) throw new NotFoundException('Insight not found');
    const updated = await this.prisma.insight.update({ where: { id: insight.id }, data: { status } });
    return toInsightDto(updated);
  }

  async getAnalysis(userId: string, organizationId: string): Promise<InsightAnalysisDto> {
    await this.acl.requireRole(userId, organizationId);
    const counts = await this.openCounts(organizationId);
    const run = this.runs.get(organizationId);
    if (run) return { ...run, counts };
    return { status: 'IDLE', startedAt: null, finishedAt: null, message: null, error: null, counts };
  }

  // ----------------------------------------------------------------- analysis

  async startAnalysis(userId: string, organizationId: string): Promise<InsightAnalysisDto> {
    await this.acl.requireRole(userId, organizationId, ADMIN_ROLES);
    const current = this.runs.get(organizationId);
    if (current?.status === 'RUNNING') return { ...current, counts: await this.openCounts(organizationId) };
    if (!this.llm.isConfigured()) throw new BadRequestException('OpenRouter is not configured (OPENROUTER_API_KEY)');

    const run: InsightAnalysisDto = {
      status: 'RUNNING',
      startedAt: new Date().toISOString(),
      finishedAt: null,
      message: 'Queued',
      error: null,
      counts: {},
    };
    this.runs.set(organizationId, run);
    this.jobs.enqueue(`insights:${organizationId}`, async () => {
      try {
        await this.analyze(organizationId, run);
        run.status = 'SUCCEEDED';
      } catch (error) {
        run.status = 'FAILED';
        run.error = ((error as Error).message || 'Analysis failed').slice(0, 500);
        throw error;
      } finally {
        run.finishedAt = new Date().toISOString();
      }
    });
    return { ...run, counts: await this.openCounts(organizationId) };
  }

  private async analyze(organizationId: string, run: InsightAnalysisDto): Promise<void> {
    const space = await this.prisma.brainSpace.findUnique({ where: { organizationId } });
    if (!space || space.status !== 'READY') throw new Error('The brain is not provisioned yet');
    const people = await this.loadPeople(organizationId);

    run.message = 'Reading meeting notes for decisions and action items';
    const meetingCounts = await this.analyzeMeetings(organizationId, people);

    const docs = await this.prisma.knowledgeItem.findMany({
      where: { organizationId, kind: 'knowledge_base' },
      orderBy: { occurredAt: 'asc' },
    });
    const systemAcl = await this.systemAcl(organizationId);
    let contradictions = 0;
    let stale = 0;
    let checked = 0;
    await mapLimit(docs, DOC_CONCURRENCY, async (doc) => {
      try {
        const result = await this.checkDoc(space, doc, systemAcl, people);
        contradictions += result.contradictions;
        stale += result.stale;
      } catch (error) {
        this.logger.warn(`Insight check failed for ${doc.hydraId}: ${(error as Error).message}`);
      } finally {
        checked += 1;
        run.message = `Checked ${checked}/${docs.length} docs for contradictions`;
      }
    });

    run.message =
      `Found ${meetingCounts.decisions} decisions, ${meetingCounts.actionItems} open action items, ` +
      `${contradictions} contradictions and ${stale} stale docs`;
    this.logger.log(`Insights for ${organizationId}: ${run.message}`);
  }

  private async analyzeMeetings(
    organizationId: string,
    people: Map<string, string>,
  ): Promise<{ decisions: number; actionItems: number }> {
    const meetings = await this.prisma.knowledgeItem.findMany({
      where: { organizationId, kind: 'meeting' },
      orderBy: { occurredAt: 'asc' },
    });
    const now = new Date();
    let decisions = 0;
    let actionItems = 0;

    for (const meeting of meetings) {
      const parsed = parseMeetingBody(meeting.body);
      const evidence = [this.citation(meeting, 1, people)];
      const meetingDay = day(meeting.occurredAt);
      const project = str((meeting.metadata as Record<string, unknown> | null)?.project);

      for (const [index, decision] of parsed.decisions.entries()) {
        await this.upsertInsight(organizationId, {
          fingerprint: `decision:${meeting.hydraId}:${index}`,
          type: InsightType.DECISION,
          title: truncate(decision, 160),
          summary: `Decided in "${meeting.title}" on ${meetingDay}: ${decision}`,
          severity: InsightSeverity.LOW,
          evidence,
          entities: project ? [project] : [],
          occurredAt: meeting.occurredAt,
        });
        decisions += 1;
      }

      for (const item of parsed.actionItems) {
        const fingerprint = `action:${meeting.hydraId}:${slug(`${item.ownerEmail} ${item.text}`)}`;
        if (!item.open) {
          await this.prisma.insight.updateMany({
            where: { organizationId, fingerprint, status: InsightStatus.OPEN },
            data: { status: InsightStatus.RESOLVED },
          });
          continue;
        }
        const overdue = daysOverdue(item.due, now);
        const remaining = daysUntilDue(item.due, now);
        const severity =
          overdue > 0
            ? InsightSeverity.HIGH
            : remaining !== null && remaining <= 3
              ? InsightSeverity.MEDIUM
              : InsightSeverity.LOW;
        const dueText = item.due
          ? overdue > 0
            ? `Overdue by ${overdue} day${overdue === 1 ? '' : 's'} (due ${item.due}).`
            : `Due ${item.due}.`
          : 'No due date.';
        const ownerName = people.get(item.ownerEmail) ?? item.ownerName;
        await this.upsertInsight(organizationId, {
          fingerprint,
          type: InsightType.ACTION_ITEM,
          title: truncate(`${ownerName}: ${item.text}`, 160),
          summary: `Assigned to ${ownerName} in "${meeting.title}" (${meetingDay}). ${dueText} Status: ${item.status}.`,
          severity,
          evidence,
          entities: project ? [project] : [],
          ownerEmail: item.ownerEmail,
          dueAt: dueDateToTimestamp(item.due),
          occurredAt: meeting.occurredAt,
        });
        actionItems += 1;
      }
    }
    return { decisions, actionItems };
  }

  /** Extract a doc's checkable claims, retrieve evidence for each, and verify them. */
  private async checkDoc(
    space: BrainSpace,
    doc: KnowledgeItem,
    systemAcl: string[],
    people: Map<string, string>,
  ): Promise<{ contradictions: number; stale: number }> {
    const docDay = day(doc.occurredAt);
    const extraction = await this.llm.json<{ claims?: ExtractedClaim[] }>({
      tier: 'fast',
      schemaName: 'doc_claims',
      schema: CLAIMS_SCHEMA,
      maxTokens: 900,
      temperature: 0,
      messages: [
        { role: 'system', content: CLAIM_EXTRACTION_PROMPT },
        { role: 'user', content: `Document: ${doc.title}\nLast updated: ${docDay}\n\n${truncate(doc.body, 8000)}` },
      ],
    });
    const claims = (extraction.claims ?? [])
      .filter((claim) => claim && str(claim.subject) && str(claim.attribute) && str(claim.value))
      .slice(0, MAX_CLAIMS_PER_DOC);
    if (!claims.length) return { contradictions: 0, stale: 0 };

    const evidence: Evidence[][] = [];
    for (const claim of claims) {
      const result = await this.hydra.search({
        database: space.hydraDatabase,
        collection: space.collection,
        query: `${claim.subject} ${claim.attribute}`,
        acl: systemAcl,
        mode: 'fast',
        maxResults: 10,
      });
      const ids = [...new Set(result.hits.map((hit) => hit.hydraId))]
        .filter((id) => id && id !== doc.hydraId)
        .slice(0, 6);
      const rows = ids.length
        ? await this.prisma.knowledgeItem.findMany({ where: { organizationId: doc.organizationId, hydraId: { in: ids } } })
        : [];
      evidence.push(
        ids.flatMap((id): Evidence[] => {
          const row = rows.find((candidate) => candidate.hydraId === id);
          if (!row) return [];
          const hit = result.hits.find((candidate) => candidate.hydraId === id);
          return [{ row, text: hit?.text || row.body }];
        }),
      );
    }
    if (evidence.every((list) => list.length === 0)) return { contradictions: 0, stale: 0 };

    const claimBlocks = claims
      .map((claim, index) => {
        const sources = evidence[index]
          .map(
            (entry) =>
              `  - id=${entry.row.hydraId} | ${entry.row.kind} | ${day(entry.row.occurredAt)} | ${entry.row.title}\n` +
              `    ${cleanSnippet(entry.text, 600)}`,
          )
          .join('\n');
        return (
          `Claim ${index}: [${claim.subject}] ${claim.attribute} = "${claim.value}"\n` +
          `  Quote: "${truncate(claim.quote ?? '', 300)}"\n  Sources:\n${sources || '  - (none)'}`
        );
      })
      .join('\n\n');
    const verdicts = await this.jsonWithFallback<{ results?: ClaimVerdict[] }>(
      {
        schemaName: 'claim_verdicts',
        schema: VERDICTS_SCHEMA,
        maxTokens: 1800,
        temperature: 0,
        messages: [
          { role: 'system', content: VERIFY_PROMPT },
          {
            role: 'user',
            content: `Document: "${doc.title}" (id ${doc.hydraId}, last updated ${docDay})\n\n${claimBlocks}`,
          },
        ],
      },
      'answer',
    );

    let contradictions = 0;
    const staleNotes: string[] = [];
    const staleEvidence = new Map<string, KnowledgeItem>();
    for (const verdict of verdicts.results ?? []) {
      if (verdict?.verdict !== 'contradicted') continue;
      const claim = claims[verdict.claim_index];
      const pool = evidence[verdict.claim_index];
      const currentValue = str(verdict.current_value);
      if (!claim || !pool || !currentValue) continue;
      const support = pool.filter((entry) => (verdict.evidence_ids ?? []).includes(entry.row.hydraId));
      if (!support.length) continue;

      const toClaim = (value: string, row: KnowledgeItem): Claim => ({
        subject: claim.subject,
        attribute: claim.attribute,
        value,
        hydraId: row.hydraId,
        title: row.title,
        kind: row.kind,
        occurredAt: row.occurredAt ? row.occurredAt.toISOString() : null,
      });
      const [conflict] = findConflicts([
        toClaim(claim.value, doc),
        ...support.map((entry) => toClaim(currentValue, entry.row)),
      ]);
      if (!conflict) continue;

      const supportRows = support.map((entry) => entry.row);
      const latest = supportRows
        .map((row) => row.occurredAt)
        .filter((value): value is Date => Boolean(value))
        .sort((a, b) => b.getTime() - a.getTime())[0];
      const citations = [doc, ...supportRows].map((row, index) =>
        this.citation(row, index + 1, people, index === 0 ? undefined : support[index - 1].text),
      );
      await this.upsertInsight(doc.organizationId, {
        fingerprint: `contradiction:${doc.hydraId}:${slug(conflict.key)}`,
        type: InsightType.CONTRADICTION,
        title: truncate(`${capitalize(claim.attribute)}: "${claim.value}" vs "${currentValue}"`, 160),
        summary:
          `${str(verdict.explanation) ?? 'Sources disagree.'} "${doc.title}" (updated ${docDay}) says ${claim.value}; ` +
          `${supportRows.length} other source${supportRows.length === 1 ? '' : 's'} say ${currentValue}.`,
        severity: InsightSeverity.HIGH,
        evidence: citations,
        entities: [claim.subject, claim.attribute],
        ownerEmail: doc.authorEmail,
        occurredAt: latest ?? doc.occurredAt,
      });
      contradictions += 1;

      if (conflict.staleDocs.some((item) => item.hydraId === doc.hydraId)) {
        staleNotes.push(
          `${capitalize(claim.attribute)}: the doc says "${claim.value}", but "${conflict.current.title}" ` +
            `(${day(conflict.current.occurredAt)}) says "${currentValue}".`,
        );
        for (const row of supportRows) staleEvidence.set(row.hydraId, row);
      }
    }

    if (staleNotes.length) {
      const rows = [doc, ...staleEvidence.values()];
      await this.upsertInsight(doc.organizationId, {
        fingerprint: `stale:${doc.hydraId}`,
        type: InsightType.STALE_DOC,
        title: truncate(`Stale doc: ${doc.title}`, 160),
        summary: `Last updated ${docDay}, but newer sources supersede it:\n- ${staleNotes.join('\n- ')}`,
        severity: InsightSeverity.MEDIUM,
        evidence: rows.map((row, index) => this.citation(row, index + 1, people)),
        entities: [doc.title],
        ownerEmail: doc.authorEmail,
        occurredAt: doc.occurredAt,
      });
    }
    return { contradictions, stale: staleNotes.length ? 1 : 0 };
  }

  // ---------------------------------------------------------------------- fix

  /** Agent proposes remediation actions (doc fix, Slack heads-up, GitHub issue); nothing runs until approved. */
  async fix(userId: string, organizationId: string, insightId: string): Promise<FixInsightResponse> {
    const identity = await this.acl.resolveIdentity(userId, organizationId);
    const insight = await this.prisma.insight.findFirst({ where: { id: insightId, organizationId } });
    if (!insight) throw new NotFoundException('Insight not found');
    const [visible] = await filterVisibleInsights(this.prisma, organizationId, identity.acl, [insight]);
    if (!visible) throw new NotFoundException('Insight not found');

    const pending = await this.agentActions.listForInsight(organizationId, insight.id);
    if (pending.length) return { insight: toInsightDto(insight), actions: pending };
    if (!this.llm.isConfigured()) throw new BadRequestException('OpenRouter is not configured (OPENROUTER_API_KEY)');

    const ids = evidenceHydraIds(insight.evidence);
    const rows = ids.length
      ? await this.prisma.knowledgeItem.findMany({ where: { organizationId, hydraId: { in: ids } } })
      : [];
    const ordered = ids
      .map((id) => rows.find((row) => row.hydraId === id))
      .filter((row): row is KnowledgeItem => Boolean(row));
    const doc =
      insight.type === InsightType.STALE_DOC || insight.type === InsightType.CONTRADICTION
        ? ordered.find((row) => row.kind === 'knowledge_base')
        : undefined;
    const people = await this.loadPeople(organizationId);
    const channel = (this.config.get<string>('SLACK_ACTIONS_CHANNEL') || DEFAULT_SLACK_ACTIONS_CHANNEL).replace(/^#/, '');
    const repo = this.config.get<string>('GITHUB_ACTIONS_REPO') || DEFAULT_GITHUB_ACTIONS_REPO;
    const today = new Date().toISOString().slice(0, 10);
    const evidenceText = ordered
      .filter((row) => row !== doc)
      .slice(0, 6)
      .map((row) => `- ${row.title} (${row.kind}, ${day(row.occurredAt)}): ${cleanSnippet(row.body, 900)}`)
      .join('\n');
    const owner = insight.ownerEmail
      ? `Owner: ${people.get(insight.ownerEmail) ?? insight.ownerEmail} <${insight.ownerEmail}>`
      : '';
    const userPrompt = [
      `Today: ${today}`,
      `Insight type: ${insight.type}`,
      `Title: ${insight.title}`,
      `Summary: ${insight.summary}`,
      owner,
      insight.dueAt ? `Due: ${day(insight.dueAt)}` : '',
      `Slack channel for the message: #${channel}`,
      `GitHub repository for the issue: ${repo}`,
      doc
        ? `\nKnowledge-base document to correct (id ${doc.hydraId}, last updated ${day(doc.occurredAt)}):\n<<<DOC\n${truncate(doc.body, 12000)}\nDOC>>>`
        : '\nNo knowledge-base document is attached: set doc_update.needed=false.',
      `\nEvidence:\n${evidenceText || '- (none)'}`,
    ]
      .filter(Boolean)
      .join('\n');

    const plan = await this.jsonWithFallback<FixPlan>(
      {
        schemaName: 'insight_fix',
        schema: FIX_SCHEMA,
        maxTokens: 6000,
        temperature: 0.2,
        messages: [
          { role: 'system', content: FIX_PROMPT },
          { role: 'user', content: userPrompt },
        ],
      },
      'answer',
    );

    const proposals: ActionProposal[] = [];
    const correctedBody = str(plan.doc_update?.corrected_body);
    if (doc && plan.doc_update?.needed && correctedBody && correctedBody.length > 80) {
      const reason = str(plan.doc_update.reason) ?? insight.title;
      proposals.push({
        type: AgentActionType.UPDATE_KNOWLEDGE_DOC,
        title: `Update doc: ${doc.title}`,
        summary: reason,
        payload: {
          hydraId: doc.hydraId,
          externalId: doc.externalId,
          title: doc.title,
          correctedBody,
          reason,
          previousBody: truncate(doc.body, 12000),
        },
      });
    }
    const slackText = str(plan.slack_message?.text);
    if (slackText) {
      proposals.push({
        type: AgentActionType.POST_SLACK_MESSAGE,
        title: `Slack message to #${channel}`,
        summary: truncate(slackText, 240),
        payload: { channel, text: slackText },
      });
    }
    const issueTitle = str(plan.github_issue?.title);
    if (issueTitle) {
      const labels = (plan.github_issue.labels ?? []).filter((label) => ALLOWED_LABELS.has(label)).slice(0, 4);
      proposals.push({
        type: AgentActionType.CREATE_GITHUB_ISSUE,
        title: `GitHub issue: ${truncate(issueTitle, 120)}`,
        summary: `Open an issue in ${repo}`,
        payload: { repo, title: issueTitle, body: str(plan.github_issue.body) ?? insight.summary, labels },
      });
    }
    if (!proposals.length) throw new BadRequestException('The agent did not propose any actions for this insight');

    const actions = await this.agentActions.proposeMany(organizationId, userId, proposals, { insightId: insight.id });
    return { insight: toInsightDto(insight), actions };
  }

  // ------------------------------------------------------------------ helpers

  private async upsertInsight(organizationId: string, input: InsightInput): Promise<void> {
    const data = {
      type: input.type,
      title: input.title,
      summary: input.summary,
      severity: input.severity,
      evidence: input.evidence as unknown as Prisma.InputJsonValue,
      entities: input.entities as unknown as Prisma.InputJsonValue,
      ownerEmail: input.ownerEmail ?? null,
      dueAt: input.dueAt ?? null,
      occurredAt: input.occurredAt ?? null,
    };
    // Re-runs refresh content but never reopen insights a human resolved or dismissed.
    await this.prisma.insight.upsert({
      where: { organizationId_fingerprint: { organizationId, fingerprint: input.fingerprint } },
      create: { organizationId, fingerprint: input.fingerprint, ...data },
      update: data,
    });
  }

  private citation(row: KnowledgeItem, n: number, people: Map<string, string>, snippetSource?: string): Citation {
    const email = row.authorEmail?.toLowerCase();
    return {
      n,
      hydraId: row.hydraId,
      title: row.title,
      kind: row.kind,
      sourceSystem: row.sourceSystem,
      provider: row.provider,
      url: row.url,
      author: email ? (people.get(email) ?? email) : null,
      occurredAt: row.occurredAt ? row.occurredAt.toISOString() : null,
      snippet: cleanSnippet(snippetSource || row.body),
      score: null,
    };
  }

  private async jsonWithFallback<T>(request: Omit<LlmJsonRequest, 'tier'>, tier: LlmTier): Promise<T> {
    try {
      return await this.llm.json<T>({ ...request, tier });
    } catch (error) {
      if (tier === 'fast') throw error;
      this.logger.warn(`${request.schemaName} on the answer model failed (${(error as Error).message}); retrying fast`);
      return this.llm.json<T>({ ...request, tier: 'fast' });
    }
  }

  private async loadPeople(organizationId: string): Promise<Map<string, string>> {
    const people = await this.prisma.directoryPerson.findMany({
      where: { organizationId },
      select: { email: true, name: true },
    });
    return new Map(people.map((person) => [person.email.toLowerCase(), person.name]));
  }

  /**
   * The analyzer reads every item (insights inherit their evidence's ACL when
   * listed), so it searches with the union of all ACL entries in the org.
   */
  private async systemAcl(organizationId: string): Promise<string[]> {
    const [items, people] = await Promise.all([
      this.prisma.knowledgeItem.findMany({ where: { organizationId }, select: { acl: true } }),
      this.prisma.directoryPerson.findMany({ where: { organizationId }, select: { groups: true } }),
    ]);
    const entries = new Set<string>(['system:insights-analyzer']);
    for (const item of items) {
      if (Array.isArray(item.acl)) {
        for (const entry of item.acl) if (typeof entry === 'string' && entry.trim()) entries.add(entry.trim());
      }
    }
    for (const person of people) for (const group of person.groups) if (group.trim()) entries.add(group.trim());
    return [...entries];
  }

  private async openCounts(organizationId: string): Promise<InsightAnalysisDto['counts']> {
    const rows = await this.prisma.insight.groupBy({
      by: ['type'],
      where: { organizationId, status: InsightStatus.OPEN },
      _count: { _all: true },
    });
    return Object.fromEntries(rows.map((row) => [row.type, row._count._all]));
  }
}
