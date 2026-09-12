import {
  ApprovalDecision,
  ChangeEventType,
  ChangeStatus,
  NotificationChannel,
  NotificationEvent,
} from '@/generated/prisma/enums';
import type { Prisma } from '@/generated/prisma/client';
import { scopedDb, scopedTransaction } from '@/lib/db/scoped';
import type { Actor, GroupContext } from '@/lib/authz/actor';
import { can, requireCapability } from '@/lib/authz/guard';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { groupLogger } from '@/lib/logger';
import { claimChangeSequence, formatChangeReference } from '@/lib/changes/reference';
import {
  OPEN_CHANGE_STATUSES,
  canTransition,
  evaluateCab,
  isEditable,
  noticeShortfallHours,
  requiresCabApproval,
} from '@/lib/changes/lifecycle';
import type {
  ChangeFilter,
  CreateChangeInput,
  RecordDecisionInput,
  TransitionChangeInput,
  UpdateChangeInput,
} from '@/lib/changes/schemas';

/**
 * Change management. A standalone module: its own numbering series, taxonomy,
 * lifecycle, approvals and timeline. The only thread back to tickets is the
 * optional `Ticket.changeRequestId` cross-reference, which is a citation, not
 * ownership.
 *
 * Same layering rule as tickets: reads through `scopedDb`, multi-row writes in
 * a `scopedTransaction` with `helpDeskGroupId` set explicitly on every row.
 */

const changeListSelect = {
  id: true,
  reference: true,
  title: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  submittedAt: true,
  plannedStartAt: true,
  plannedEndAt: true,
  changeType: { select: { id: true, name: true, isPreApproved: true } },
  changeCategory: { select: { id: true, name: true } },
  riskLevel: { select: { id: true, name: true, level: true, colour: true, requiresCab: true } },
  requester: { select: { id: true, name: true, email: true } },
  owner: { select: { id: true, name: true, email: true } },
  cab: { select: { id: true, name: true } },
  _count: { select: { approvals: true } },
} satisfies Prisma.ChangeRequestSelect;

export type ChangeListItem = Prisma.ChangeRequestGetPayload<{ select: typeof changeListSelect }>;

function viewFilter(view: ChangeFilter['view'], actor: Actor): Prisma.ChangeRequestWhereInput {
  switch (view) {
    case 'open':
      return { status: { in: [...OPEN_CHANGE_STATUSES] } };
    case 'awaiting_my_approval':
      return {
        status: ChangeStatus.PENDING_APPROVAL,
        approvals: { some: { approverId: actor.userId, decision: ApprovalDecision.PENDING } },
      };
    case 'mine':
      return { OR: [{ requesterId: actor.userId }, { ownerId: actor.userId }] };
    case 'scheduled':
      return { status: { in: [ChangeStatus.SCHEDULED, ChangeStatus.APPROVED] } };
    case 'completed':
      return { status: { in: [ChangeStatus.COMPLETED, ChangeStatus.ROLLED_BACK] } };
    case 'all':
    default:
      return {};
  }
}

export function buildChangeWhere(
  actor: Actor,
  filter: ChangeFilter,
): Prisma.ChangeRequestWhereInput {
  const clauses: Prisma.ChangeRequestWhereInput[] = [viewFilter(filter.view, actor)];

  if (filter.q) {
    clauses.push({
      OR: [
        { reference: { contains: filter.q, mode: 'insensitive' } },
        { title: { contains: filter.q, mode: 'insensitive' } },
      ],
    });
  }
  if (filter.status) clauses.push({ status: filter.status });
  if (filter.riskLevelId) clauses.push({ riskLevelId: filter.riskLevelId });
  if (filter.changeTypeId) clauses.push({ changeTypeId: filter.changeTypeId });

  return { AND: clauses };
}

