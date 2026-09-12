import type { Prisma } from '@/generated/prisma/client';
import { db } from '@/lib/db/client';
import { scopedDb, scopedTransaction } from '@/lib/db/scoped';
import { auditDiff, recordAudit, type AuditActor } from '@/lib/audit';
import { requireCapability } from '@/lib/authz/guard';
import type { Actor, GroupContext } from '@/lib/authz/actor';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { revokeUserSessions } from '@/lib/redis';
import type {
  SaveCabInput,
  saveChangeCategorySchema,
  saveChangeTypeSchema,
  saveRiskLevelSchema,
} from '@/lib/changes/schemas';
import type { z } from 'zod';

/**
 * Change-module configuration: types, categories, risk levels and CABs.
 *
 * Separate capability from ticket taxonomy (`group:manage_change_config` vs
 * `group:manage_taxonomy`) so a group can let someone administer the change
 * process without handing them the ticket queue's configuration too.
 */

type Ctx = { actor: Actor; group: GroupContext; audit: AuditActor };

export async function listChangeConfig(actor: Actor, group: GroupContext) {
  requireCapability(actor, 'change:read', group.helpDeskGroupId);
  const scoped = scopedDb(group.helpDeskGroupId);

  const [types, categories, riskLevels, cabs, workflows, members] = await Promise.all([
    scoped.changeType.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
    scoped.changeCategory.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
    scoped.changeRiskLevel.findMany({ orderBy: { level: 'asc' } }),
    scoped.cab.findMany({
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
      include: {
        riskLevels: { include: { riskLevel: { select: { id: true, name: true, level: true } } } },
        members: {
          include: { user: { select: { id: true, name: true, email: true } } },
          orderBy: [{ isChair: 'desc' }, { user: { name: 'asc' } }],
        },
        workflow: { select: { id: true, name: true } },
        _count: { select: { changes: true } },
      },
    }),
    scoped.workflow.findMany({
      where: { isActive: true },
      select: { id: true, name: true, trigger: true },
      orderBy: { name: 'asc' },
    }),
    scoped.helpDeskMembership.findMany({
      where: { isActive: true },
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { user: { name: 'asc' } },
    }),
  ]);

  return { types, categories, riskLevels, cabs, workflows, candidates: members.map((m) => m.user) };
}

async function writeAudit(
  tx: Prisma.TransactionClient,
  ctx: Ctx,
  entity: string,
  entityType: string,
  before: Record<string, unknown> | null,
  after: Record<string, unknown>,
): Promise<void> {
  const diff = auditDiff(before ?? undefined, after);
  await recordAudit({
    action: `${entity}.${before ? 'update' : 'create'}`,
    entityType,
    entityId: String(after.id),
    helpDeskGroupId: ctx.group.helpDeskGroupId,
    before: diff?.before,
    after: diff?.after ?? after,
    actor: ctx.audit,
    tx,
  });
}

export async function saveChangeType(ctx: Ctx, input: z.output<typeof saveChangeTypeSchema>) {
  requireCapability(ctx.actor, 'group:manage_change_config', ctx.group.helpDeskGroupId);
  const helpDeskGroupId = ctx.group.helpDeskGroupId;
  const scoped = scopedDb(helpDeskGroupId);

  const clash = await scoped.changeType.findFirst({
    where: { name: input.name, ...(input.id ? { id: { not: input.id } } : {}) },
    select: { id: true },
  });
  if (clash)
    throw new ValidationError('Change type not saved', { name: ['That name is already used'] });

  const before = input.id ? await scoped.changeType.findFirst({ where: { id: input.id } }) : null;
  if (input.id && !before) throw new NotFoundError('Change type not found');

  return scopedTransaction(helpDeskGroupId, async (tx) => {
    if (input.isDefault) {
      await tx.changeType.updateMany({
        where: { helpDeskGroupId, isDefault: true, ...(input.id ? { id: { not: input.id } } : {}) },
        data: { isDefault: false },
      });
    }
    const data = {
      name: input.name,
      description: input.description ?? null,
      isPreApproved: input.isPreApproved,
      sortOrder: input.sortOrder,
      isDefault: input.isDefault,
      isActive: input.isActive,
    };
    const result = input.id
      ? await tx.changeType.update({ where: { id: input.id, helpDeskGroupId }, data })
      : await tx.changeType.create({ data: { helpDeskGroupId, ...data } });

    await writeAudit(tx, ctx, 'change_type', 'ChangeType', before, result);
    return result;
  });
}

