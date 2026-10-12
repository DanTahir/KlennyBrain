import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AgentAction, AgentActionStatus, AgentActionType, InsightStatus, InsightType, Prisma } from '@prisma/client';
import type { AgentActionDto } from '@app-starter/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AclService } from '../acl/acl.service';
import { aclAllows, evidenceHydraIds } from '../insights/insight-visibility';
import { ACTION_PEOPLE_INCLUDE, toAgentActionDto } from './agent-action.mapper';
import { canApproveActions, canTransition } from './action-policy';
import { ExecutionContext } from './constants';
import { GithubExecutor } from './executors/github.executor';
import { SlackExecutor } from './executors/slack.executor';
import { HydraDocExecutor } from './executors/hydra-doc.executor';

export interface ActionProposal {
  type: AgentActionType;
  title: string;
  summary: string;
  payload: Record<string, unknown>;
}

const truncate = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 3)}...` : text);

/** Propose → approve (owner/admin) → execute lifecycle for agent side effects. */
@Injectable()
export class AgentActionsService {
  private readonly logger = new Logger(AgentActionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly acl: AclService,
    private readonly github: GithubExecutor,
    private readonly slack: SlackExecutor,
    private readonly hydraDoc: HydraDocExecutor,
  ) {}

  async list(userId: string, organizationId: string, status?: AgentActionStatus): Promise<AgentActionDto[]> {
    const identity = await this.acl.resolveIdentity(userId, organizationId);
    const actions = await this.prisma.agentAction.findMany({
      where: { organizationId, ...(status ? { status } : {}) },
      include: ACTION_PEOPLE_INCLUDE,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    // Doc-update payloads carry document bodies, so hide those the viewer cannot read.
    const docIds = [
      ...new Set(
        actions
          .map((action) => (action.payload as Record<string, unknown> | null)?.hydraId)
          .filter((id): id is string => typeof id === 'string'),
      ),
    ];
    const docs = docIds.length
      ? await this.prisma.knowledgeItem.findMany({
          where: { organizationId, hydraId: { in: docIds } },
          select: { hydraId: true, acl: true },
        })
      : [];
    const aclById = new Map(docs.map((doc) => [doc.hydraId, doc.acl]));
    return actions
      .filter((action) => {
        const hydraId = (action.payload as Record<string, unknown> | null)?.hydraId;
        return typeof hydraId !== 'string' || aclAllows(aclById.get(hydraId), identity.acl);
      })
      .map(toAgentActionDto);
  }

  async listForInsight(organizationId: string, insightId: string): Promise<AgentActionDto[]> {
    const actions = await this.prisma.agentAction.findMany({
      where: { organizationId, insightId, status: AgentActionStatus.PROPOSED },
      include: ACTION_PEOPLE_INCLUDE,
      orderBy: { createdAt: 'asc' },
    });
    return actions.map(toAgentActionDto);
  }

  async proposeMany(
    organizationId: string,
    requestedById: string | null,
    proposals: ActionProposal[],
    link: { insightId?: string | null; conversationId?: string | null } = {},
  ): Promise<AgentActionDto[]> {
    const created: AgentActionDto[] = [];
    for (const proposal of proposals) {
      const action = await this.prisma.agentAction.create({
        data: {
          organizationId,
          type: proposal.type,
          title: truncate(proposal.title, 200),
          summary: proposal.summary,
          payload: proposal.payload as Prisma.InputJsonValue,
          insightId: link.insightId ?? null,
          conversationId: link.conversationId ?? null,
          requestedById,
        },
        include: ACTION_PEOPLE_INCLUDE,
      });
      created.push(toAgentActionDto(action));
    }
    return created;
  }

  async approve(userId: string, organizationId: string, actionId: string): Promise<AgentActionDto> {
    await this.requireApprover(userId, organizationId);
    const action = await this.findAction(organizationId, actionId);
    if (!canTransition(action.status, AgentActionStatus.APPROVED)) {
      throw new BadRequestException(`This action is already ${action.status.toLowerCase()}`);
    }
    // Claim the action atomically so a double click cannot execute it twice.
    const claimed = await this.prisma.agentAction.updateMany({
      where: { id: action.id, organizationId, status: action.status },
      data: { status: AgentActionStatus.APPROVED, approvedById: userId, error: null },
    });
    if (claimed.count === 0) throw new ConflictException('This action was just handled by someone else');

    const approver = await this.prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true } });
    const context: ExecutionContext = {
      actionId: action.id,
      organizationId,
      approvedBy: approver?.name || approver?.email || 'an admin',
    };

    let data: Prisma.AgentActionUpdateInput;
    try {
      const result = await this.execute(action, context);
      data = {
        status: AgentActionStatus.EXECUTED,
        result: result as Prisma.InputJsonValue,
        executedAt: new Date(),
        error: null,
      };
    } catch (error) {
      const message = ((error as Error).message || 'Execution failed').slice(0, 500);
      this.logger.warn(`Action ${action.id} (${action.type}) failed: ${message}`);
      data = { status: AgentActionStatus.FAILED, error: message };
    }
    const updated = await this.prisma.agentAction.update({
      where: { id: action.id },
      data,
      include: ACTION_PEOPLE_INCLUDE,
    });
    return toAgentActionDto(updated);
  }

  async reject(userId: string, organizationId: string, actionId: string): Promise<AgentActionDto> {
    await this.requireApprover(userId, organizationId);
    const action = await this.findAction(organizationId, actionId);
    if (!canTransition(action.status, AgentActionStatus.REJECTED)) {
      throw new BadRequestException(`This action is already ${action.status.toLowerCase()}`);
    }
    const updated = await this.prisma.agentAction.update({
      where: { id: action.id },
      data: { status: AgentActionStatus.REJECTED, approvedBy: { connect: { id: userId } } },
      include: ACTION_PEOPLE_INCLUDE,
    });
    return toAgentActionDto(updated);
  }

  private async requireApprover(userId: string, organizationId: string): Promise<void> {
    const role = await this.acl.requireRole(userId, organizationId);
    if (!canApproveActions(role)) {
      throw new ForbiddenException('Only organization owners and admins can approve or reject agent actions');
    }
  }

  private async findAction(organizationId: string, actionId: string): Promise<AgentAction> {
    const action = await this.prisma.agentAction.findFirst({ where: { id: actionId, organizationId } });
    if (!action) throw new NotFoundException('Action not found');
    return action;
  }

  private async execute(action: AgentAction, context: ExecutionContext): Promise<Record<string, unknown>> {
    const payload = (action.payload ?? {}) as Record<string, unknown>;
    switch (action.type) {
      case AgentActionType.CREATE_GITHUB_ISSUE:
        return this.github.createIssue(payload, context);
      case AgentActionType.POST_SLACK_MESSAGE:
        return this.slack.postMessage(payload, context);
      case AgentActionType.UPDATE_KNOWLEDGE_DOC: {
        const result = await this.hydraDoc.updateDoc(action.organizationId, payload, context);
        const resolvedInsights = await this.resolveInsightsForDoc(action.organizationId, result.hydraId, action.insightId);
        return { ...result, resolvedInsights };
      }
      default:
        throw new Error(`${action.type} actions are not supported yet`);
    }
  }

  /** A corrected doc closes the insight it came from plus any other open stale/contradiction insight about it. */
  private async resolveInsightsForDoc(organizationId: string, hydraId: string, insightId: string | null): Promise<number> {
    const open = await this.prisma.insight.findMany({
      where: {
        organizationId,
        status: InsightStatus.OPEN,
        type: { in: [InsightType.STALE_DOC, InsightType.CONTRADICTION] },
      },
      select: { id: true, evidence: true },
    });
    const ids = new Set(open.filter((insight) => evidenceHydraIds(insight.evidence)[0] === hydraId).map((i) => i.id));
    if (insightId) ids.add(insightId);
    if (!ids.size) return 0;
    const result = await this.prisma.insight.updateMany({
      where: { organizationId, id: { in: [...ids] }, status: InsightStatus.OPEN },
      data: { status: InsightStatus.RESOLVED },
    });
    return result.count;
  }
}
