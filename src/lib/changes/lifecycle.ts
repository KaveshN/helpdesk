import { ApprovalDecision, CabApprovalMode, ChangeStatus } from '@/generated/prisma/enums';

/**
 * The change request lifecycle and CAB voting rules.
 *
 * Pure functions, no database: the state machine and the quorum arithmetic are
 * the two places a change-management module goes wrong, so they are testable in
 * isolation. `ChangeStatus` stays an enum (unlike ticket statuses, which are
 * per-group rows) because the code branches heavily on it -- approval gating,
 * CAB routing and implementation windows all depend on knowing exactly where in
 * the lifecycle a change is. Brief §7 asks for configurable change *types*,
 * *categories* and *risk levels*; those are tables. It does not ask for
 * configurable statuses.
 */

/** Which statuses each status may move to. Everything else is rejected. */
const TRANSITIONS: Readonly<Record<ChangeStatus, readonly ChangeStatus[]>> = {
  [ChangeStatus.DRAFT]: [
    ChangeStatus.PENDING_APPROVAL,
    ChangeStatus.APPROVED,
    ChangeStatus.CANCELLED,
  ],
  [ChangeStatus.PENDING_APPROVAL]: [
    ChangeStatus.APPROVED,
    ChangeStatus.REJECTED,
    ChangeStatus.CANCELLED,
  ],
  [ChangeStatus.APPROVED]: [
    ChangeStatus.SCHEDULED,
    ChangeStatus.IN_PROGRESS,
    ChangeStatus.CANCELLED,
  ],
  [ChangeStatus.SCHEDULED]: [ChangeStatus.IN_PROGRESS, ChangeStatus.CANCELLED],
  [ChangeStatus.IN_PROGRESS]: [ChangeStatus.COMPLETED, ChangeStatus.FAILED],
  // A failed implementation is either rolled back or retried.
  [ChangeStatus.FAILED]: [ChangeStatus.ROLLED_BACK, ChangeStatus.IN_PROGRESS],
  // Rejected and rolled-back changes can be revised and resubmitted.
  [ChangeStatus.REJECTED]: [ChangeStatus.DRAFT, ChangeStatus.CANCELLED],
  [ChangeStatus.ROLLED_BACK]: [ChangeStatus.DRAFT, ChangeStatus.CANCELLED],
  [ChangeStatus.COMPLETED]: [],
  [ChangeStatus.CANCELLED]: [],
};

export const TERMINAL_STATUSES: readonly ChangeStatus[] = [
  ChangeStatus.COMPLETED,
  ChangeStatus.CANCELLED,
];

/** Statuses that count as "in flight" for dashboards and calendars. */
export const OPEN_CHANGE_STATUSES: readonly ChangeStatus[] = [
  ChangeStatus.DRAFT,
  ChangeStatus.PENDING_APPROVAL,
  ChangeStatus.APPROVED,
  ChangeStatus.SCHEDULED,
  ChangeStatus.IN_PROGRESS,
  ChangeStatus.FAILED,
];

export function allowedTransitions(from: ChangeStatus): readonly ChangeStatus[] {
  return TRANSITIONS[from];
}

