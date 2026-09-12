import { StatusCategory, TicketEventType, TicketSource } from '@/generated/prisma/enums';
import type { Prisma } from '@/generated/prisma/client';
import { db } from '@/lib/db/client';
import { scopedDb, scopedTransaction } from '@/lib/db/scoped';
import type { Actor, GroupContext } from '@/lib/authz/actor';
import { canSeeInternalNotes, requireCapability, ticketVisibilityFilter } from '@/lib/authz/guard';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { claimTicketSequence, formatTicketReference } from '@/lib/tickets/reference';
import type {
  AddCommentInput,
  CreateTicketInput,
  TicketFilter,
  UpdateTicketInput,
} from '@/lib/tickets/schemas';
import { groupLogger } from '@/lib/logger';

/**
 * Ticket operations for one help desk group.
 *
 * READS go through `scopedDb(groupId)`, so a forgotten filter cannot return
 * another group's tickets. WRITES additionally set `helpDeskGroupId` explicitly
 * from the validated GroupContext, because the tenancy extension does not reach
 * into nested creates (see src/lib/db/scoped.ts). Both layers agree on the same
 * value, and the extension throws if a caller ever passes a different one.
 */

const STATUS_CATEGORIES_OPEN: StatusCategory[] = [
  StatusCategory.NEW,
  StatusCategory.OPEN,
  StatusCategory.PENDING,
  StatusCategory.ON_HOLD,
];

const STATUS_CATEGORIES_CLOSED: StatusCategory[] = [
  StatusCategory.RESOLVED,
  StatusCategory.CLOSED,
  StatusCategory.CANCELLED,
];

/** Columns every ticket list needs, kept in one place so lists stay cheap. */
const ticketListSelect = {
  id: true,
  reference: true,
  subject: true,
  createdAt: true,
  updatedAt: true,
  resolutionDueAt: true,
  resolvedAt: true,
  resolutionBreached: true,
  status: { select: { id: true, name: true, category: true, colour: true } },
  priority: { select: { id: true, name: true, level: true, colour: true } },
  type: { select: { id: true, name: true, kind: true } },
  category: { select: { id: true, name: true } },
  assignee: { select: { id: true, name: true, email: true } },
  requester: { select: { id: true, name: true, email: true } },
  contact: { select: { id: true, name: true, email: true } },
} satisfies Prisma.TicketSelect;

export type TicketListItem = Prisma.TicketGetPayload<{ select: typeof ticketListSelect }>;

function viewFilter(view: TicketFilter['view'], actor: Actor, now: Date): Prisma.TicketWhereInput {
  switch (view) {
    case 'assigned_to_me':
      return { assigneeId: actor.userId, status: { category: { in: STATUS_CATEGORIES_OPEN } } };
    case 'unassigned':
      return { assigneeId: null, status: { category: { in: STATUS_CATEGORIES_OPEN } } };
    case 'open':
      return { status: { category: { in: STATUS_CATEGORIES_OPEN } } };
    case 'overdue':
      return {
        resolvedAt: null,
        resolutionDueAt: { lt: now },
        status: { category: { in: STATUS_CATEGORIES_OPEN } },
      };
    case 'watching':
      return { watchers: { some: { userId: actor.userId } } };
    case 'all':
    default:
      return {};
  }
}

export function buildTicketWhere(
  actor: Actor,
  group: GroupContext,
  filter: TicketFilter,
  now = new Date(),
): Prisma.TicketWhereInput {
  const clauses: Prisma.TicketWhereInput[] = [
    ticketVisibilityFilter(actor, group.helpDeskGroupId),
    viewFilter(filter.view, actor, now),
  ];

  if (filter.q) {
    clauses.push({
      OR: [
        { reference: { contains: filter.q, mode: 'insensitive' } },
        { subject: { contains: filter.q, mode: 'insensitive' } },
      ],
    });
  }
  if (filter.statusId) clauses.push({ statusId: filter.statusId });
  if (filter.priorityId) clauses.push({ priorityId: filter.priorityId });
  if (filter.categoryId) clauses.push({ categoryId: filter.categoryId });
  if (filter.assigneeId === 'me') clauses.push({ assigneeId: actor.userId });
  else if (filter.assigneeId === 'none') clauses.push({ assigneeId: null });
  else if (filter.assigneeId) clauses.push({ assigneeId: filter.assigneeId });

  return { AND: clauses };
}

