import { GroupRole } from '@/generated/prisma/enums';
import type { Prisma } from '@/generated/prisma/client';
import { db } from '@/lib/db/client';
import { recordAudit, auditDiff, type AuditActor } from '@/lib/audit';
import { requireCapability } from '@/lib/authz/guard';
import type { Actor } from '@/lib/authz/actor';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { revokeUserSessions } from '@/lib/redis';
import {
  DEFAULT_NOTIFICATION_TEMPLATES,
  DEFAULT_PRIORITIES,
  DEFAULT_SLA_TARGETS,
  DEFAULT_TICKET_TYPES,
  DEFAULT_STATUSES,
  DEFAULT_WORKING_HOURS,
  STARTER_CATEGORIES,
} from '@/lib/groups/defaults';
import {
  DEFAULT_CAB,
  DEFAULT_CHANGE_CATEGORIES,
  DEFAULT_CHANGE_RISK_LEVELS,
  DEFAULT_CHANGE_TYPES,
} from '@/lib/changes/defaults';
import type {
  CreateGroupInput,
  UpdateGroupInput,
  UpsertMembershipInput,
} from '@/lib/groups/schemas';

/**
 * Help desk group administration -- Super Administrator territory (brief §5),
 * plus the membership management that HD Admins also perform for their own
 * group.
 *
 * These functions use the unscoped client because their whole job is to operate
 * across or upon groups. Every one of them starts with a capability check.
 */

export function auditActorFrom(
  actor: Actor,
  request?: { ip?: string | null; userAgent?: string | null },
): AuditActor {
  return {
    userId: actor.userId,
    email: actor.email,
    ipAddress: request?.ip ?? null,
    userAgent: request?.userAgent ?? null,
  };
}

export async function listGroupsForAdmin(actor: Actor) {
  requireCapability(actor, 'platform:manage_groups');

  return db().helpDeskGroup.findMany({
    orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    include: {
      _count: { select: { memberships: true, tickets: true, categories: true } },
    },
  });
}

/**
 * Create a group and provision everything it needs to accept a ticket
 * immediately: statuses, priorities, types, a working-hours calendar, a default
 * SLA policy with per-priority targets, and notification templates.
 *
 * One transaction: a half-provisioned group would look fine in the list and
 * fail on first ticket creation.
 */
export async function createGroup(actor: Actor, input: CreateGroupInput, audit: AuditActor) {
  requireCapability(actor, 'platform:manage_groups');

  const clashes = await db().helpDeskGroup.findFirst({
    where: {
      OR: [
        { key: input.key },
        { name: input.name },
        ...(input.inboundEmailAddress ? [{ inboundEmailAddress: input.inboundEmailAddress }] : []),
      ],
    },
    select: { key: true, name: true, inboundEmailAddress: true },
  });

  if (clashes) {
    const fieldErrors: Record<string, string[]> = {};
    if (clashes.key === input.key) fieldErrors.key = ['That key is already in use'];
    if (clashes.name === input.name) fieldErrors.name = ['That name is already in use'];
    if (input.inboundEmailAddress && clashes.inboundEmailAddress === input.inboundEmailAddress) {
      fieldErrors.inboundEmailAddress = ['That address already belongs to another help desk'];
    }
    throw new ValidationError('Help desk group could not be created', fieldErrors);
  }

  const group = await db().$transaction(async (tx) => {
    const created = await tx.helpDeskGroup.create({
      data: {
        name: input.name,
        key: input.key,
        description: input.description ?? null,
        timeZone: input.timeZone,
        inboundEmailAddress: input.inboundEmailAddress ?? null,
        outboundEmailAddress: input.outboundEmailAddress ?? null,
        observerScope: input.observerScope,
      },
    });

    await provisionGroupDefaults(tx, created.id, {
      timeZone: input.timeZone,
      includeStarterConfig: input.includeStarterConfig,
    });

    await recordAudit({
      action: 'help_desk_group.create',
      entityType: 'HelpDeskGroup',
      entityId: created.id,
      helpDeskGroupId: created.id,
      after: {
        name: created.name,
        key: created.key,
        timeZone: created.timeZone,
        observerScope: created.observerScope,
      },
      actor: audit,
      tx,
    });

    return created;
  });

  logger.info({ helpDeskGroupId: group.id, key: group.key }, 'help desk group created');
  return group;
}

