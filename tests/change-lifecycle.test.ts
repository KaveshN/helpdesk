import { describe, expect, it } from 'vitest';
import { ApprovalDecision, CabApprovalMode, ChangeStatus } from '@/generated/prisma/enums';
import {
  allowedTransitions,
  canTransition,
  evaluateCab,
  isEditable,
  isTerminal,
  noticeShortfallHours,
  requiresCabApproval,
  type ApprovalVote,
} from '@/lib/changes/lifecycle';

const vote = (over: Partial<ApprovalVote> = {}): ApprovalVote => ({
  decision: ApprovalDecision.PENDING,
  isVoting: true,
  isChair: false,
  ...over,
});
const approve = (over: Partial<ApprovalVote> = {}) =>
  vote({ decision: ApprovalDecision.APPROVED, ...over });
const reject = (over: Partial<ApprovalVote> = {}) =>
  vote({ decision: ApprovalDecision.REJECTED, ...over });
const abstain = (over: Partial<ApprovalVote> = {}) =>
  vote({ decision: ApprovalDecision.ABSTAINED, ...over });

describe('state machine', () => {
  it('walks the happy path', () => {
    const path: ChangeStatus[] = [
      ChangeStatus.DRAFT,
      ChangeStatus.PENDING_APPROVAL,
      ChangeStatus.APPROVED,
      ChangeStatus.SCHEDULED,
      ChangeStatus.IN_PROGRESS,
      ChangeStatus.COMPLETED,
    ];
    for (let i = 0; i < path.length - 1; i += 1) {
      expect(canTransition(path[i]!, path[i + 1]!), `${path[i]} -> ${path[i + 1]}`).toBe(true);
    }
  });

  it('refuses to skip approval', () => {
    expect(canTransition(ChangeStatus.PENDING_APPROVAL, ChangeStatus.IN_PROGRESS)).toBe(false);
    expect(canTransition(ChangeStatus.DRAFT, ChangeStatus.SCHEDULED)).toBe(false);
    expect(canTransition(ChangeStatus.DRAFT, ChangeStatus.COMPLETED)).toBe(false);
  });

  it('allows a pre-approved change to go straight from draft to approved', () => {
    expect(canTransition(ChangeStatus.DRAFT, ChangeStatus.APPROVED)).toBe(true);
  });

  it('lets a rejected or rolled-back change be revised', () => {
    expect(canTransition(ChangeStatus.REJECTED, ChangeStatus.DRAFT)).toBe(true);
    expect(canTransition(ChangeStatus.ROLLED_BACK, ChangeStatus.DRAFT)).toBe(true);
  });

  it('lets a failed implementation roll back or retry', () => {
    expect(canTransition(ChangeStatus.FAILED, ChangeStatus.ROLLED_BACK)).toBe(true);
    expect(canTransition(ChangeStatus.FAILED, ChangeStatus.IN_PROGRESS)).toBe(true);
    expect(canTransition(ChangeStatus.FAILED, ChangeStatus.COMPLETED)).toBe(false);
  });

  it('treats completed and cancelled as terminal', () => {
    expect(allowedTransitions(ChangeStatus.COMPLETED)).toEqual([]);
    expect(allowedTransitions(ChangeStatus.CANCELLED)).toEqual([]);
    expect(isTerminal(ChangeStatus.COMPLETED)).toBe(true);
    expect(isTerminal(ChangeStatus.ROLLED_BACK)).toBe(false);
  });

  it('cannot cancel a change that is already being implemented', () => {
    // Mid-implementation the answer is fail-then-roll-back, not cancel.
    expect(canTransition(ChangeStatus.IN_PROGRESS, ChangeStatus.CANCELLED)).toBe(false);
  });

  it('only allows free editing before submission', () => {
    expect(isEditable(ChangeStatus.DRAFT)).toBe(true);
    expect(isEditable(ChangeStatus.REJECTED)).toBe(true);
    expect(isEditable(ChangeStatus.PENDING_APPROVAL)).toBe(false);
    expect(isEditable(ChangeStatus.APPROVED)).toBe(false);
  });

  it('defines transitions for every status', () => {
    for (const status of Object.values(ChangeStatus)) {
      expect(allowedTransitions(status), status).toBeDefined();
    }
  });
});

