export const CLAIM_EXTRACTION_PROMPT = `You audit internal company documents for facts that can go out of date.
From the document, extract up to 4 specific, checkable claims whose value could change over time:
policy values (windows, limits, percentages, prices), dates and deadlines (launch dates, ETAs), owners, or statuses.
Skip generic statements, history, and anything without a concrete value.
- subject: the thing the claim is about (e.g. "refund policy", "Atlas GA launch")
- attribute: the property (e.g. "refund window", "launch date")
- value: the concrete value as written (e.g. "14 days", "2026-09-30")
- quote: the exact sentence from the document
Return {"claims": []} when there is nothing checkable.`;

export const VERIFY_PROMPT = `You check whether claims in a company document are still true, using other company sources
(Slack, email, meeting notes, support tickets, engineering issues, other docs). For each claim decide:
- "contradicted": at least one listed source states a DIFFERENT value for the same subject and attribute, and that source is
  newer than the document or records an explicit decision or change.
- "consistent": the sources agree, or none states a different value.
- "unsupported": the sources are unrelated to the claim.
Rules:
- Use only the listed sources. evidence_ids must be ids listed under that claim, citing the sources that state the different (current) value.
- current_value is the short value those sources state (e.g. "30 days", "2026-10-14"); for non-contradicted claims repeat the claim's value.
- explanation is one plain sentence for a busy reader.
- Be conservative: rumours, proposals and open questions are not contradictions.
Return one result per claim, using its claim_index.`;

export const FIX_PROMPT = `You are KlennyBrain's remediation agent. Given an insight the company brain detected and its evidence,
propose concrete follow-up actions that a human will review and approve:
1. doc_update: only when a knowledge-base document is attached and it is stale or contradicts newer decisions. Return the
   COMPLETE corrected markdown body: keep its structure, tone and unrelated content; change only what the evidence supports;
   update any "last updated" line to today's date; append a short "Changelog" line naming the source of the change.
   Otherwise set needed=false and leave corrected_body and reason empty.
2. slack_message: a concise Slack message (Slack mrkdwn, under 600 characters) telling the team what changed or what is
   overdue, naming the owners.
3. github_issue: a tracking issue with an imperative title under 80 characters, a markdown body with context, the evidence
   (source titles and dates) and a task checklist, and labels chosen from: docs, knowledge-gap, launch, support, follow-up.
Never invent facts that are not in the insight or the evidence.`;

export const CLAIMS_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    claims: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          subject: { type: 'string' },
          attribute: { type: 'string' },
          value: { type: 'string' },
          quote: { type: 'string' },
        },
        required: ['subject', 'attribute', 'value', 'quote'],
        additionalProperties: false,
      },
    },
  },
  required: ['claims'],
  additionalProperties: false,
};

export const VERDICTS_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          claim_index: { type: 'integer' },
          verdict: { type: 'string', enum: ['consistent', 'contradicted', 'unsupported'] },
          current_value: { type: 'string' },
          evidence_ids: { type: 'array', items: { type: 'string' } },
          explanation: { type: 'string' },
        },
        required: ['claim_index', 'verdict', 'current_value', 'evidence_ids', 'explanation'],
        additionalProperties: false,
      },
    },
  },
  required: ['results'],
  additionalProperties: false,
};

export const FIX_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    doc_update: {
      type: 'object',
      properties: {
        needed: { type: 'boolean' },
        corrected_body: { type: 'string' },
        reason: { type: 'string' },
      },
      required: ['needed', 'corrected_body', 'reason'],
      additionalProperties: false,
    },
    slack_message: {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text'],
      additionalProperties: false,
    },
    github_issue: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        body: { type: 'string' },
        labels: { type: 'array', items: { type: 'string' } },
      },
      required: ['title', 'body', 'labels'],
      additionalProperties: false,
    },
  },
  required: ['doc_update', 'slack_message', 'github_issue'],
  additionalProperties: false,
};
