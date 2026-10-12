import { AgentActionStatus, OrgRole } from '@prisma/client';

/** Any member may ask the agent to propose actions; only owners and admins may let them run. */
export const APPROVER_ROLES: OrgRole[] = [OrgRole.OWNER, OrgRole.ADMIN];

export function canProposeActions(role: OrgRole | null | undefined): boolean {
  return Boolean(role);
}

export function canApproveActions(role: OrgRole | null | undefined): boolean {
  return Boolean(role && APPROVER_ROLES.includes(role));
}

const TRANSITIONS: Record<AgentActionStatus, AgentActionStatus[]> = {
  [AgentActionStatus.PROPOSED]: [AgentActionStatus.APPROVED, AgentActionStatus.REJECTED],
  [AgentActionStatus.APPROVED]: [AgentActionStatus.EXECUTED, AgentActionStatus.FAILED],
  // A failed action can be retried (approved again) or abandoned.
  [AgentActionStatus.FAILED]: [AgentActionStatus.APPROVED, AgentActionStatus.REJECTED],
  [AgentActionStatus.EXECUTED]: [],
  [AgentActionStatus.REJECTED]: [],
};

export function canTransition(from: AgentActionStatus, to: AgentActionStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}