export function canTransition(from: ChangeStatus, to: ChangeStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function isTerminal(status: ChangeStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/** A change can only be edited freely before it has been submitted. */
export function isEditable(status: ChangeStatus): boolean {
  return status === ChangeStatus.DRAFT || status === ChangeStatus.REJECTED;
}

// ---------------------------------------------------------------------------
// CAB voting
// ---------------------------------------------------------------------------

export type ApprovalVote = {
  decision: ApprovalDecision;
  /** Snapshotted at request time, so later CAB edits cannot rewrite history. */
  isVoting: boolean;
  isChair: boolean;
};

/**
 * Prisma 7 generates enums as a const object plus a string-literal union, so
 * enum members cannot be used in a type position -- `Extract` narrows the union
 * instead.
 */
export type CabDecisionStatus = Extract<ChangeStatus, 'APPROVED' | 'REJECTED' | 'PENDING_APPROVAL'>;

export type CabOutcome = {
  outcome: CabDecisionStatus;
  /** Human-readable rationale, shown on the change and written to the timeline. */
  reason: string;
  approvals: number;
  rejections: number;
  required: number;
};

/**
 * Decide whether a CAB has approved, rejected, or is still deliberating.
 *
 * ABSTAIN never counts towards approval, and never blocks: an abstaining member
 * reduces the pool. That means a quorum larger than the number of members who
 * actually voted stays PENDING rather than silently passing.
 */
export function evaluateCab(
  mode: CabApprovalMode,
  quorum: number,
  rejectionIsFinal: boolean,
  votes: readonly ApprovalVote[],
): CabOutcome {
  const chairVotes = votes.filter((vote) => vote.isChair);

  if (mode === CabApprovalMode.CHAIR_ONLY) {
    const chairApproved = chairVotes.some((vote) => vote.decision === ApprovalDecision.APPROVED);
    const chairRejected = chairVotes.some((vote) => vote.decision === ApprovalDecision.REJECTED);

    if (chairRejected) {
      return {
        outcome: ChangeStatus.REJECTED,
        reason: 'Rejected by the CAB chair',
        approvals: 0,
        rejections: 1,
        required: 1,
      };
    }
    if (chairApproved) {
      return {
        outcome: ChangeStatus.APPROVED,
        reason: 'Approved by the CAB chair',
        approvals: 1,
        rejections: 0,
        required: 1,
      };
    }
    return {
      outcome: ChangeStatus.PENDING_APPROVAL,
      reason: chairVotes.length === 0 ? 'No CAB chair has been assigned' : 'Awaiting the CAB chair',
      approvals: 0,
      rejections: 0,
      required: 1,
    };
  }

  const voting = votes.filter((vote) => vote.isVoting);
  const approvals = voting.filter((vote) => vote.decision === ApprovalDecision.APPROVED).length;
  const rejections = voting.filter((vote) => vote.decision === ApprovalDecision.REJECTED).length;
  const abstentions = voting.filter((vote) => vote.decision === ApprovalDecision.ABSTAINED).length;
  const pending = voting.filter((vote) => vote.decision === ApprovalDecision.PENDING).length;

  const required =
    mode === CabApprovalMode.ALL_MEMBERS
      ? Math.max(voting.length - abstentions, 1)
      : mode === CabApprovalMode.ANY_MEMBER
        ? 1
        : Math.max(quorum, 1);

  if (rejections > 0 && rejectionIsFinal) {
    return {
      outcome: ChangeStatus.REJECTED,
      reason: `Rejected by ${rejections} of ${voting.length} voting CAB member(s)`,
      approvals,
      rejections,
      required,
    };
  }

  if (approvals >= required) {
    return {
      outcome: ChangeStatus.APPROVED,
      reason: `Approved by ${approvals} of ${required} required CAB member(s)`,
      approvals,
      rejections,
      required,
    };
  }

  // Everyone has voted but the bar was not met -- deliberation cannot continue.
  if (pending === 0) {
    return {
      outcome: ChangeStatus.REJECTED,
      reason:
        `All CAB members have voted but only ${approvals} of ${required} required ` +
        `approvals were given`,
      approvals,
      rejections,
      required,
    };
  }

  return {
    outcome: ChangeStatus.PENDING_APPROVAL,
    reason: `Awaiting ${required - approvals} more approval(s) from ${pending} outstanding vote(s)`,
    approvals,
    rejections,
    required,
  };
}

/**
 * Does this change need a CAB at all?
 *
 * A pre-approved change type (ITIL "standard change") skips the CAB regardless
 * of risk. Otherwise the group's risk level decides.
 */
export function requiresCabApproval(input: {
  typeIsPreApproved: boolean;
  riskRequiresCab: boolean;
}): boolean {
  if (input.typeIsPreApproved) return false;
  return input.riskRequiresCab;
}

/** Minimum notice check, so a high-risk change cannot be rushed through. */
export function noticeShortfallHours(input: {
  submittedAt: Date;
  plannedStartAt: Date | null;
  minimumNoticeHours: number;
}): number {
  if (!input.plannedStartAt || input.minimumNoticeHours <= 0) return 0;
  const noticeHours = (input.plannedStartAt.getTime() - input.submittedAt.getTime()) / 3_600_000;
  return noticeHours >= input.minimumNoticeHours ? 0 : input.minimumNoticeHours - noticeHours;
}