export async function listChanges(actor: Actor, group: GroupContext, filter: ChangeFilter) {
  requireCapability(actor, 'change:read', group.helpDeskGroupId);

  const scoped = scopedDb(group.helpDeskGroupId);
  const where = buildChangeWhere(actor, filter);

  const [items, total] = await Promise.all([
    scoped.changeRequest.findMany({
      where,
      select: changeListSelect,
      orderBy: [{ riskLevel: { level: 'asc' } }, { createdAt: 'desc' }],
      skip: (filter.page - 1) * filter.pageSize,
      take: filter.pageSize,
    }),
    scoped.changeRequest.count({ where }),
  ]);

  return { items, total, page: filter.page, pageSize: filter.pageSize };
}

export async function getChangeDetail(actor: Actor, group: GroupContext, changeRequestId: string) {
  requireCapability(actor, 'change:read', group.helpDeskGroupId);

  const change = await scopedDb(group.helpDeskGroupId).changeRequest.findFirst({
    where: { id: changeRequestId },
    include: {
      changeType: true,
      changeCategory: true,
      riskLevel: true,
      requester: { select: { id: true, name: true, email: true } },
      owner: { select: { id: true, name: true, email: true } },
      cab: { include: { members: { include: { user: { select: { id: true, name: true } } } } } },
      approvals: {
        include: { approver: { select: { id: true, name: true, email: true } } },
        orderBy: [{ isChair: 'desc' }, { createdAt: 'asc' }],
      },
      linkedTickets: { select: { id: true, reference: true, subject: true } },
      events: {
        orderBy: { createdAt: 'desc' },
        take: 100,
        include: { actor: { select: { id: true, name: true } } },
      },
    },
  });

  if (!change) throw new NotFoundError('Change request not found');
  return change;
}

/** Everything the create/edit form needs. */
export async function changeFormOptions(group: GroupContext) {
  const scoped = scopedDb(group.helpDeskGroupId);
  const [types, categories, riskLevels, cabs, members] = await Promise.all([
    scoped.changeType.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } }),
    scoped.changeCategory.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } }),
    scoped.changeRiskLevel.findMany({ where: { isActive: true }, orderBy: { level: 'asc' } }),
    scoped.cab.findMany({
      where: { isActive: true },
      include: { riskLevels: true, _count: { select: { members: true } } },
      orderBy: { name: 'asc' },
    }),
    scoped.helpDeskMembership.findMany({
      where: { isActive: true, role: { in: ['AGENT', 'HD_ADMIN'] } },
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { user: { name: 'asc' } },
    }),
  ]);

  return { types, categories, riskLevels, cabs, owners: members.map((m) => m.user) };
}

async function loadChangeConfig(
  helpDeskGroupId: string,
  input: {
    changeTypeId?: string;
    riskLevelId?: string;
    changeCategoryId?: string;
  },
) {
  const scoped = scopedDb(helpDeskGroupId);
  const [type, risk, category] = await Promise.all([
    input.changeTypeId
      ? scoped.changeType.findFirst({ where: { id: input.changeTypeId, isActive: true } })
      : Promise.resolve(null),
    input.riskLevelId
      ? scoped.changeRiskLevel.findFirst({ where: { id: input.riskLevelId, isActive: true } })
      : Promise.resolve(null),
    input.changeCategoryId
      ? scoped.changeCategory.findFirst({ where: { id: input.changeCategoryId, isActive: true } })
      : Promise.resolve(null),
  ]);
  return { type, risk, category };
}