export async function listTickets(
  actor: Actor,
  group: GroupContext,
  filter: TicketFilter,
): Promise<{ items: TicketListItem[]; total: number; page: number; pageSize: number }> {
  requireCapability(actor, 'ticket:read', group.helpDeskGroupId);

  const scoped = scopedDb(group.helpDeskGroupId);
  const where = buildTicketWhere(actor, group, filter);

  const [items, total] = await Promise.all([
    scoped.ticket.findMany({
      where,
      select: ticketListSelect,
      orderBy: [{ priority: { level: 'asc' } }, { createdAt: 'desc' }],
      skip: (filter.page - 1) * filter.pageSize,
      take: filter.pageSize,
    }),
    scoped.ticket.count({ where }),
  ]);

  return { items, total, page: filter.page, pageSize: filter.pageSize };
}

export async function getTicketDetail(actor: Actor, group: GroupContext, ticketId: string) {
  requireCapability(actor, 'ticket:read', group.helpDeskGroupId);

  const scoped = scopedDb(group.helpDeskGroupId);
  const showInternal = canSeeInternalNotes(actor, group.helpDeskGroupId);

  const ticket = await scoped.ticket.findFirst({
    where: { AND: [{ id: ticketId }, ticketVisibilityFilter(actor, group.helpDeskGroupId)] },
    include: {
      group: {
        select: { id: true, name: true, inboundEmailAddress: true, outboundEmailAddress: true },
      },
      status: true,
      priority: true,
      type: true,
      category: true,
      subCategory: true,
      assignee: { select: { id: true, name: true, email: true } },
      requester: { select: { id: true, name: true, email: true } },
      contact: true,
      createdBy: { select: { id: true, name: true, email: true } },
      watchers: { include: { user: { select: { id: true, name: true, email: true } } } },
      comments: {
        // Observers and requesters never receive internal notes.
        where: showInternal ? undefined : { isInternal: false },
        orderBy: { createdAt: 'asc' },
        include: { author: { select: { id: true, name: true, email: true } } },
      },
      attachments: { orderBy: { createdAt: 'asc' } },
      events: {
        orderBy: { createdAt: 'desc' },
        take: 100,
        include: { actor: { select: { id: true, name: true } } },
      },
    },
  });

  if (!ticket) throw new NotFoundError('Ticket not found');
  return ticket;
}

/** Resolve the group's configured defaults for status/type/priority. */
async function groupDefaults(helpDeskGroupId: string) {
  const scoped = scopedDb(helpDeskGroupId);
  const [status, type, priority] = await Promise.all([
    scoped.ticketStatus.findFirst({
      where: { isActive: true },
      orderBy: [{ isDefault: 'desc' }, { sortOrder: 'asc' }],
    }),
    scoped.ticketType.findFirst({
      where: { isActive: true },
      orderBy: [{ isDefault: 'desc' }, { sortOrder: 'asc' }],
    }),
    scoped.priority.findFirst({
      where: { isActive: true },
      orderBy: [{ isDefault: 'desc' }, { level: 'asc' }],
    }),
  ]);
  return { status, type, priority };
}

