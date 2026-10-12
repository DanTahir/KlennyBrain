import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import type {
  AskResponse,
  AskStreamEvent,
  ChatMessageDto,
  ConversationDto,
  ToolCallTrace,
} from '@app-starter/shared';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { PrismaService } from '../prisma/prisma.service';
import { AclService, BrainIdentity } from '../acl/acl.service';
import { HydraService, dedupePaths } from '../hydra/hydra.service';
import { LlmService } from '../llm/llm.service';
import { AGENT_TOOLS, AgentToolbox, ToolResult } from './agent/tools';
import { buildSystemPrompt, describeToolCall } from './agent/prompts';
import { CitationRegistry, normalizeCitationMarkers, selectCitations } from './citations';
import { toChatMessageDto, toConversationDto } from './chat.mappers';
import { FeedbackDto } from './dto/ask.dto';

const MAX_STEPS = 5;
const MAX_CALLS_PER_STEP = 3;
const BUDGET_MS = 60_000;
const DEFAULT_GITHUB_REPO = 'DanTahir/northwind-atlas-tracker';

export type AskEmitter = (event: AskStreamEvent) => void;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function parseArgs(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

@Injectable()
export class AskService {
  private readonly logger = new Logger(AskService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly acl: AclService,
    private readonly hydra: HydraService,
    private readonly llm: LlmService,
    private readonly config: ConfigService,
  ) {}

  /** JSON (non-streaming) ask for web fallback and the Slack bot. */
  async ask(identity: BrainIdentity, input: { question: string; conversationId?: string }): Promise<AskResponse> {
    return this.run(identity, input, () => undefined);
  }

  /**
   * Agent loop: the answer model routes between tools (ACL-scoped HydraDB
   * search, graph exploration, expert finding, insights, action proposals)
   * for up to MAX_STEPS rounds, then writes a cited answer.
   */
  async run(
    identity: BrainIdentity,
    input: { question: string; conversationId?: string },
    emit: AskEmitter,
    signal?: AbortSignal,
  ): Promise<AskResponse> {
    const startedAt = Date.now();
    const question = input.question.trim();
    const { organizationId } = identity;

    const space = await this.prisma.brainSpace.findUnique({ where: { organizationId } });
    if (!space || space.status !== 'READY') {
      throw new BadRequestException('This brain is not ready yet. Load the demo company on the Sources page first.');
    }
    if (!this.llm.isConfigured()) throw new BadRequestException('OpenRouter is not configured (OPENROUTER_API_KEY).');

    const organization = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { name: true },
    });
    const conversation = await this.resolveConversation(identity, input.conversationId, question);
    const history = await this.prisma.chatMessage.findMany({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: 'desc' },
      take: 6,
    });
    const viewAsEmail = identity.viewAs?.email ?? null;
    await this.prisma.chatMessage.create({
      data: { conversationId: conversation.id, organizationId, role: 'USER', content: question, viewAsEmail },
    });
    await this.prisma.conversation.update({ where: { id: conversation.id }, data: { updatedAt: new Date() } });

    const registry = new CitationRegistry();
    const trace: ToolCallTrace[] = [];
    const toolbox = new AgentToolbox(this.prisma, this.hydra, {
      organizationId,
      conversationId: conversation.id,
      identity,
      database: space.hydraDatabase,
      collection: space.collection,
      registry,
      githubRepo: this.config.get<string>('GITHUB_ACTIONS_REPO') || DEFAULT_GITHUB_REPO,
      onSources: () => emit({ type: 'sources', citations: registry.list() }),
      onGraph: (paths) => emit({ type: 'graph', paths: paths.slice(0, 40) }),
      onAction: (action) => emit({ type: 'action_proposed', action }),
    });

    const asker = identity.viewAs ?? identity.person;
    const messages: ChatCompletionMessageParam[] = [
      {
        role: 'system',
        content: buildSystemPrompt({
          organizationName: organization.name,
          asker: {
            name: asker?.name ?? identity.effectiveEmail,
            email: identity.effectiveEmail,
            title: asker?.title,
            department: asker?.department,
          },
        }),
      },
      ...history
        .reverse()
        .map(
          (message): ChatCompletionMessageParam =>
            message.role === 'USER'
              ? { role: 'user', content: message.content.slice(0, 2000) }
              : { role: 'assistant', content: message.content.slice(0, 2000) },
        ),
      { role: 'user', content: question },
    ];

    emit({ type: 'status', message: 'Reading the question' });
    let answer: string | null = null;
    let streamed = false;

    for (let step = 0; step < MAX_STEPS; step += 1) {
      if (signal?.aborted) throw new Error('Request aborted');
      if (Date.now() - startedAt > BUDGET_MS) break;

      const completion = await this.llm.chat({
        tier: 'answer',
        messages,
        tools: AGENT_TOOLS,
        toolChoice: step === 0 ? 'required' : 'auto',
        maxTokens: 1500,
        signal,
      });
      const message = completion.choices[0]?.message;
      const calls = message?.tool_calls ?? [];
      if (calls.length === 0) {
        answer = message?.content?.trim() || null;
        break;
      }

      messages.push({ role: 'assistant', content: message?.content ?? '', tool_calls: calls });
      for (const [index, call] of calls.entries()) {
        if (call.type !== 'function') {
          messages.push({ role: 'tool', tool_call_id: call.id, content: 'Unsupported tool type.' });
          continue;
        }
        if (index >= MAX_CALLS_PER_STEP) {
          messages.push({ role: 'tool', tool_call_id: call.id, content: 'Skipped: too many tool calls in one step.' });
          continue;
        }
        const name = call.function.name;
        const args = parseArgs(call.function.arguments);
        emit({ type: 'status', message: describeToolCall(name, args) });
        const toolStartedAt = Date.now();
        let result: ToolResult;
        try {
          result = await toolbox.execute(name, args);
        } catch (error) {
          const reason = (error as Error).message ?? 'unknown error';
          this.logger.warn(`Tool ${name} failed: ${reason}`);
          result = { ok: false, content: `Tool failed: ${reason}`, summary: reason.slice(0, 160) };
        }
        const entry: ToolCallTrace = {
          id: call.id,
          name,
          args,
          resultSummary: result.summary,
          durationMs: Date.now() - toolStartedAt,
          status: result.ok ? 'ok' : 'error',
        };
        trace.push(entry);
        emit({ type: 'tool_call', call: entry });
        messages.push({ role: 'tool', tool_call_id: call.id, content: result.content });
      }
    }

    if (!answer) {
      // Step or time budget exhausted: force a final, streamed synthesis.
      emit({ type: 'status', message: 'Writing the answer' });
      messages.push({
        role: 'user',
        content: 'Write the final answer now, using only the sources above and citing them as [n].',
      });
      let text = '';
      for await (const delta of this.llm.streamText({
        tier: 'answer',
        messages,
        tools: AGENT_TOOLS,
        toolChoice: 'none',
        maxTokens: 1500,
        signal,
      })) {
        text += delta;
        emit({ type: 'token', delta });
      }
      answer = text.trim();
      streamed = true;
    }
    if (!answer) answer = "I couldn't find that in the brain.";
    answer = normalizeCitationMarkers(answer);
    if (!streamed) await this.relay(answer, emit, signal);

    const citations = selectCitations(registry.list(), answer);
    const graphPaths = dedupePaths(toolbox.paths).slice(0, 30);
    emit({ type: 'sources', citations });
    emit({ type: 'graph', paths: graphPaths });

    const hydraRequestId = toolbox.requestIds[0] ?? null;
    const saved = await this.prisma.chatMessage.create({
      data: {
        conversationId: conversation.id,
        organizationId,
        role: 'ASSISTANT',
        content: answer,
        citations: citations as unknown as Prisma.InputJsonValue,
        toolTrace: trace as unknown as Prisma.InputJsonValue,
        graphPaths: graphPaths as unknown as Prisma.InputJsonValue,
        hydraRequestId,
        viewAsEmail,
      },
    });
    this.logger.log(
      `ask org=${organizationId} as=${identity.effectiveEmail} steps=${trace.length} sources=${citations.length} ${
        Date.now() - startedAt
      }ms`,
    );

    emit({ type: 'done', messageId: saved.id, conversationId: conversation.id, hydraRequestId, viewAs: identity.viewAs });
    return {
      messageId: saved.id,
      conversationId: conversation.id,
      answer,
      citations,
      toolTrace: trace,
      graphPaths,
      actions: toolbox.actions,
      hydraRequestId,
      viewAs: identity.viewAs,
    };
  }

  async listConversations(userId: string, organizationId: string): Promise<ConversationDto[]> {
    await this.acl.requireRole(userId, organizationId);
    const conversations = await this.prisma.conversation.findMany({
      where: { organizationId, userId, deletedAt: null },
      orderBy: { updatedAt: 'desc' },
      take: 30,
    });
    return conversations.map((conversation) => toConversationDto(conversation));
  }

  async getConversation(userId: string, organizationId: string, conversationId: string): Promise<ConversationDto> {
    await this.acl.requireRole(userId, organizationId);
    const conversation = await this.prisma.conversation.findFirst({
      where: { id: conversationId, organizationId, userId, deletedAt: null },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });
    if (!conversation) throw new NotFoundException('Conversation not found');
    return toConversationDto(conversation);
  }

  /** Stores thumbs feedback and forwards it to HydraDB so retrieval can learn. */
  async submitFeedback(
    userId: string,
    organizationId: string,
    messageId: string,
    dto: FeedbackDto,
  ): Promise<ChatMessageDto> {
    await this.acl.requireRole(userId, organizationId);
    const message = await this.prisma.chatMessage.findFirst({
      where: { id: messageId, organizationId, role: 'ASSISTANT', conversation: { userId } },
    });
    if (!message) throw new NotFoundException('Message not found');

    const updated = await this.prisma.chatMessage.update({
      where: { id: messageId },
      data: { feedback: dto.rating, feedbackComment: dto.comment ?? null },
    });

    if (message.hydraRequestId && this.hydra.isConfigured()) {
      const space = await this.prisma.brainSpace.findUnique({ where: { organizationId } });
      if (space) {
        this.hydra
          .submitFeedback({
            database: space.hydraDatabase,
            collection: space.collection,
            requestId: message.hydraRequestId,
            rating: dto.rating === 1 ? 'positive' : 'negative',
            comment: dto.comment,
            metadata: { messageId },
          })
          .catch((error: Error) => this.logger.warn(`HydraDB feedback failed: ${error.message}`));
      }
    }
    return toChatMessageDto(updated);
  }

  private async resolveConversation(identity: BrainIdentity, conversationId: string | undefined, question: string) {
    if (conversationId) {
      const existing = await this.prisma.conversation.findFirst({
        where: { id: conversationId, organizationId: identity.organizationId, userId: identity.userId, deletedAt: null },
      });
      if (!existing) throw new NotFoundException('Conversation not found');
      return existing;
    }
    return this.prisma.conversation.create({
      data: {
        organizationId: identity.organizationId,
        userId: identity.userId,
        title: question.length > 80 ? `${question.slice(0, 77)}...` : question,
      },
    });
  }

  /** Relays a completed answer to the client in small chunks so it renders progressively. */
  private async relay(answer: string, emit: AskEmitter, signal?: AbortSignal): Promise<void> {
    const pieces = answer.match(/\S+\s*/g) ?? [answer];
    for (let index = 0; index < pieces.length; index += 4) {
      if (signal?.aborted) return;
      emit({ type: 'token', delta: pieces.slice(index, index + 4).join('') });
      await sleep(12);
    }
  }
}
