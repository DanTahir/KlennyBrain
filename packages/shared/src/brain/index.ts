/**
 * KlennyBrain shared contract: DTOs and stream events exchanged between the
 * API (apps/api) and the web app (apps/web). Keep this file the single source
 * of truth; both sides import from `@app-starter/shared`.
 */

// ---------------------------------------------------------------------------
// Enums (string unions mirror the Prisma enums)
// ---------------------------------------------------------------------------

export type KnowledgeKind = 'message' | 'email' | 'ticket' | 'meeting' | 'knowledge_base';

/** Logical origin of a record; stored in HydraDB metadata as `source_system`. */
export type SourceSystem = 'slack' | 'email' | 'doc' | 'meeting' | 'ticket' | 'issue';

export type BrainStatus = 'NOT_PROVISIONED' | 'PROVISIONING' | 'READY' | 'ERROR';
export type SourceType = 'DEMO' | 'SLACK' | 'GITHUB';
export type SourceStatus = 'IDLE' | 'SYNCING' | 'READY' | 'ERROR';
export type SyncJobStatus = 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';

export type InsightType = 'CONTRADICTION' | 'STALE_DOC' | 'DECISION' | 'ACTION_ITEM';
export type InsightStatus = 'OPEN' | 'RESOLVED' | 'DISMISSED';
export type InsightSeverity = 'LOW' | 'MEDIUM' | 'HIGH';

export type AgentActionType =
  | 'CREATE_GITHUB_ISSUE'
  | 'POST_SLACK_MESSAGE'
  | 'UPDATE_KNOWLEDGE_DOC'
  | 'SEND_EMAIL';
export type AgentActionStatus = 'PROPOSED' | 'APPROVED' | 'EXECUTED' | 'FAILED' | 'REJECTED';

export type ChatRole = 'USER' | 'ASSISTANT';

// ---------------------------------------------------------------------------
// Brain space, sources, sync jobs
// ---------------------------------------------------------------------------

export interface BrainStatsDto {
  items: number;
  byKind: Record<string, number>;
  bySourceSystem: Record<string, number>;
  people: number;
  openInsights: number;
  pendingActions: number;
}

export interface PersonaDto {
  email: string;
  name: string;
  title: string | null;
  department: string | null;
  groups: string[];
}

export interface BrainViewerDto {
  email: string;
  role: 'OWNER' | 'ADMIN' | 'MEMBER';
  /** OWNER/ADMIN may ask "as" another person (audited). */
  canViewAs: boolean;
  person: PersonaDto | null;
}

export interface BrainSpaceDto {
  organizationId: string;
  status: BrainStatus;
  hydraDatabase: string | null;
  collection: string;
  error: string | null;
  /** Integration readiness (no secret values). */
  integrations: { hydra: boolean; llm: boolean; slack: boolean; github: boolean };
  stats: BrainStatsDto;
  viewer: BrainViewerDto;
}

export interface SyncJobDto {
  id: string;
  sourceId: string;
  status: SyncJobStatus;
  total: number;
  processed: number;
  failed: number;
  /** Items HydraDB reports as searchable (graph_creation or completed). */
  indexed: number;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
  createdAt: string;
}

export interface SourceDto {
  id: string;
  type: SourceType;
  name: string;
  status: SourceStatus;
  itemCount: number;
  lastSyncedAt: string | null;
  error: string | null;
  latestJob: SyncJobDto | null;
}

export interface CreateSourceRequest {
  type: SourceType;
  name?: string;
}

// ---------------------------------------------------------------------------
// Ask the Brain
// ---------------------------------------------------------------------------

export interface Citation {
  /** 1-based number used in the answer text as [n]. */
  n: number;
  hydraId: string;
  title: string;
  kind: KnowledgeKind | string;
  sourceSystem: SourceSystem | string | null;
  provider: string;
  url: string | null;
  author: string | null;
  occurredAt: string | null;
  snippet: string;
  score: number | null;
}

export interface GraphPath {
  source: string;
  predicate: string;
  target: string;
  sourceType?: string;
  targetType?: string;
  /** hydraIds of the sources that support this edge, when known. */
  evidence?: string[];
}

export interface ToolCallTrace {
  id: string;
  name: string;
  args: Record<string, unknown>;
  resultSummary: string;
  durationMs: number;
  status: 'ok' | 'error';
}

export interface AskRequest {
  question: string;
  conversationId?: string;
  /** OWNER/ADMIN only: answer with this person's permissions. */
  viewAsEmail?: string;
}

export interface AskResponse {
  messageId: string;
  conversationId: string;
  answer: string;
  citations: Citation[];
  toolTrace: ToolCallTrace[];
  graphPaths: GraphPath[];
  actions: AgentActionDto[];
  hydraRequestId: string | null;
  viewAs: PersonaDto | null;
}

/**
 * Server-sent events from `POST /api/organizations/:id/ask/stream`.
 * Wire format: `event: <type>\ndata: <JSON of the whole event>\n\n`.
 */
export type AskStreamEvent =
  | { type: 'status'; message: string }
  | { type: 'tool_call'; call: ToolCallTrace }
  | { type: 'sources'; citations: Citation[] }
  | { type: 'graph'; paths: GraphPath[] }
  | { type: 'token'; delta: string }
  | { type: 'action_proposed'; action: AgentActionDto }
  | { type: 'heartbeat' }
  | {
      type: 'done';
      messageId: string;
      conversationId: string;
      hydraRequestId: string | null;
      viewAs: PersonaDto | null;
    }
  | { type: 'error'; message: string; retryable: boolean };

export type AskStreamEventType = AskStreamEvent['type'];

export interface ChatMessageDto {
  id: string;
  role: ChatRole;
  content: string;
  citations: Citation[];
  toolTrace: ToolCallTrace[];
  graphPaths: GraphPath[];
  hydraRequestId: string | null;
  feedback: 1 | -1 | null;
  viewAsEmail: string | null;
  createdAt: string;
}

export interface ConversationDto {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages?: ChatMessageDto[];
}

export interface FeedbackRequest {
  rating: 1 | -1;
  comment?: string;
}

// ---------------------------------------------------------------------------
// Insights and agent actions
// ---------------------------------------------------------------------------

export interface InsightDto {
  id: string;
  type: InsightType;
  title: string;
  summary: string;
  severity: InsightSeverity;
  status: InsightStatus;
  evidence: Citation[];
  entities: string[];
  ownerEmail: string | null;
  dueAt: string | null;
  occurredAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UpdateInsightRequest {
  status: InsightStatus;
}

export interface AgentActionDto {
  id: string;
  type: AgentActionType;
  status: AgentActionStatus;
  title: string;
  summary: string;
  payload: Record<string, unknown>;
  result: { url?: string; [key: string]: unknown } | null;
  error: string | null;
  conversationId: string | null;
  insightId: string | null;
  requestedBy: { id: string; name: string | null; email: string } | null;
  approvedBy: { id: string; name: string | null; email: string } | null;
  createdAt: string;
  executedAt: string | null;
}

// ---------------------------------------------------------------------------
// Graph explorer
// ---------------------------------------------------------------------------

export interface GraphNodeDto {
  id: string;
  label: string;
  type: 'person' | 'source' | 'entity' | 'project' | 'customer';
  kind?: string;
  weight?: number;
}

export interface GraphLinkDto {
  source: string;
  target: string;
  predicate: string;
}

export interface GraphDto {
  nodes: GraphNodeDto[];
  links: GraphLinkDto[];
}