export async function createChange(actor: Actor, group: GroupContext, input: CreateChangeInput) {
  requireCapability(actor, 'change:create', group.helpDeskGroupId);
  const helpDeskGroupId = group.helpDeskGroupId;

  const { type, risk, category } = await loadChangeConfig(helpDeskGroupId, input);

  const fieldErrors: Record<string, string[]> = {};
  if (!type) fieldErrors.changeTypeId = ['Unknown change type for this help desk'];
  if (!risk) fieldErrors.riskLevelId = ['Unknown risk level for this help desk'];
  if (input.changeCategoryId && !category) {
    fieldErrors.changeCategoryId = ['Unknown change category for this help desk'];
  }
  if (input.plannedStartAt && input.plannedEndAt && input.plannedEndAt <= input.plannedStartAt) {
    fieldErrors.plannedEndAt = ['The planned end must be after the planned start'];
  }
  if (Object.keys(fieldErrors).length > 0) {
    throw new ValidationError('Change request could not be created', fieldErrors);
  }

  if (input.linkedTicketId) {
    const ticket = await scopedDb(helpDeskGroupId).ticket.findFirst({
      where: { id: input.linkedTicketId },
      select: { id: true },
    });
    if (!ticket) {
      throw new ValidationError('Change request could not be created', {
        linkedTicketId: ['That ticket is not in this help desk'],
      });
    }
  }

  const change = await scopedTransaction(helpDeskGroupId, async (tx) => {
    const sequence = await claimChangeSequence(tx, helpDeskGroupId);
    const created = await tx.changeRequest.create({
      data: {
        helpDeskGroupId,
        reference: formatChangeReference(group.groupKey, sequence),
        sequence,
        title: input.title,
        description: input.description,
        changeTypeId: input.changeTypeId,
        riskLevelId: input.riskLevelId,
        changeCategoryId: input.changeCategoryId ?? null,
        requesterId: actor.userId,
        ownerId: input.ownerId ?? null,
        impactAssessment: input.impactAssessment ?? null,
        implementationPlan: input.implementationPlan ?? null,
        rollbackPlan: input.rollbackPlan ?? null,
        testPlan: input.testPlan ?? null,
        plannedStartAt: input.plannedStartAt ?? null,
        plannedEndAt: input.plannedEndAt ?? null,
        events: {
          create: { helpDeskGroupId, actorId: actor.userId, type: ChangeEventType.CREATED },
        },
      },
      select: { id: true, reference: true },
    });

    if (input.linkedTicketId) {
      await tx.ticket.update({
        where: { id: input.linkedTicketId, helpDeskGroupId },
        data: { changeRequestId: created.id },
      });
      await tx.changeEvent.create({
        data: {
          helpDeskGroupId,
          changeRequestId: created.id,
          actorId: actor.userId,
          type: ChangeEventType.TICKET_LINKED,
          newValue: input.linkedTicketId,
        },
      });
    }

    return created;
  });

  groupLogger(helpDeskGroupId).info(
    { changeRequestId: change.id, reference: change.reference, actorUserId: actor.userId },
    'change request created',
  );
  return change;
}

export async function updateChange(actor: Actor, group: GroupContext, input: UpdateChangeInput) {
  requireCapability(actor, 'change:update', group.helpDeskGroupId);
  const helpDeskGroupId = group.helpDeskGroupId;
  const scoped = scopedDb(helpDeskGroupId);

  const existing = await scoped.changeRequest.findFirst({ where: { id: input.changeRequestId } });
  if (!existing) throw new NotFoundError('Change request not found');

  // Once submitted, the record is evidence for an approval decision. Editing it
  // underneath the CAB would invalidate the votes already cast.
  if (!isEditable(existing.status)) {
    throw new ConflictError(
      `A change in ${existing.status} cannot be edited. Cancel it, or move it back to draft first.`,
      { status: existing.status },
    );
  }

  const { type, risk, category } = await loadChangeConfig(helpDeskGroupId, input);
  const fieldErrors: Record<string, string[]> = {};
  if (input.changeTypeId && !type) fieldErrors.changeTypeId = ['Unknown change type'];
  if (input.riskLevelId && !risk) fieldErrors.riskLevelId = ['Unknown risk level'];
  if (input.changeCategoryId && !category) fieldErrors.changeCategoryId = ['Unknown category'];

  const plannedStartAt = input.plannedStartAt ?? existing.plannedStartAt;
  const plannedEndAt = input.plannedEndAt ?? existing.plannedEndAt;
  if (plannedStartAt && plannedEndAt && plannedEndAt <= plannedStartAt) {
    fieldErrors.plannedEndAt = ['The planned end must be after the planned start'];
  }
  if (Object.keys(fieldErrors).length > 0) {
    throw new ValidationError('Change request could not be updated', fieldErrors);
  }

  const data: Prisma.ChangeRequestUpdateInput = {};
  const events: Prisma.ChangeEventCreateManyInput[] = [];
  const base = { helpDeskGroupId, changeRequestId: input.changeRequestId, actorId: actor.userId };

  for (const key of [
    'title',
    'description',
    'impactAssessment',
    'implementationPlan',
    'rollbackPlan',
    'testPlan',
  ] as const) {
    if (input[key] !== undefined) data[key] = input[key];
  }
  if (input.changeTypeId) data.changeType = { connect: { id: input.changeTypeId } };
  if (input.changeCategoryId !== undefined) {
    data.changeCategory = input.changeCategoryId
      ? { connect: { id: input.changeCategoryId } }
      : { disconnect: true };
  }
  if (input.ownerId !== undefined) {
    data.owner = input.ownerId ? { connect: { id: input.ownerId } } : { disconnect: true };
  }
  if (input.plannedStartAt !== undefined) data.plannedStartAt = input.plannedStartAt;
  if (input.plannedEndAt !== undefined) data.plannedEndAt = input.plannedEndAt;

  if (input.riskLevelId && input.riskLevelId !== existing.riskLevelId) {
    data.riskLevel = { connect: { id: input.riskLevelId } };
    events.push({
      ...base,
      type: ChangeEventType.RISK_CHANGED,
      field: 'riskLevelId',
      oldValue: existing.riskLevelId,
      newValue: input.riskLevelId,
    });
  }

  events.push({ ...base, type: ChangeEventType.UPDATED });

  const updated = await scopedTransaction(helpDeskGroupId, async (tx) => {
    const result = await tx.changeRequest.update({
      where: { id: input.changeRequestId, helpDeskGroupId },
      data,
      select: { id: true, reference: true },
    });
    await tx.changeEvent.createMany({ data: events });
    return result;
  });

  return updated;
}