export async function createTicket(
  actor: Actor,
  group: GroupContext,
  input: CreateTicketInput,
  source: TicketSource = TicketSource.WEB,
) {
  requireCapability(actor, 'ticket:create', group.helpDeskGroupId);
  const helpDeskGroupId = group.helpDeskGroupId;
  const scoped = scopedDb(helpDeskGroupId);

  // Validate every referenced id against THIS group. Without this a caller
  // could attach another group's category to a ticket by guessing its id.
  const [type, priority, category, subCategory] = await Promise.all([
    scoped.ticketType.findFirst({ where: { id: input.typeId, isActive: true } }),
    scoped.priority.findFirst({ where: { id: input.priorityId, isActive: true } }),
    input.categoryId
      ? scoped.category.findFirst({ where: { id: input.categoryId, isActive: true } })
      : Promise.resolve(null),
    input.subCategoryId
      ? scoped.subCategory.findFirst({ where: { id: input.subCategoryId, isActive: true } })
      : Promise.resolve(null),
  ]);

  const fieldErrors: Record<string, string[]> = {};
  if (!type) fieldErrors.typeId = ['Unknown ticket type for this help desk'];
  if (!priority) fieldErrors.priorityId = ['Unknown priority for this help desk'];
  if (input.categoryId && !category)
    fieldErrors.categoryId = ['Unknown category for this help desk'];
  if (input.subCategoryId && !subCategory) {
    fieldErrors.subCategoryId = ['Unknown subcategory for this help desk'];
  }
  if (subCategory && category && subCategory.categoryId !== category.id) {
    fieldErrors.subCategoryId = ['Subcategory does not belong to the selected category'];
  }
  if (Object.keys(fieldErrors).length > 0) {
    throw new ValidationError('Ticket could not be created', fieldErrors);
  }

  const statusId =
    input.statusId ??
    (await groupDefaults(helpDeskGroupId)).status?.id ??
    (() => {
      throw new ConflictError(
        'This help desk has no active ticket statuses configured. An administrator must add one.',
      );
    })();

  if (input.assigneeId) await assertGroupMember(helpDeskGroupId, input.assigneeId, 'assigneeId');
  if (input.requesterId) await assertUserExists(input.requesterId, 'requesterId');

  const ticket = await scopedTransaction(helpDeskGroupId, async (tx) => {
    const sequence = await claimTicketSequence(tx, helpDeskGroupId);
    const reference = formatTicketReference(group.groupKey, sequence);

    const created = await tx.ticket.create({
      data: {
        helpDeskGroupId,
        reference,
        sequence,
        subject: input.subject,
        description: input.description,
        typeId: input.typeId,
        priorityId: input.priorityId,
        statusId,
        categoryId: input.categoryId ?? null,
        subCategoryId: input.subCategoryId ?? null,
        requesterId: input.requesterId ?? actor.userId,
        assigneeId: input.assigneeId ?? null,
        createdById: actor.userId,
        source,
        events: {
          create: {
            // Nested create: helpDeskGroupId is set by hand on purpose -- the
            // tenancy extension does not see nested rows.
            helpDeskGroupId,
            actorId: actor.userId,
            type: TicketEventType.CREATED,
          },
        },
        ...(input.watcherIds.length > 0
          ? {
              watchers: {
                create: input.watcherIds.map((userId) => ({
                  helpDeskGroupId,
                  userId,
                  addedById: actor.userId,
                })),
              },
            }
          : {}),
      },
      select: { id: true, reference: true },
    });

    return created;
  });

  groupLogger(helpDeskGroupId).info(
    { ticketId: ticket.id, reference: ticket.reference, actorUserId: actor.userId },
    'ticket created',
  );

  // TODO(phase-2): apply the matching SLA policy and populate
  // firstResponseDueAt / resolutionDueAt from business-hours arithmetic.
  // TODO(phase-6): run TICKET_CREATED workflow rules.
  return ticket;
}

