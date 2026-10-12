import type {
  AgentActionDto,
  AgentActionStatus,
  AskRequest,
  AskResponse,
  BrainSpaceDto,
  ChatMessageDto,
  ConversationDto,
  CreateSourceRequest,
  FeedbackRequest,
  FixInsightResponse,
  InsightAnalysisDto,
  InsightDto,
  InsightStatus,
  InsightType,
  PersonaDto,
  SourceDto,
  SyncJobDto,
  UpdateInsightRequest,
} from '@app-starter/shared';
import { apiClient } from './api-client';

function base(organizationId: string): string {
  return `/api/organizations/${encodeURIComponent(organizationId)}`;
}

function id(value: string): string {
  return encodeURIComponent(value);
}

/** Build a `?a=b&c=d` query string, omitting undefined/empty values. */
function query(params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') {
      search.set(key, value);
    }
  }
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}

export const brainApi = {
  /** Fetch the organization's brain space, integration readiness, stats and viewer. */
  getBrain(organizationId: string): Promise<BrainSpaceDto> {
    return apiClient.get<BrainSpaceDto>(`${base(organizationId)}/brain`);
  },

  /** Provision the HydraDB-backed brain space for the organization. */
  provision(organizationId: string): Promise<BrainSpaceDto> {
    return apiClient.post<BrainSpaceDto>(`${base(organizationId)}/brain/provision`, {});
  },

  /** Load the Northwind Robotics demo dataset and start its sync job. */
  loadDemo(organizationId: string): Promise<{ source: SourceDto; job: SyncJobDto }> {
    return apiClient.post<{ source: SourceDto; job: SyncJobDto }>(
      `${base(organizationId)}/brain/demo`,
      {},
    );
  },

  /** List all connected knowledge sources. */
  listSources(organizationId: string): Promise<SourceDto[]> {
    return apiClient.get<SourceDto[]>(`${base(organizationId)}/sources`);
  },

  /** Connect a new knowledge source. */
  createSource(organizationId: string, body: CreateSourceRequest): Promise<SourceDto> {
    return apiClient.post<SourceDto>(`${base(organizationId)}/sources`, body);
  },

  /** Start a sync job for a source. */
  syncSource(organizationId: string, sourceId: string): Promise<SyncJobDto> {
    return apiClient.post<SyncJobDto>(`${base(organizationId)}/sources/${id(sourceId)}/sync`, {});
  },

  /** List sync jobs for a source, newest first. */
  listJobs(organizationId: string, sourceId: string): Promise<SyncJobDto[]> {
    return apiClient.get<SyncJobDto[]>(`${base(organizationId)}/sources/${id(sourceId)}/jobs`);
  },

  /** List people an admin can "view as". */
  listPersonas(organizationId: string): Promise<PersonaDto[]> {
    return apiClient.get<PersonaDto[]>(`${base(organizationId)}/personas`);
  },

  /** Ask the brain a question (non-streaming). */
  ask(organizationId: string, body: AskRequest): Promise<AskResponse> {
    return apiClient.post<AskResponse>(`${base(organizationId)}/ask`, body);
  },

  /** List the current user's conversations. */
  listConversations(organizationId: string): Promise<ConversationDto[]> {
    return apiClient.get<ConversationDto[]>(`${base(organizationId)}/conversations`);
  },

  /** Fetch a conversation including its messages. */
  getConversation(organizationId: string, conversationId: string): Promise<ConversationDto> {
    return apiClient.get<ConversationDto>(
      `${base(organizationId)}/conversations/${id(conversationId)}`,
    );
  },

  /** Rate an assistant answer. */
  sendFeedback(
    organizationId: string,
    messageId: string,
    body: FeedbackRequest,
  ): Promise<ChatMessageDto> {
    return apiClient.post<ChatMessageDto>(
      `${base(organizationId)}/messages/${id(messageId)}/feedback`,
      body,
    );
  },

  /** List insights, optionally filtered by type / status, optionally viewed as another person. */
  listInsights(
    organizationId: string,
    params?: { type?: InsightType; status?: InsightStatus; viewAs?: string },
  ): Promise<InsightDto[]> {
    const qs = query({
      type: params?.type,
      status: params?.status,
      viewAs: params?.viewAs,
    });
    return apiClient.get<InsightDto[]>(`${base(organizationId)}/insights${qs}`);
  },

  /** Fetch the latest background insight-analysis run. */
  getInsightAnalysis(organizationId: string): Promise<InsightAnalysisDto> {
    return apiClient.get<InsightAnalysisDto>(`${base(organizationId)}/insights/analysis`);
  },

  /** Start a fresh insight analysis run. */
  analyzeInsights(organizationId: string): Promise<InsightAnalysisDto> {
    return apiClient.post<InsightAnalysisDto>(`${base(organizationId)}/insights/analyze`, {});
  },

  /** Update an insight's status (resolve / dismiss / reopen). */
  updateInsight(
    organizationId: string,
    insightId: string,
    body: UpdateInsightRequest,
  ): Promise<InsightDto> {
    return apiClient.patch<InsightDto>(`${base(organizationId)}/insights/${id(insightId)}`, body);
  },

  /** Ask the agent to propose (not execute) actions that fix an insight. Slow: LLM-backed. */
  fixInsight(organizationId: string, insightId: string): Promise<FixInsightResponse> {
    return apiClient.post<FixInsightResponse>(
      `${base(organizationId)}/insights/${id(insightId)}/fix`,
      {},
    );
  },

  /** List agent actions, optionally filtered by status. */
  listActions(
    organizationId: string,
    params?: { status?: AgentActionStatus },
  ): Promise<AgentActionDto[]> {
    const qs = query({ status: params?.status });
    return apiClient.get<AgentActionDto[]>(`${base(organizationId)}/actions${qs}`);
  },

  /** Approve and execute a proposed agent action. */
  approveAction(organizationId: string, actionId: string): Promise<AgentActionDto> {
    return apiClient.post<AgentActionDto>(
      `${base(organizationId)}/actions/${id(actionId)}/approve`,
      {},
    );
  },

  /** Reject a proposed agent action. */
  rejectAction(organizationId: string, actionId: string): Promise<AgentActionDto> {
    return apiClient.post<AgentActionDto>(
      `${base(organizationId)}/actions/${id(actionId)}/reject`,
      {},
    );
  },
};