/**
 * Submit for approval.
 *
 * Decides whether a CAB is needed, snapshots the CAB's membership into
 * ChangeApproval rows, and short-circuits to APPROVED for a pre-approved type
 * or a risk level that does not require a board.
 */
export async function submitChange(
  actor: Actor,
  group: GroupContext,
  input: { changeRequestId: string; cabId?: string },
) {
  requireCapability(actor, 'change:update', group.helpDeskGroupId);
  const helpDeskGroupId = group.helpDeskGroupId;
  const scoped = scopedDb(helpDeskGroupId);

  const change = await scoped.changeRequest.findFirst({
    where: { id: input.changeRequestId },
    include: { changeType: true, riskLevel: true },
  });
  if (!change) throw new NotFoundError('Change request not found');

  if (change.status !== ChangeStatus.DRAFT) {
    throw new ConflictError(`Only a draft change can be submitted (this one is ${change.status}).`);
  }
  if (!change.implementationPlan?.trim()) {
    throw new ValidationError('Change request could not be submitted', {
      implementationPlan: ['An implementation plan is required before submission'],
    });
  }
  if (!change.rollbackPlan?.trim()) {
    throw new ValidationError('Change request could not be submitted', {
      rollbackPlan: ['A rollback plan is required before submission'],
    });
  }

  const now = new Date();
  const shortfall = noticeShortfallHours({
    submittedAt: now,
    plannedStartAt: change.plannedStartAt,
    minimumNoticeHours: change.riskLevel.minimumNoticeHours,
  });
  if (shortfall > 0) {
    throw new ValidationError('Change request could not be submitted', {
      plannedStartAt: [
        `${change.riskLevel.name} risk requires ${change.riskLevel.minimumNoticeHours} hours of ` +
          `notice; this is ${Math.ceil(shortfall)} hour(s) short.`,
      ],
    });
  }

  const needsCab = requiresCabApproval({
    typeIsPreApproved: change.changeType.isPreApproved,
    riskRequiresCab: change.riskLevel.requiresCab,
  });

  // Route to the explicitly chosen CAB, else the one wired to this risk level,
  // else the group default.
  const cab = needsCab
    ? ((input.cabId
        ? await scoped.cab.findFirst({
            where: { id: input.cabId, isActive: true },
            include: { members: true },
          })
        : null) ??
      (await scoped.cab.findFirst({
        where: { isActive: true, riskLevels: { some: { riskLevelId: change.riskLevelId } } },
        include: { members: true },
        orderBy: { isDefault: 'desc' },
      })) ??
      (await scoped.cab.findFirst({
        where: { isActive: true, isDefault: true },
        include: { members: true },
      })))
    : null;

  if (needsCab && !cab) {
    throw new ConflictError(
      `${change.riskLevel.name} risk requires CAB approval, but no active CAB is configured for ` +
        `it. An administrator must set one up under CAB configuration.`,
    );
  }
  if (cab && cab.members.filter((member) => member.isVoting).length === 0) {
    throw new ConflictError(
      `${cab.name} has no voting members, so it can never approve this change.`,
    );
  }

  const result = await scopedTransaction(helpDeskGroupId, async (tx) => {
    if (!needsCab) {
      const updated = await tx.changeRequest.update({
        where: { id: change.id, helpDeskGroupId },
        data: { status: ChangeStatus.APPROVED, submittedAt: now, decidedAt: now },
        select: { id: true, reference: true, status: true },
      });
      await tx.changeEvent.createMany({
        data: [
          {
            helpDeskGroupId,
            changeRequestId: change.id,
            actorId: actor.userId,
            type: ChangeEventType.SUBMITTED,
          },
          {
            helpDeskGroupId,
            changeRequestId: change.id,
            actorId: actor.userId,
            type: ChangeEventType.APPROVED,
            newValue: change.changeType.isPreApproved
              ? `Pre-approved change type: ${change.changeType.name}`
              : `${change.riskLevel.name} risk does not require CAB approval`,
          },
        ],
      });
      return updated;
    }

    const updated = await tx.changeRequest.update({
      where: { id: change.id, helpDeskGroupId },
      data: { status: ChangeStatus.PENDING_APPROVAL, submittedAt: now, cabId: cab!.id },
      select: { id: true, reference: true, status: true },
    });

    // Snapshot voting rights: a later CAB membership change must not rewrite
    // whether a vote already cast counted.
    await tx.changeApproval.createMany({
      data: cab!.members.map((member) => ({
        helpDeskGroupId,
        changeRequestId: change.id,
        approverId: member.userId,
        isVoting: member.isVoting,
        isChair: member.isChair,
      })),
      skipDuplicates: true,
    });

    await tx.changeEvent.createMany({
      data: [
        {
          helpDeskGroupId,
          changeRequestId: change.id,
          actorId: actor.userId,
          type: ChangeEventType.SUBMITTED,
        },
        {
          helpDeskGroupId,
          changeRequestId: change.id,
          actorId: actor.userId,
          type: ChangeEventType.CAB_ASSIGNED,
          newValue: cab!.name,
        },
        {
          helpDeskGroupId,
          changeRequestId: change.id,
          actorId: actor.userId,
          type: ChangeEventType.APPROVAL_REQUESTED,
          metadata: { cabId: cab!.id, members: cab!.members.length },
        },
      ],
    });

    // Notifications are queued, not sent: delivery is Phase 2. Queuing now
    // means the approval request is recorded and will flush when SMTP exists.
    await queueChangeNotifications(tx, {
      helpDeskGroupId,
      changeRequestId: change.id,
      event: NotificationEvent.CHANGE_APPROVAL_REQUESTED,
      recipients: cab!.members.map((member) => member.userId),
    });

    return updated;
  });

  groupLogger(helpDeskGroupId).info(
    { changeRequestId: change.id, needsCab, status: result.status },
    'change request submitted',
  );
  return result;
}

