import { AgentActionStatus, OrgRole } from '@prisma/client';
import { canApproveActions, canProposeActions, canTransition } from './action-policy';

describe('action authorization', () => {
  it('lets any member propose actions', () => {
    // Act
    const actualMember = canProposeActions(OrgRole.MEMBER);
    const actualNobody = canProposeActions(null);

    // Assert
    expect(actualMember).toBe(true);
    expect(actualNobody).toBe(false);
  });

  it('only lets owners and admins approve actions', () => {
    // Act
    const actualOwner = canApproveActions(OrgRole.OWNER);
    const actualAdmin = canApproveActions(OrgRole.ADMIN);
    const actualMember = canApproveActions(OrgRole.MEMBER);
    const actualNobody = canApproveActions(undefined);

    // Assert
    expect(actualOwner).toBe(true);
    expect(actualAdmin).toBe(true);
    expect(actualMember).toBe(false);
    expect(actualNobody).toBe(false);
  });
});

describe('canTransition', () => {
  it('allows approving or rejecting a proposed action', () => {
    // Act
    const actualApprove = canTransition(AgentActionStatus.PROPOSED, AgentActionStatus.APPROVED);
    const actualReject = canTransition(AgentActionStatus.PROPOSED, AgentActionStatus.REJECTED);

    // Assert
    expect(actualApprove).toBe(true);
    expect(actualReject).toBe(true);
  });

  it('never re-runs an executed or rejected action', () => {
    // Act
    const actualExecuted = canTransition(AgentActionStatus.EXECUTED, AgentActionStatus.APPROVED);
    const actualRejected = canTransition(AgentActionStatus.REJECTED, AgentActionStatus.APPROVED);

    // Assert
    expect(actualExecuted).toBe(false);
    expect(actualRejected).toBe(false);
  });

  it('allows retrying a failed action', () => {
    // Act
    const actual = canTransition(AgentActionStatus.FAILED, AgentActionStatus.APPROVED);

    // Assert
    expect(actual).toBe(true);
  });
});