export async function updateTicket(actor: Actor, group: GroupContext, input: UpdateTicketInput) {
  requireCapability(actor, 'ticket:update', group.helpDeskGroupId);
  const helpDeskGroupId = group.helpDeskGroupId;
  const scoped = scopedDb(helpDeskGroupId);

  const existing = await scoped.ticket.findFirst({
    where: { id: input.ticketId },
    include: { status: true },
  });
  if (!existing) throw new NotFoundError('Ticket not found');

  if (input.assigneeId !== undefined && input.assigneeId !== null) {
    requireCapability(actor, 'ticket:assign', helpDeskGroupId);
    await assertGroupMember(helpDeskGroupId, input.assigneeId, 'assigneeId');
  }

  let nextStatus = existing.status;
  if (input.statusId && input.statusId !== existing.statusId) {
    const status = await scoped.ticketStatus.findFirst({
      where: { id: input.statusId, isActive: true },
    });
    if (!status) {
      throw new ValidationError('Ticket could not be updated', {
        statusId: ['Unknown status for this help desk'],
      });
    }
    nextStatus = status;

    if (STATUS_CATEGORIES_CLOSED.includes(status.category)) {
      requireCapability(
        actor,
        status.category === StatusCategory.RESOLVED ? 'ticket:resolve' : 'ticket:close',
        helpDeskGroupId,
      );
    }
    if (
      STATUS_CATEGORIES_OPEN.includes(status.category) &&
      STATUS_CATEGORIES_CLOSED.includes(existing.status.category)
    ) {
      requireCapability(actor, 'ticket:reopen', helpDeskGroupId);
    }
  }

  const now = new Date();
  const statusChanged = nextStatus.id !== existing.statusId;
  const reopened =
    statusChanged &&
    STATUS_CATEGORIES_OPEN.includes(nextStatus.category) &&
    STATUS_CATEGORIES_CLOSED.includes(existing.status.category);

  const data: Prisma.TicketUpdateInput = {
    ...(input.subject !== undefined ? { subject: input.subject } : {}),
    ...(input.description !== undefined ? { description: input.description } : {}),
    ...(input.typeId ? { typeId: input.typeId } : {}),
    ...(input.priorityId ? { priorityId: input.priorityId } : {}),
    ...(input.categoryId !== undefined ? { categoryId: input.categoryId ?? null } : {}),
    ...(input.subCategoryId !== undefined ? { subCategoryId: input.subCategoryId ?? null } : {}),
    ...(input.assigneeId !== undefined ? { assigneeId: input.assigneeId } : {}),
    ...(statusChanged ? { statusId: nextStatus.id } : {}),
    ...(statusChanged && nextStatus.category === StatusCategory.RESOLVED
      ? { resolvedAt: now }
      : {}),
    ...(statusChanged && nextStatus.category === StatusCategory.CLOSED ? { closedAt: now } : {}),
    ...(reopened ? { resolvedAt: null, closedAt: null, reopenCount: { increment: 1 } } : {}),
  };

  const events = buildChangeEvents(actor, helpDeskGroupId, existing, input, nextStatus, reopened);

  const updated = await scopedTransaction(helpDeskGroupId, async (tx) => {
    const result = await tx.ticket.update({
      where: { id: input.ticketId, helpDeskGroupId },
      data,
      select: { id: true, reference: true },
    });
    if (events.length > 0) {
      await tx.ticketEvent.createMany({ data: events });
    }
    return result;
  });

  groupLogger(helpDeskGroupId).info(
    { ticketId: updated.id, actorUserId: actor.userId, statusChanged },
    'ticket updated',
  );

  // TODO(phase-2): recalculate SLA pause state when the new status pausesSla.
  return updated;
}