/** Record one CAB member's vote and re-evaluate the board's decision. */
export async function recordDecision(
  actor: Actor,
  group: GroupContext,
  input: RecordDecisionInput,
) {
  const helpDeskGroupId = group.helpDeskGroupId;
  const scoped = scopedDb(helpDeskGroupId);

  const change = await scoped.changeRequest.findFirst({
    where: { id: input.changeRequestId },
    include: { cab: true, approvals: true },
  });
  if (!change) throw new NotFoundError('Change request not found');
  if (change.status !== ChangeStatus.PENDING_APPROVAL) {
    throw new ConflictError(`This change is ${change.status}; it is not awaiting approval.`);
  }

  const own = change.approvals.find((approval) => approval.approverId === actor.userId);

  // Two ways to vote: you are on the snapshotted CAB, or you hold
  // change:approve for the group (an HD Admin acting for an absent board).
  const isBoardMember = own !== undefined;
  if (!isBoardMember) {
    requireCapability(actor, 'change:approve', helpDeskGroupId);
  }
  if (own && own.decision !== ApprovalDecision.PENDING) {
    throw new ConflictError('You have already recorded a decision on this change.');
  }

  const now = new Date();

  const outcome = await scopedTransaction(helpDeskGroupId, async (tx) => {
    const approval = await tx.changeApproval.upsert({
      where: {
        changeRequestId_approverId: {
          changeRequestId: change.id,
          approverId: actor.userId,
        },
      },
      create: {
        helpDeskGroupId,
        changeRequestId: change.id,
        approverId: actor.userId,
        decision: input.decision,
        comment: input.comment ?? null,
        // An admin voting outside the board counts, and chairs it only if the
        // CAB actually says so.
        isVoting: true,
        isChair: false,
        decidedAt: now,
      },
      update: { decision: input.decision, comment: input.comment ?? null, decidedAt: now },
    });

    const votes = await tx.changeApproval.findMany({
      where: { changeRequestId: change.id },
      select: { decision: true, isVoting: true, isChair: true },
    });

    const decision = evaluateCab(
      change.cab?.approvalMode ?? 'QUORUM',
      change.cab?.quorum ?? 1,
      change.cab?.rejectionIsFinal ?? true,
      votes,
    );

    await tx.changeEvent.create({
      data: {
        helpDeskGroupId,
        changeRequestId: change.id,
        actorId: actor.userId,
        type:
          input.decision === ApprovalDecision.APPROVED
            ? ChangeEventType.APPROVED
            : input.decision === ApprovalDecision.REJECTED
              ? ChangeEventType.REJECTED
              : ChangeEventType.UPDATED,
        newValue: input.decision,
        metadata: {
          approvalId: approval.id,
          boardOutcome: decision.outcome,
          reason: decision.reason,
        },
      },
    });

    if (decision.outcome !== ChangeStatus.PENDING_APPROVAL) {
      await tx.changeRequest.update({
        where: { id: change.id, helpDeskGroupId },
        data: { status: decision.outcome, decidedAt: now },
      });
      await tx.changeEvent.create({
        data: {
          helpDeskGroupId,
          changeRequestId: change.id,
          actorId: null,
          type:
            decision.outcome === ChangeStatus.APPROVED
              ? ChangeEventType.APPROVED
              : ChangeEventType.REJECTED,
          newValue: decision.reason,
        },
      });
      await queueChangeNotifications(tx, {
        helpDeskGroupId,
        changeRequestId: change.id,
        event:
          decision.outcome === ChangeStatus.APPROVED
            ? NotificationEvent.CHANGE_APPROVED
            : NotificationEvent.CHANGE_REJECTED,
        recipients: [change.requesterId, ...(change.ownerId ? [change.ownerId] : [])],
      });
    }

    return decision;
  });

  return outcome;
}

