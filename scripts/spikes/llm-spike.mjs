#!/usr/bin/env node
/**
 * OpenRouter LLM spike: for the answer and fast models, measures streaming
 * time-to-first-token, checks tool calling and json_schema structured output.
 *
 * Usage: node scripts/spikes/llm-spike.mjs
 */
import { apiRequire, describeError, loadApiEnv } from './_env.mjs';

const env = loadApiEnv();
if (!env.OPENROUTER_API_KEY) {
  console.error('OPENROUTER_API_KEY missing in apps/api/.env');
  process.exit(1);
}
const OpenAIModule = apiRequire('openai');
const OpenAI = OpenAIModule.default ?? OpenAIModule.OpenAI ?? OpenAIModule;
const client = new OpenAI({
  apiKey: env.OPENROUTER_API_KEY,
  baseURL: 'https://openrouter.ai/api/v1',
  defaultHeaders: { 'X-OpenRouter-Title': 'KlennyBrain', 'HTTP-Referer': 'https://github.com/DanTahir/KlennyBrain' },
  timeout: 90_000,
});

const models = [
  env.LLM_ANSWER_MODEL || 'anthropic/claude-sonnet-5.5',
  env.LLM_FAST_MODEL || 'anthropic/claude-haiku-5.5',
];

const tools = [
  {
    type: 'function',
    function: {
      name: 'search_knowledge',
      description: 'Search the company brain (Slack, docs, tickets, email, meetings).',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string' }, source_type: { type: 'string' } },
        required: ['query'],
      },
    },
  },
];

async function streamTtft(model) {
  const t0 = Date.now();
  let ttft = null;
  let text = '';
  const stream = await client.chat.completions.create({
    model,
    stream: true,
    max_tokens: 200,
    reasoning: { effort: 'low' },
    messages: [{ role: 'user', content: 'In two sentences, what is a company knowledge graph?' }],
  });
  let servedBy = null;
  for await (const chunk of stream) {
    servedBy ??= chunk.model;
    const d = chunk.choices?.[0]?.delta?.content;
    if (d) {
      ttft ??= Date.now() - t0;
      text += d;
    }
  }
  return { ttftMs: ttft, totalMs: Date.now() - t0, servedBy, chars: text.length, sample: text.slice(0, 120) };
}

async function toolCall(model) {
  const t0 = Date.now();
  const r = await client.chat.completions.create({
    model,
    max_tokens: 300,
    reasoning: { effort: 'low' },
    tools,
    tool_choice: 'auto',
    messages: [
      { role: 'system', content: 'Answer only using tool results. Always search first.' },
      { role: 'user', content: 'What is blocking the Atlas launch?' },
    ],
  });
  const msg = r.choices?.[0]?.message;
  return {
    ms: Date.now() - t0,
    finish: r.choices?.[0]?.finish_reason,
    toolCalls: (msg?.tool_calls ?? []).map((t) => ({ name: t.function?.name, args: t.function?.arguments })),
    usage: r.usage,
  };
}

async function jsonSchema(model) {
  const t0 = Date.now();
  const r = await client.chat.completions.create({
    model,
    max_tokens: 400,
    reasoning: { effort: 'low' },
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'claims',
        strict: true,
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            claims: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: { subject: { type: 'string' }, attribute: { type: 'string' }, value: { type: 'string' } },
                required: ['subject', 'attribute', 'value'],
              },
            },
          },
          required: ['claims'],
        },
      },
    },
    messages: [
      {
        role: 'user',
        content:
          'Extract factual claims: "Our refund window is 30 days since August. The Atlas launch moved to Oct 14."',
      },
    ],
  });
  const content = r.choices?.[0]?.message?.content ?? '';
  let parsed = null;
  try {
    parsed = JSON.parse(content);
  } catch {
    parsed = `UNPARSEABLE: ${content.slice(0, 200)}`;
  }
  return { ms: Date.now() - t0, parsed };
}

for (const model of models) {
  console.log(`\n##### ${model}`);
  for (const [name, fn] of [
    ['stream', streamTtft],
    ['tools', toolCall],
    ['json_schema', jsonSchema],
  ]) {
    try {
      console.log(name, JSON.stringify(await fn(model)));
    } catch (e) {
      console.log(name, 'FAILED', JSON.stringify(describeError(e)).slice(0, 600));
    }
  }
}
