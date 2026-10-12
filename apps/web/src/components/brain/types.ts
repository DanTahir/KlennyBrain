import type {
  AgentActionDto,
  Citation,
  GraphPath,
  PersonaDto,
  ToolCallTrace,
} from '@app-starter/shared';

export interface UiMessage {
  id: string; // client-side id
  role: 'USER' | 'ASSISTANT';
  content: string; // markdown; citation markers look like [3] (occasionally grouped like [1, 2])
  citations: Citation[];
  toolTrace: ToolCallTrace[];
  graphPaths: GraphPath[];
  actions: AgentActionDto[];
  status?: string | null; // live progress text while streaming
  streaming?: boolean;
  error?: string | null;
  feedback?: 1 | -1 | null;
  viewAs?: PersonaDto | null;
  messageId?: string | null; // server ChatMessage id, set when the answer is done (needed for feedback)
}