/** Drive the implementation lifecycle: schedule, start, complete, fail, roll back, cancel. */
export async function transitionChange(
  actor: Actor,
  group: GroupContext,
  input: TransitionChangeInput,
) {
  const helpDeskGroupId = group.helpDeskGroupId;
  const scoped = scopedDb(helpDeskGroupId);

  const change = await scoped.changeRequest.findFirst({ where: { id: input.changeRequestId } });
  if (!change) throw new NotFoundError('Change request not found');

  const capability =
    input.to === ChangeStatus.SCHEDULED
      ? 'change:schedule'
      : input.to === ChangeStatus.CANCELLED
        ? 'change:cancel'
        : input.to === ChangeStatus.DRAFT
          ? 'change:update'
          : 'change:implement';
  requireCapability(actor, capability, helpDeskGroupId);

  if (!canTransition(change.status, input.to)) {
    throw new ConflictError(`A change cannot move from ${change.status} to ${input.to}.`, {
      from: change.status,
      to: input.to,
    });
  }

  const now = new Date();
  const data: Prisma.ChangeRequestUpdateInput = { status: input.to };
  if (input.outcomeNotes !== undefined) data.outcomeNotes = input.outcomeNotes;
  if (input.to === ChangeStatus.IN_PROGRESS && !change.actualStartAt) data.actualStartAt = now;
  if (
    input.to === ChangeStatus.COMPLETED ||
    input.to === ChangeStatus.FAILED ||
    input.to === ChangeStatus.ROLLED_BACK
  ) {
    data.actualEndAt = now;
  }
  if (input.to === ChangeStatus.DRAFT) {
    // Resubmission starts a fresh approval round; stale votes must not carry.
    data.submittedAt = null;
    data.decidedAt = null;
  }

  const eventType: Record<string, ChangeEventType> = {
    [ChangeStatus.SCHEDULED]: ChangeEventType.SCHEDULED,
    [ChangeStatus.IN_PROGRESS]: ChangeEventType.IMPLEMENTATION_STARTED,
    [ChangeStatus.COMPLETED]: ChangeEventType.IMPLEMENTATION_COMPLETED,
    [ChangeStatus.FAILED]: ChangeEventType.IMPLEMENTATION_FAILED,
    [ChangeStatus.ROLLED_BACK]: ChangeEventType.ROLLED_BACK,
    [ChangeStatus.CANCELLED]: ChangeEventType.CANCELLED,
    [ChangeStatus.DRAFT]: ChangeEventType.UPDATED,
  };

  const updated = await scopedTransaction(helpDeskGroupId, async (tx) => {
    const result = await tx.changeRequest.update({
      where: { id: change.id, helpDeskGroupId },
      data,
      select: { id: true, reference: true, status: true },
    });

    if (input.to === ChangeStatus.DRAFT) {
      await tx.changeApproval.deleteMany({ where: { changeRequestId: change.id } });
    }

    await tx.changeEvent.create({
      data: {
        helpDeskGroupId,
        changeRequestId: change.id,
        actorId: actor.userId,
        type: eventType[input.to] ?? ChangeEventType.UPDATED,
        field: 'status',
        oldValue: change.status,
        newValue: input.to,
      },
    });

    return result;
  });

  groupLogger(helpDeskGroupId).info(
    { changeRequestId: change.id, from: change.status, to: input.to, actorUserId: actor.userId },
    'change request transitioned',
  );
  return updated;
}