export async function saveChangeCategory(
  ctx: Ctx,
  input: z.output<typeof saveChangeCategorySchema>,
) {
  requireCapability(ctx.actor, 'group:manage_change_config', ctx.group.helpDeskGroupId);
  const helpDeskGroupId = ctx.group.helpDeskGroupId;
  const scoped = scopedDb(helpDeskGroupId);

  const clash = await scoped.changeCategory.findFirst({
    where: { name: input.name, ...(input.id ? { id: { not: input.id } } : {}) },
    select: { id: true },
  });
  if (clash) {
    throw new ValidationError('Change category not saved', { name: ['That name is already used'] });
  }

  const before = input.id
    ? await scoped.changeCategory.findFirst({ where: { id: input.id } })
    : null;
  if (input.id && !before) throw new NotFoundError('Change category not found');

  return scopedTransaction(helpDeskGroupId, async (tx) => {
    const data = {
      name: input.name,
      description: input.description ?? null,
      sortOrder: input.sortOrder,
      isActive: input.isActive,
    };
    const result = input.id
      ? await tx.changeCategory.update({ where: { id: input.id, helpDeskGroupId }, data })
      : await tx.changeCategory.create({ data: { helpDeskGroupId, ...data } });

    await writeAudit(tx, ctx, 'change_category', 'ChangeCategory', before, result);
    return result;
  });
}

export async function saveRiskLevel(ctx: Ctx, input: z.output<typeof saveRiskLevelSchema>) {
  requireCapability(ctx.actor, 'group:manage_change_config', ctx.group.helpDeskGroupId);
  const helpDeskGroupId = ctx.group.helpDeskGroupId;
  const scoped = scopedDb(helpDeskGroupId);

  const fieldErrors: Record<string, string[]> = {};
  const nameClash = await scoped.changeRiskLevel.findFirst({
    where: { name: input.name, ...(input.id ? { id: { not: input.id } } : {}) },
    select: { id: true },
  });
  if (nameClash) fieldErrors.name = ['That name is already used'];

  const levelClash = await scoped.changeRiskLevel.findFirst({
    where: { level: input.level, ...(input.id ? { id: { not: input.id } } : {}) },
    select: { name: true },
  });
  if (levelClash)
    fieldErrors.level = [`Level ${input.level} is already used by ${levelClash.name}`];
  if (Object.keys(fieldErrors).length > 0) {
    throw new ValidationError('Risk level not saved', fieldErrors);
  }

  const before = input.id
    ? await scoped.changeRiskLevel.findFirst({ where: { id: input.id } })
    : null;
  if (input.id && !before) throw new NotFoundError('Risk level not found');

  // Turning off CAB approval for a risk band is a governance decision, so make
  // it visible rather than a quiet checkbox flip.
  if (before?.requiresCab && !input.requiresCab) {
    const inFlight = await scoped.changeRequest.count({
      where: { riskLevelId: before.id, status: 'PENDING_APPROVAL' },
    });
    if (inFlight > 0) {
      throw new ConflictError(
        `${inFlight} change(s) at ${before.name} risk are currently with a CAB. Resolve those ` +
          `before removing the CAB requirement.`,
      );
    }
  }

  return scopedTransaction(helpDeskGroupId, async (tx) => {
    if (input.isDefault) {
      await tx.changeRiskLevel.updateMany({
        where: { helpDeskGroupId, isDefault: true, ...(input.id ? { id: { not: input.id } } : {}) },
        data: { isDefault: false },
      });
    }
    const data = {
      name: input.name,
      level: input.level,
      description: input.description ?? null,
      colour: input.colour ?? null,
      requiresCab: input.requiresCab,
      minimumNoticeHours: input.minimumNoticeHours,
      isDefault: input.isDefault,
      isActive: input.isActive,
    };
    const result = input.id
      ? await tx.changeRiskLevel.update({ where: { id: input.id, helpDeskGroupId }, data })
      : await tx.changeRiskLevel.create({ data: { helpDeskGroupId, ...data } });

    await writeAudit(tx, ctx, 'change_risk_level', 'ChangeRiskLevel', before, result);
    return result;
  });
}