function buildChangeEvents(
  actor: Actor,
  helpDeskGroupId: string,
  existing: {
    statusId: string;
    priorityId: string;
    assigneeId: string | null;
    categoryId: string | null;
  },
  input: UpdateTicketInput,
  nextStatus: { id: string; name: string },
  reopened: boolean,
): Prisma.TicketEventCreateManyInput[] {
  const events: Prisma.TicketEventCreateManyInput[] = [];
  const base = {
    helpDeskGroupId,
    ticketId: input.ticketId,
    actorId: actor.userId,
  };

  if (nextStatus.id !== existing.statusId) {
    events.push({
      ...base,
      type: reopened ? TicketEventType.REOPENED : TicketEventType.STATUS_CHANGED,
      field: 'statusId',
      oldValue: existing.statusId,
      newValue: nextStatus.id,
    });
  }
  if (input.priorityId && input.priorityId !== existing.priorityId) {
    events.push({
      ...base,
      type: TicketEventType.PRIORITY_CHANGED,
      field: 'priorityId',
      oldValue: existing.priorityId,
      newValue: input.priorityId,
    });
  }
  if (input.assigneeId !== undefined && input.assigneeId !== existing.assigneeId) {
    events.push({
      ...base,
      type: input.assigneeId ? TicketEventType.ASSIGNED : TicketEventType.UNASSIGNED,
      field: 'assigneeId',
      oldValue: existing.assigneeId,
      newValue: input.assigneeId,
    });
  }
  if (input.categoryId !== undefined && (input.categoryId ?? null) !== existing.categoryId) {
    events.push({
      ...base,
      type: TicketEventType.CATEGORY_CHANGED,
      field: 'categoryId',
      oldValue: existing.categoryId,
      newValue: input.categoryId ?? null,
    });
  }

  return events;
}

export async function addComment(actor: Actor, group: GroupContext, input: AddCommentInput) {
  requireCapability(actor, 'ticket:comment', group.helpDeskGroupId);
  if (input.isInternal) {
    requireCapability(actor, 'ticket:comment_internal', group.helpDeskGroupId);
  }

  const helpDeskGroupId = group.helpDeskGroupId;
  const scoped = scopedDb(helpDeskGroupId);

  const ticket = await scoped.ticket.findFirst({
    where: { id: input.ticketId },
    select: { id: true, firstRespondedAt: true, requesterId: true },
  });
  if (!ticket) throw new NotFoundError('Ticket not found');

  // First public reply from someone other than the requester stops the response
  // clock. Phase 2 turns this timestamp into an SLA outcome.
  const isFirstResponse =
    !ticket.firstRespondedAt && !input.isInternal && ticket.requesterId !== actor.userId;

  const comment = await scopedTransaction(helpDeskGroupId, async (tx) => {
    const created = await tx.ticketComment.create({
      data: {
        helpDeskGroupId,
        ticketId: input.ticketId,
        authorId: actor.userId,
        body: input.body,
        isInternal: input.isInternal,
      },
      select: { id: true },
    });

    await tx.ticketEvent.create({
      data: {
        helpDeskGroupId,
        ticketId: input.ticketId,
        actorId: actor.userId,
        type: TicketEventType.COMMENT_ADDED,
        metadata: { commentId: created.id, isInternal: input.isInternal },
      },
    });

    if (isFirstResponse) {
      await tx.ticket.update({
        where: { id: input.ticketId, helpDeskGroupId },
        data: { firstRespondedAt: new Date() },
      });
    }

    return created;
  });

  // TODO(phase-2): queue the TICKET_COMMENT_ADDED notification to watchers.
  return comment;
}