/**
 * Queue notification rows without delivering them.
 *
 * Phase 2 owns transport. Recording the intent now means an approval request is
 * auditable and will flush once SMTP is configured, rather than being lost.
 */
async function queueChangeNotifications(
  tx: Prisma.TransactionClient,
  input: {
    helpDeskGroupId: string;
    changeRequestId: string;
    event: NotificationEvent;
    recipients: string[];
  },
): Promise<void> {
  if (input.recipients.length === 0) return;

  const users = await tx.user.findMany({
    where: { id: { in: [...new Set(input.recipients)] }, isActive: true },
    select: { email: true },
  });
  const template = await tx.notificationTemplate.findFirst({
    where: {
      helpDeskGroupId: input.helpDeskGroupId,
      event: input.event,
      channel: NotificationChannel.EMAIL,
      isActive: true,
    },
    select: { id: true, subject: true },
  });

  await tx.notificationLog.createMany({
    data: users.map((user) => ({
      helpDeskGroupId: input.helpDeskGroupId,
      templateId: template?.id ?? null,
      event: input.event,
      channel: NotificationChannel.EMAIL,
      recipient: user.email,
      subject: template?.subject ?? null,
      // QUEUED, never SENT: nothing has been delivered.
      status: 'QUEUED',
    })),
  });
}

/** Changes the actor is being asked to vote on -- drives the nav badge. */
export async function pendingApprovalCount(actor: Actor, group: GroupContext): Promise<number> {
  if (!can(actor, 'change:read', group.helpDeskGroupId)) return 0;

  return scopedDb(group.helpDeskGroupId).changeRequest.count({
    where: {
      status: ChangeStatus.PENDING_APPROVAL,
      approvals: { some: { approverId: actor.userId, decision: ApprovalDecision.PENDING } },
    },
  });
}