describe('evaluateCab - QUORUM', () => {
  const quorum = (votes: ApprovalVote[], q = 2, final = true) =>
    evaluateCab(CabApprovalMode.QUORUM, q, final, votes);

  it('stays pending below quorum', () => {
    const result = quorum([approve(), vote(), vote()]);
    expect(result.outcome).toBe(ChangeStatus.PENDING_APPROVAL);
    expect(result.approvals).toBe(1);
    expect(result.required).toBe(2);
  });

  it('approves on reaching quorum, without waiting for the rest', () => {
    const result = quorum([approve(), approve(), vote()]);
    expect(result.outcome).toBe(ChangeStatus.APPROVED);
  });

  it('rejects immediately on one rejection when rejectionIsFinal', () => {
    expect(quorum([approve(), reject(), vote()]).outcome).toBe(ChangeStatus.REJECTED);
  });

  it('keeps deliberating through a rejection when rejectionIsFinal is false', () => {
    const result = quorum([approve(), reject(), vote()], 2, false);
    expect(result.outcome).toBe(ChangeStatus.PENDING_APPROVAL);
  });

  it('rejects when everyone has voted but quorum was not met', () => {
    // The case that would otherwise hang forever.
    const result = quorum([approve(), abstain(), abstain()], 2, false);
    expect(result.outcome).toBe(ChangeStatus.REJECTED);
    expect(result.reason).toMatch(/only 1 of 2 required/);
  });

  it('ignores non-voting members entirely', () => {
    const result = quorum([approve(), approve({ isVoting: false }), vote()]);
    expect(result.outcome).toBe(ChangeStatus.PENDING_APPROVAL);
    expect(result.approvals).toBe(1);
  });

  it('treats a quorum of 0 as 1', () => {
    expect(quorum([approve()], 0).outcome).toBe(ChangeStatus.APPROVED);
  });

  it('stays pending with no votes at all', () => {
    expect(quorum([vote(), vote()]).outcome).toBe(ChangeStatus.PENDING_APPROVAL);
  });
});

describe('evaluateCab - ALL_MEMBERS', () => {
  const all = (votes: ApprovalVote[]) => evaluateCab(CabApprovalMode.ALL_MEMBERS, 0, true, votes);

  it('needs every voting member', () => {
    expect(all([approve(), approve(), vote()]).outcome).toBe(ChangeStatus.PENDING_APPROVAL);
    expect(all([approve(), approve(), approve()]).outcome).toBe(ChangeStatus.APPROVED);
  });

  it('lets an abstention shrink the pool rather than block', () => {
    // 2 approvals + 1 abstention = everyone who will vote has approved.
    expect(all([approve(), approve(), abstain()]).outcome).toBe(ChangeStatus.APPROVED);
  });

  it('does not approve on an all-abstain board', () => {
    const result = all([abstain(), abstain()]);
    expect(result.outcome).toBe(ChangeStatus.REJECTED);
  });
});

describe('evaluateCab - ANY_MEMBER and CHAIR_ONLY', () => {
  it('approves on a single approval in ANY_MEMBER', () => {
    expect(
      evaluateCab(CabApprovalMode.ANY_MEMBER, 5, true, [approve(), vote(), vote()]).outcome,
    ).toBe(ChangeStatus.APPROVED);
  });

  it('only listens to the chair in CHAIR_ONLY', () => {
    const votes = [approve(), approve(), vote({ isChair: true })];
    expect(evaluateCab(CabApprovalMode.CHAIR_ONLY, 2, true, votes).outcome).toBe(
      ChangeStatus.PENDING_APPROVAL,
    );
    expect(
      evaluateCab(CabApprovalMode.CHAIR_ONLY, 2, true, [reject(), approve({ isChair: true })])
        .outcome,
    ).toBe(ChangeStatus.APPROVED);
  });

  it('reports a missing chair rather than approving', () => {
    const result = evaluateCab(CabApprovalMode.CHAIR_ONLY, 1, true, [approve(), approve()]);
    expect(result.outcome).toBe(ChangeStatus.PENDING_APPROVAL);
    expect(result.reason).toMatch(/No CAB chair/);
  });
});

describe('requiresCabApproval', () => {
  it('skips the CAB for a pre-approved (standard) change even at high risk', () => {
    expect(requiresCabApproval({ typeIsPreApproved: true, riskRequiresCab: true })).toBe(false);
  });

  it('otherwise follows the risk level', () => {
    expect(requiresCabApproval({ typeIsPreApproved: false, riskRequiresCab: true })).toBe(true);
    expect(requiresCabApproval({ typeIsPreApproved: false, riskRequiresCab: false })).toBe(false);
  });
});

describe('noticeShortfallHours', () => {
  const submittedAt = new Date('2026-09-14T08:00:00.000Z');

  it('is zero when notice is sufficient', () => {
    expect(
      noticeShortfallHours({
        submittedAt,
        plannedStartAt: new Date('2026-09-17T08:00:00.000Z'),
        minimumNoticeHours: 48,
      }),
    ).toBe(0);
  });

  it('reports the shortfall when a change is rushed', () => {
    expect(
      noticeShortfallHours({
        submittedAt,
        plannedStartAt: new Date('2026-09-15T08:00:00.000Z'), // 24h
        minimumNoticeHours: 48,
      }),
    ).toBe(24);
  });

  it('is zero when no notice period or start date is set', () => {
    expect(
      noticeShortfallHours({ submittedAt, plannedStartAt: null, minimumNoticeHours: 48 }),
    ).toBe(0);
    expect(
      noticeShortfallHours({ submittedAt, plannedStartAt: submittedAt, minimumNoticeHours: 0 }),
    ).toBe(0);
  });
});
