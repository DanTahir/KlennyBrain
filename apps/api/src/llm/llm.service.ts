import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import type {
  ChatCompletion,
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from 'openai/resources/chat/completions';

export type LlmTier = 'answer' | 'fast';

export interface LlmChatRequest {
  tier?: LlmTier;
  messages: ChatCompletionMessageParam[];
  tools?: ChatCompletionTool[];
  toolChoice?: 'auto' | 'none' | 'required';
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
}

export interface LlmJsonRequest extends LlmChatRequest {
  schemaName: string;
  schema: Record<string, unknown>;
}

const DEFAULT_MODELS: Record<LlmTier, { primary: string; fallback: string }> = {
  answer: { primary: 'anthropic/claude-sonnet-5.5', fallback: 'openai/gpt-6.1-sol' },
  fast: { primary: 'anthropic/claude-haiku-5.5', fallback: 'openai/gpt-6-luna' },
};

/** OpenRouter-backed chat client (OpenAI-compatible API) with model fallbacks. */
@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);
  private client: OpenAI | null = null;

  constructor(private readonly config: ConfigService) {}

  isConfigured(): boolean {
    return Boolean(this.config.get<string>('OPENROUTER_API_KEY'));
  }

  modelFor(tier: LlmTier): string {
    const key = tier === 'fast' ? 'LLM_FAST_MODEL' : 'LLM_ANSWER_MODEL';
    return this.config.get<string>(key) || DEFAULT_MODELS[tier].primary;
  }

  private fallbackFor(tier: LlmTier): string {
    const key = tier === 'fast' ? 'LLM_FAST_FALLBACK_MODEL' : 'LLM_ANSWER_FALLBACK_MODEL';
    return this.config.get<string>(key) || DEFAULT_MODELS[tier].fallback;
  }

  private getClient(): OpenAI {
    if (!this.client) {
      const apiKey = this.config.get<string>('OPENROUTER_API_KEY');
      if (!apiKey) throw new Error('OpenRouter is not configured (OPENROUTER_API_KEY is empty)');
      this.client = new OpenAI({
        apiKey,
        baseURL: 'https://openrouter.ai/api/v1',
        timeout: 60_000,
        maxRetries: 1,
        defaultHeaders: {
          'HTTP-Referer': 'https://github.com/DanTahir/KlennyBrain',
          'X-Title': 'KlennyBrain',
          'X-OpenRouter-Title': 'KlennyBrain',
        },
      });
    }
    return this.client;
  }

  private buildBody(request: LlmChatRequest, extra: Record<string, unknown> = {}): Record<string, unknown> {
    const tier = request.tier ?? 'answer';
    const model = this.modelFor(tier);
    return {
      model,
      models: [model, this.fallbackFor(tier)],
      messages: request.messages,
      ...(request.tools?.length ? { tools: request.tools, tool_choice: request.toolChoice ?? 'auto' } : {}),
      max_tokens: request.maxTokens ?? 1500,
      temperature: request.temperature ?? 0.2,
      ...(tier === 'answer' ? { reasoning: { effort: 'low' } } : {}),
      ...extra,
    };
  }

  async chat(request: LlmChatRequest): Promise<ChatCompletion> {
    const body = this.buildBody(request, { stream: false });
    return this.getClient().chat.completions.create(
      body as unknown as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
      { signal: request.signal },
    );
  }

  /** Streams assistant text deltas. */
  async *streamText(request: LlmChatRequest): AsyncGenerator<string> {
    const body = this.buildBody(request, { stream: true });
    const stream = await this.getClient().chat.completions.create(
      body as unknown as OpenAI.Chat.ChatCompletionCreateParamsStreaming,
      { signal: request.signal },
    );
    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta?.content;
      if (delta) yield delta;
    }
  }

  /** Structured output via `response_format: json_schema`; defaults to the fast tier. */
  async json<T>(request: LlmJsonRequest): Promise<T> {
    const body = this.buildBody(
      { ...request, tier: request.tier ?? 'fast' },
      {
        stream: false,
        response_format: {
          type: 'json_schema',
          json_schema: { name: request.schemaName, strict: true, schema: request.schema },
        },
      },
    );
    const completion = await this.getClient().chat.completions.create(
      body as unknown as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
      { signal: request.signal },
    );
    const content = completion.choices?.[0]?.message?.content ?? '';
    return LlmService.parseJson<T>(content);
  }

  static parseJson<T>(content: string): T {
    const trimmed = content
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '');
    try {
      return JSON.parse(trimmed) as T;
    } catch {
      const start = trimmed.indexOf('{');
      const end = trimmed.lastIndexOf('}');
      if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1)) as T;
      throw new Error('LLM did not return valid JSON');
    }
  }
}