/**
 * Insert the default configuration for a group. Exported so the seed script and
 * the admin UI provision groups identically -- two code paths that drift is how
 * "it works in dev" happens.
 */
export async function provisionGroupDefaults(
  tx: Prisma.TransactionClient,
  helpDeskGroupId: string,
  options: {
    timeZone: string;
    includeStarterConfig: boolean;
    calendarName?: string;
    region?: string;
  },
): Promise<void> {
  await tx.ticketStatus.createMany({
    data: DEFAULT_STATUSES.map((status) => ({ ...status, helpDeskGroupId })),
  });
  await tx.priority.createMany({
    data: DEFAULT_PRIORITIES.map((priority) => ({ ...priority, helpDeskGroupId })),
  });
  await tx.ticketType.createMany({
    data: DEFAULT_TICKET_TYPES.map((type) => ({ ...type, helpDeskGroupId })),
  });

  const calendar = await tx.calendar.create({
    data: {
      helpDeskGroupId,
      name: options.calendarName ?? 'Standard business hours',
      timeZone: options.timeZone,
      region: options.region ?? null,
      isDefault: true,
    },
  });

  await tx.workingHours.createMany({
    data: DEFAULT_WORKING_HOURS.map((hours) => ({
      ...hours,
      helpDeskGroupId,
      calendarId: calendar.id,
    })),
  });

  await tx.afterHoursConfig.create({
    data: {
      helpDeskGroupId,
      calendarId: calendar.id,
      // Off by default: enabling it without configuring contacts would page
      // nobody and look like a working escalation path.
      isEnabled: false,
      autoReplyMessage:
        'Thank you for contacting us. Your request has been logged outside our working hours ' +
        'and will be picked up when we reopen. For a critical outage, please use the emergency ' +
        'contact number in your service handbook.',
    },
  });

  await tx.notificationTemplate.createMany({
    data: DEFAULT_NOTIFICATION_TEMPLATES.map((template) => ({ ...template, helpDeskGroupId })),
  });

  // --- Change management: its own module, provisioned alongside but not
  // sharing any of the ticket taxonomy above.
  await tx.changeType.createMany({
    data: DEFAULT_CHANGE_TYPES.map((type) => ({ ...type, helpDeskGroupId })),
  });
  await tx.changeRiskLevel.createMany({
    data: DEFAULT_CHANGE_RISK_LEVELS.map((risk) => ({ ...risk, helpDeskGroupId })),
  });

  const cab = await tx.cab.create({
    data: {
      helpDeskGroupId,
      name: DEFAULT_CAB.name,
      description: DEFAULT_CAB.description,
      approvalMode: DEFAULT_CAB.approvalMode,
      quorum: DEFAULT_CAB.quorum,
      rejectionIsFinal: DEFAULT_CAB.rejectionIsFinal,
      isDefault: true,
    },
  });

  // Route the risk levels that require a CAB to this one.
  const cabRisks = await tx.changeRiskLevel.findMany({
    where: { helpDeskGroupId, name: { in: [...DEFAULT_CAB.riskLevelNames] } },
    select: { id: true },
  });
  await tx.cabRiskLevel.createMany({
    data: cabRisks.map((risk) => ({ helpDeskGroupId, cabId: cab.id, riskLevelId: risk.id })),
  });

  if (!options.includeStarterConfig) return;

  await tx.changeCategory.createMany({
    data: DEFAULT_CHANGE_CATEGORIES.map((category) => ({ ...category, helpDeskGroupId })),
  });

  for (const [index, category] of STARTER_CATEGORIES.entries()) {
    const createdCategory = await tx.category.create({
      data: { helpDeskGroupId, name: category.name, sortOrder: (index + 1) * 10 },
    });
    await tx.subCategory.createMany({
      data: category.subCategories.map((name, subIndex) => ({
        helpDeskGroupId,
        categoryId: createdCategory.id,
        name,
        sortOrder: (subIndex + 1) * 10,
      })),
    });
  }

  const policy = await tx.slaPolicy.create({
    data: {
      helpDeskGroupId,
      name: 'Default SLA',
      description: 'Applies to any ticket with no more specific policy.',
      businessHoursOnly: true,
      calendarId: calendar.id,
      isDefault: true,
      matchOrder: 1000,
    },
  });

  const priorities = await tx.priority.findMany({ where: { helpDeskGroupId } });
  await tx.slaTarget.createMany({
    data: priorities
      .map((priority) => {
        const target = DEFAULT_SLA_TARGETS[priority.level];
        if (!target) return null;
        return {
          helpDeskGroupId,
          slaPolicyId: policy.id,
          priorityId: priority.id,
          responseMinutes: target.responseMinutes,
          resolutionMinutes: target.resolutionMinutes,
        };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null),
  });
}

export async function updateGroup(actor: Actor, input: UpdateGroupInput, audit: AuditActor) {
  // A Super Admin may edit any group; an HD Admin may edit their own settings.
  if (!actor.isSuperAdmin) {
    requireCapability(actor, 'group:manage_settings', input.helpDeskGroupId);
  }

  const existing = await db().helpDeskGroup.findUnique({ where: { id: input.helpDeskGroupId } });
  if (!existing) throw new NotFoundError('Help desk group not found');

  const { helpDeskGroupId, ...changes } = input;
  const data: Prisma.HelpDeskGroupUpdateInput = {};
  if (changes.name !== undefined) data.name = changes.name;
  if (changes.description !== undefined) data.description = changes.description;
  if (changes.timeZone !== undefined) data.timeZone = changes.timeZone;
  if (changes.inboundEmailAddress !== undefined)
    data.inboundEmailAddress = changes.inboundEmailAddress;
  if (changes.outboundEmailAddress !== undefined)
    data.outboundEmailAddress = changes.outboundEmailAddress;
  if (changes.observerScope !== undefined) data.observerScope = changes.observerScope;
  if (changes.isActive !== undefined) {
    // Deactivating a group is a platform decision, not a group-level one.
    requireCapability(actor, 'platform:manage_groups');
    data.isActive = changes.isActive;
  }

  const updated = await db().$transaction(async (tx) => {
    const result = await tx.helpDeskGroup.update({ where: { id: helpDeskGroupId }, data });
    const diff = auditDiff(
      existing as unknown as Record<string, unknown>,
      result as unknown as Record<string, unknown>,
    );
    if (diff) {
      await recordAudit({
        action: 'help_desk_group.update',
        entityType: 'HelpDeskGroup',
        entityId: result.id,
        helpDeskGroupId: result.id,
        before: diff.before,
        after: diff.after,
        actor: audit,
        tx,
      });
    }
    return result;
  });

  return updated;
}

export async function listMembers(actor: Actor, helpDeskGroupId: string) {
  if (!actor.isSuperAdmin) {
    requireCapability(actor, 'group:manage_members', helpDeskGroupId);
  }

  return db().helpDeskMembership.findMany({
    where: { helpDeskGroupId },
    include: {
      user: { select: { id: true, name: true, email: true, isActive: true, platformRole: true } },
    },
    orderBy: [{ role: 'asc' }, { user: { name: 'asc' } }],
  });
}

/**
 * Add or change a person's role in a group.
 *
 * Sessions are revoked afterwards: a JWT minted a minute ago still carries the
 * old identity, and while roles themselves are re-read from the database per
 * request, revoking is what makes a demotion take effect for a user who is
 * mid-session on a page they should no longer see.
 */
export async function upsertMembership(
  actor: Actor,
  input: UpsertMembershipInput,
  audit: AuditActor,
) {
  if (!actor.isSuperAdmin) {
    requireCapability(actor, 'group:manage_members', input.helpDeskGroupId);
  }

  const group = await db().helpDeskGroup.findUnique({
    where: { id: input.helpDeskGroupId },
    select: { id: true, name: true },
  });
  if (!group) throw new NotFoundError('Help desk group not found');

  if (!input.userId && !input.email) {
    throw new ValidationError('Choose a person', { email: ['Provide a user or an email address'] });
  }

  const membership = await db().$transaction(async (tx) => {
    let user = input.userId
      ? await tx.user.findUnique({ where: { id: input.userId } })
      : await tx.user.findUnique({ where: { email: input.email! } });

    if (!user) {
      if (!input.email) throw new NotFoundError('User not found');
      // Invite by email: the row is a placeholder until the person signs in via
      // Entra, at which point provisioning links their oid to this row.
      user = await tx.user.create({
        data: { email: input.email, name: input.name?.trim() || input.email },
      });
      await recordAudit({
        action: 'user.invite',
        entityType: 'User',
        entityId: user.id,
        helpDeskGroupId: group.id,
        after: { email: user.email, name: user.name },
        actor: audit,
        tx,
      });
    }

    const existing = await tx.helpDeskMembership.findUnique({
      where: { userId_helpDeskGroupId: { userId: user.id, helpDeskGroupId: group.id } },
    });

    const result = await tx.helpDeskMembership.upsert({
      where: { userId_helpDeskGroupId: { userId: user.id, helpDeskGroupId: group.id } },
      create: { userId: user.id, helpDeskGroupId: group.id, role: input.role },
      update: { role: input.role, isActive: true },
      include: { user: { select: { id: true, name: true, email: true } } },
    });

    await recordAudit({
      action: existing ? 'membership.update' : 'membership.create',
      entityType: 'HelpDeskMembership',
      entityId: result.id,
      helpDeskGroupId: group.id,
      before: existing ? { role: existing.role, isActive: existing.isActive } : undefined,
      after: { role: result.role, isActive: result.isActive, userEmail: result.user.email },
      actor: audit,
      tx,
    });

    return result;
  });

  await revokeUserSessions(membership.userId);
  return membership;
}

export async function removeMembership(
  actor: Actor,
  input: { helpDeskGroupId: string; userId: string },
  audit: AuditActor,
) {
  if (!actor.isSuperAdmin) {
    requireCapability(actor, 'group:manage_members', input.helpDeskGroupId);
  }

  const existing = await db().helpDeskMembership.findUnique({
    where: {
      userId_helpDeskGroupId: { userId: input.userId, helpDeskGroupId: input.helpDeskGroupId },
    },
    include: { user: { select: { email: true } } },
  });
  if (!existing) throw new NotFoundError('That person is not a member of this help desk');

  const openTickets = await db().ticket.count({
    where: {
      helpDeskGroupId: input.helpDeskGroupId,
      assigneeId: input.userId,
      status: { category: { in: ['NEW', 'OPEN', 'PENDING', 'ON_HOLD'] } },
    },
  });
  if (openTickets > 0) {
    throw new ConflictError(
      `That person still has ${openTickets} open ticket(s) in this help desk. Reassign them first.`,
      { openTickets },
    );
  }

  await db().$transaction(async (tx) => {
    await tx.helpDeskMembership.delete({ where: { id: existing.id } });
    await recordAudit({
      action: 'membership.delete',
      entityType: 'HelpDeskMembership',
      entityId: existing.id,
      helpDeskGroupId: input.helpDeskGroupId,
      before: { role: existing.role, userEmail: existing.user.email },
      actor: audit,
      tx,
    });
  });

  await revokeUserSessions(input.userId);
}

/** Everyone who could be given a membership -- used by the add-member picker. */
export async function searchAssignableUsers(actor: Actor, helpDeskGroupId: string, query: string) {
  if (!actor.isSuperAdmin) {
    requireCapability(actor, 'group:manage_members', helpDeskGroupId);
  }

  const trimmed = query.trim();
  return db().user.findMany({
    where: {
      isActive: true,
      ...(trimmed
        ? {
            OR: [
              { name: { contains: trimmed, mode: 'insensitive' } },
              { email: { contains: trimmed, mode: 'insensitive' } },
            ],
          }
        : {}),
    },
    select: { id: true, name: true, email: true },
    orderBy: { name: 'asc' },
    take: 20,
  });
}

export const ASSIGNABLE_ROLES = [GroupRole.HD_ADMIN, GroupRole.AGENT, GroupRole.OBSERVER] as const;