export async function saveCab(ctx: Ctx, input: SaveCabInput) {
  requireCapability(ctx.actor, 'group:manage_cab', ctx.group.helpDeskGroupId);
  const helpDeskGroupId = ctx.group.helpDeskGroupId;
  const scoped = scopedDb(helpDeskGroupId);

  const clash = await scoped.cab.findFirst({
    where: { name: input.name, ...(input.id ? { id: { not: input.id } } : {}) },
    select: { id: true },
  });
  if (clash) throw new ValidationError('CAB not saved', { name: ['That name is already used'] });

  if (input.approvalMode === 'QUORUM' && input.quorum < 1) {
    throw new ValidationError('CAB not saved', { quorum: ['A quorum of at least 1 is required'] });
  }

  // Every risk level must belong to this group -- otherwise a guessed id could
  // route another tenant's risk band to this board.
  if (input.riskLevelIds.length > 0) {
    const owned = await scoped.changeRiskLevel.count({ where: { id: { in: input.riskLevelIds } } });
    if (owned !== input.riskLevelIds.length) {
      throw new ValidationError('CAB not saved', {
        riskLevelIds: ['One or more risk levels do not belong to this help desk'],
      });
    }
  }
  if (input.workflowId) {
    const workflow = await scoped.workflow.findFirst({ where: { id: input.workflowId } });
    if (!workflow) {
      throw new ValidationError('CAB not saved', {
        workflowId: ['That workflow does not belong to this help desk'],
      });
    }
  }

  const before = input.id
    ? await scoped.cab.findFirst({ where: { id: input.id }, include: { riskLevels: true } })
    : null;
  if (input.id && !before) throw new NotFoundError('CAB not found');

  return scopedTransaction(helpDeskGroupId, async (tx) => {
    const data = {
      name: input.name,
      description: input.description ?? null,
      approvalMode: input.approvalMode,
      quorum: input.quorum,
      rejectionIsFinal: input.rejectionIsFinal,
      workflowId: input.workflowId ?? null,
      isActive: input.isActive,
    };
    const result = input.id
      ? await tx.cab.update({ where: { id: input.id, helpDeskGroupId }, data })
      : await tx.cab.create({ data: { helpDeskGroupId, ...data } });

    // Replace the routing set wholesale: simpler to reason about than a diff,
    // and the table is tiny.
    await tx.cabRiskLevel.deleteMany({ where: { cabId: result.id } });
    if (input.riskLevelIds.length > 0) {
      await tx.cabRiskLevel.createMany({
        data: input.riskLevelIds.map((riskLevelId) => ({
          helpDeskGroupId,
          cabId: result.id,
          riskLevelId,
        })),
      });
    }

    await writeAudit(tx, ctx, 'cab', 'Cab', before, {
      ...result,
      riskLevelIds: input.riskLevelIds,
    });
    return result;
  });
}

export async function saveCabMember(
  ctx: Ctx,
  input: { cabId: string; userId: string; isChair: boolean; isVoting: boolean },
) {
  requireCapability(ctx.actor, 'group:manage_cab', ctx.group.helpDeskGroupId);
  const helpDeskGroupId = ctx.group.helpDeskGroupId;
  const scoped = scopedDb(helpDeskGroupId);

  const cab = await scoped.cab.findFirst({ where: { id: input.cabId } });
  if (!cab) throw new NotFoundError('CAB not found');

  // A CAB member must be a member of the help desk: otherwise adding them is a
  // way to grant an outsider visibility of this group's changes.
  const membership = await db().helpDeskMembership.findFirst({
    where: { helpDeskGroupId, userId: input.userId, isActive: true },
    select: { id: true },
  });
  if (!membership) {
    throw new ValidationError('CAB member not saved', {
      userId: ['That person is not a member of this help desk'],
    });
  }

  const result = await scopedTransaction(helpDeskGroupId, async (tx) => {
    if (input.isChair) {
      // One chair per board, otherwise CHAIR_ONLY mode is ambiguous.
      await tx.cabMember.updateMany({
        where: { cabId: input.cabId, isChair: true, userId: { not: input.userId } },
        data: { isChair: false },
      });
    }

    const member = await tx.cabMember.upsert({
      where: { cabId_userId: { cabId: input.cabId, userId: input.userId } },
      create: {
        helpDeskGroupId,
        cabId: input.cabId,
        userId: input.userId,
        isChair: input.isChair,
        isVoting: input.isVoting,
      },
      update: { isChair: input.isChair, isVoting: input.isVoting },
      include: { user: { select: { email: true } } },
    });

    await recordAudit({
      action: 'cab_member.upsert',
      entityType: 'CabMember',
      entityId: member.id,
      helpDeskGroupId,
      after: {
        cabId: input.cabId,
        userEmail: member.user.email,
        isChair: member.isChair,
        isVoting: member.isVoting,
      },
      actor: ctx.audit,
      tx,
    });

    return member;
  });

  // CAB membership changes what this person can see and vote on.
  await revokeUserSessions(input.userId);
  return result;
}

export async function removeCabMember(ctx: Ctx, input: { cabId: string; userId: string }) {
  requireCapability(ctx.actor, 'group:manage_cab', ctx.group.helpDeskGroupId);
  const helpDeskGroupId = ctx.group.helpDeskGroupId;

  const existing = await scopedDb(helpDeskGroupId).cabMember.findFirst({
    where: { cabId: input.cabId, userId: input.userId },
    include: { user: { select: { email: true } } },
  });
  if (!existing) throw new NotFoundError('That person is not on this CAB');

  await scopedTransaction(helpDeskGroupId, async (tx) => {
    await tx.cabMember.delete({ where: { id: existing.id } });
    await recordAudit({
      action: 'cab_member.delete',
      entityType: 'CabMember',
      entityId: existing.id,
      helpDeskGroupId,
      before: { cabId: input.cabId, userEmail: existing.user.email, isChair: existing.isChair },
      actor: ctx.audit,
      tx,
    });
  });

  await revokeUserSessions(input.userId);
}