/** Dashboard tiles for the active group (brief phase 1: assigned/open/overdue). */
export async function dashboardSummary(actor: Actor, group: GroupContext) {
  requireCapability(actor, 'ticket:read', group.helpDeskGroupId);

  const scoped = scopedDb(group.helpDeskGroupId);
  const visibility = ticketVisibilityFilter(actor, group.helpDeskGroupId);
  const now = new Date();

  const [assignedToMe, open, unassigned, overdue, resolvedToday, byStatus, byPriority] =
    await Promise.all([
      scoped.ticket.count({
        where: {
          AND: [
            visibility,
            { assigneeId: actor.userId, status: { category: { in: STATUS_CATEGORIES_OPEN } } },
          ],
        },
      }),
      scoped.ticket.count({
        where: { AND: [visibility, { status: { category: { in: STATUS_CATEGORIES_OPEN } } }] },
      }),
      scoped.ticket.count({
        where: {
          AND: [
            visibility,
            { assigneeId: null, status: { category: { in: STATUS_CATEGORIES_OPEN } } },
          ],
        },
      }),
      scoped.ticket.count({
        where: {
          AND: [
            visibility,
            {
              resolvedAt: null,
              resolutionDueAt: { lt: now },
              status: { category: { in: STATUS_CATEGORIES_OPEN } },
            },
          ],
        },
      }),
      scoped.ticket.count({
        where: {
          AND: [
            visibility,
            { resolvedAt: { gte: new Date(now.getFullYear(), now.getMonth(), now.getDate()) } },
          ],
        },
      }),
      scoped.ticket.groupBy({
        by: ['statusId'],
        where: { AND: [visibility] },
        _count: { _all: true },
      }),
      scoped.ticket.groupBy({
        by: ['priorityId'],
        where: { AND: [visibility, { status: { category: { in: STATUS_CATEGORIES_OPEN } } }] },
        _count: { _all: true },
      }),
    ]);

  const [statuses, priorities] = await Promise.all([
    scoped.ticketStatus.findMany({ orderBy: { sortOrder: 'asc' } }),
    scoped.priority.findMany({ orderBy: { level: 'asc' } }),
  ]);

  return {
    tiles: { assignedToMe, open, unassigned, overdue, resolvedToday },
    byStatus: statuses.map((status) => ({
      id: status.id,
      name: status.name,
      colour: status.colour,
      count: byStatus.find((row) => row.statusId === status.id)?._count._all ?? 0,
    })),
    byPriority: priorities.map((priority) => ({
      id: priority.id,
      name: priority.name,
      colour: priority.colour,
      count: byPriority.find((row) => row.priorityId === priority.id)?._count._all ?? 0,
    })),
  };
}

/** Options needed to render the ticket create/edit forms. */
export async function ticketFormOptions(group: GroupContext) {
  const scoped = scopedDb(group.helpDeskGroupId);
  const [types, priorities, statuses, categories, members] = await Promise.all([
    scoped.ticketType.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } }),
    scoped.priority.findMany({ where: { isActive: true }, orderBy: { level: 'asc' } }),
    scoped.ticketStatus.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } }),
    scoped.category.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
      include: {
        subCategories: { where: { isActive: true }, orderBy: { sortOrder: 'asc' } },
      },
    }),
    scoped.helpDeskMembership.findMany({
      where: { isActive: true, role: { in: ['AGENT', 'HD_ADMIN'] } },
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { user: { name: 'asc' } },
    }),
  ]);

  return {
    types,
    priorities,
    statuses,
    categories,
    assignees: members.map((membership) => membership.user),
  };
}

async function assertGroupMember(
  helpDeskGroupId: string,
  userId: string,
  field: string,
): Promise<void> {
  const membership = await db().helpDeskMembership.findFirst({
    where: { helpDeskGroupId, userId, isActive: true, role: { in: ['AGENT', 'HD_ADMIN'] } },
    select: { id: true },
  });
  if (!membership) {
    throw new ValidationError('Invalid assignee', {
      [field]: ['That person is not an agent in this help desk'],
    });
  }
}

async function assertUserExists(userId: string, field: string): Promise<void> {
  const user = await db().user.findFirst({
    where: { id: userId, isActive: true },
    select: { id: true },
  });
  if (!user) {
    throw new ValidationError('Invalid user', { [field]: ['Unknown user'] });
  }
}

/** Everyone in the group, for the watcher picker (observers included). */
export async function groupMembers(group: GroupContext) {
  const members = await scopedDb(group.helpDeskGroupId).helpDeskMembership.findMany({
    where: { isActive: true },
    include: { user: { select: { id: true, name: true, email: true } } },
    orderBy: { user: { name: 'asc' } },
  });
  return members.map((membership) => ({ ...membership.user, role: membership.role }));
}
