import { AgentAction } from '@prisma/client';
import type { AgentActionDto } from '@app-starter/shared';

export const ACTION_PEOPLE_INCLUDE = {
  requestedBy: { select: { id: true, name: true, email: true } },
  approvedBy: { select: { id: true, name: true, email: true } },
} as const;

type ActionPerson = { id: string; name: string | null; email: string } | null;

export type AgentActionWithPeople = AgentAction & {
  requestedBy?: ActionPerson;
  approvedBy?: ActionPerson;
};

export function toAgentActionDto(action: AgentActionWithPeople): AgentActionDto {
  return {
    id: action.id,
    type: action.type,
    status: action.status,
    title: action.title,
    summary: action.summary,
    payload: (action.payload ?? {}) as Record<string, unknown>,
    result: (action.result ?? null) as AgentActionDto['result'],
    error: action.error,
    conversationId: action.conversationId,
    insightId: action.insightId,
    requestedBy: action.requestedBy ?? null,
    approvedBy: action.approvedBy ?? null,
    createdAt: action.createdAt.toISOString(),
    executedAt: action.executedAt ? action.executedAt.toISOString() : null,
  };
}
