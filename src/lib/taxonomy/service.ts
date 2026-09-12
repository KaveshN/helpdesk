import type { Prisma } from '@/generated/prisma/client';
import { scopedDb, scopedTransaction } from '@/lib/db/scoped';
import { auditDiff, recordAudit, type AuditActor } from '@/lib/audit';
import { requireCapability } from '@/lib/authz/guard';
import type { Actor, GroupContext } from '@/lib/authz/actor';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import type {
  CategoryInput,
  PriorityInput,
  StatusInput,
  SubCategoryInput,
  TicketTypeInput,
} from '@/lib/taxonomy/schemas';

/**
 * Admin-configurable ticket taxonomy for one group (brief §8: no hardcoded
 * values that need a code change).
 *
 * Each entity gets its own function rather than one dynamic table-driven CRUD:
 * looking up a Prisma delegate by string loses all model typing, and these are
 * the writes where a wrong column silently corrupts a tenant's configuration.
 *
 * Deactivation, not deletion, is the deliberate default. Rows are referenced by
 * historical tickets; deleting a status would either orphan or cascade them.
 */

type Ctx = { actor: Actor; group: GroupContext; audit: AuditActor };

function assertTaxonomyPermission({ actor, group }: Ctx): void {
  requireCapability(actor, 'group:manage_taxonomy', group.helpDeskGroupId);
}

export async function listTaxonomy(actor: Actor, group: GroupContext) {
  requireCapability(actor, 'group:view_settings', group.helpDeskGroupId);
  const scoped = scopedDb(group.helpDeskGroupId);

  const [categories, statuses, priorities, types] = await Promise.all([
    scoped.category.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: { subCategories: { orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] } },
    }),
    scoped.ticketStatus.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
    scoped.priority.findMany({ orderBy: [{ level: 'asc' }] }),
    scoped.ticketType.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
  ]);

  return { categories, statuses, priorities, types };
}

// --- Category --------------------------------------------------------------

export async function saveCategory(ctx: Ctx, input: CategoryInput) {
  assertTaxonomyPermission(ctx);
  const helpDeskGroupId = ctx.group.helpDeskGroupId;
  const scoped = scopedDb(helpDeskGroupId);

  const clash = await scoped.category.findFirst({
    where: { name: input.name, ...(input.id ? { id: { not: input.id } } : {}) },
    select: { id: true },
  });
  if (clash)
    throw new ValidationError('Category not saved', { name: ['That name is already used'] });

  const before = input.id ? await scoped.category.findFirst({ where: { id: input.id } }) : null;
  if (input.id && !before) throw new NotFoundError('Category not found');

  return scopedTransaction(helpDeskGroupId, async (tx) => {
    const result = input.id
      ? await tx.category.update({
          where: { id: input.id, helpDeskGroupId },
          data: {
            name: input.name,
            description: input.description ?? null,
            sortOrder: input.sortOrder,
            isActive: input.isActive,
          },
        })
      : await tx.category.create({
          data: {
            helpDeskGroupId,
            name: input.name,
            description: input.description ?? null,
            sortOrder: input.sortOrder,
            isActive: input.isActive,
          },
        });

    await writeAudit(tx, ctx, 'category', 'Category', before, result, helpDeskGroupId);
    return result;
  });
}

// --- SubCategory -----------------------------------------------------------

export async function saveSubCategory(ctx: Ctx, input: SubCategoryInput) {
  assertTaxonomyPermission(ctx);
  const helpDeskGroupId = ctx.group.helpDeskGroupId;
  const scoped = scopedDb(helpDeskGroupId);

  const parent = await scoped.category.findFirst({ where: { id: input.categoryId } });
  if (!parent) {
    throw new ValidationError('Subcategory not saved', {
      categoryId: ['Unknown category for this help desk'],
    });
  }

  const clash = await scoped.subCategory.findFirst({
    where: {
      categoryId: input.categoryId,
      name: input.name,
      ...(input.id ? { id: { not: input.id } } : {}),
    },
    select: { id: true },
  });
  if (clash) {
    throw new ValidationError('Subcategory not saved', {
      name: ['That name is already used in this category'],
    });
  }

  const before = input.id ? await scoped.subCategory.findFirst({ where: { id: input.id } }) : null;
  if (input.id && !before) throw new NotFoundError('Subcategory not found');

  return scopedTransaction(helpDeskGroupId, async (tx) => {
    const result = input.id
      ? await tx.subCategory.update({
          where: { id: input.id, helpDeskGroupId },
          data: {
            categoryId: input.categoryId,
            name: input.name,
            description: input.description ?? null,
            sortOrder: input.sortOrder,
            isActive: input.isActive,
          },
        })
      : await tx.subCategory.create({
          data: {
            helpDeskGroupId,
            categoryId: input.categoryId,
            name: input.name,
            description: input.description ?? null,
            sortOrder: input.sortOrder,
            isActive: input.isActive,
          },
        });

    await writeAudit(tx, ctx, 'sub_category', 'SubCategory', before, result, helpDeskGroupId);
    return result;
  });
}

// --- TicketStatus ----------------------------------------------------------

export async function saveStatus(ctx: Ctx, input: StatusInput) {
  assertTaxonomyPermission(ctx);
  const helpDeskGroupId = ctx.group.helpDeskGroupId;
  const scoped = scopedDb(helpDeskGroupId);

  const clash = await scoped.ticketStatus.findFirst({
    where: { name: input.name, ...(input.id ? { id: { not: input.id } } : {}) },
    select: { id: true },
  });
  if (clash) throw new ValidationError('Status not saved', { name: ['That name is already used'] });

  const before = input.id ? await scoped.ticketStatus.findFirst({ where: { id: input.id } }) : null;
  if (input.id && !before) throw new NotFoundError('Status not found');

  // Deactivating the last usable status would make ticket creation impossible.
  if (before && before.isActive && !input.isActive) {
    const remaining = await scoped.ticketStatus.count({
      where: { isActive: true, id: { not: before.id } },
    });
    if (remaining === 0) {
      throw new ConflictError(
        'At least one status must stay active, otherwise no ticket can be created.',
      );
    }
  }

  return scopedTransaction(helpDeskGroupId, async (tx) => {
    // Exactly one default: clearing the others here keeps the invariant that
    // groupDefaults() always resolves to something sensible.
    if (input.isDefault) {
      await tx.ticketStatus.updateMany({
        where: { helpDeskGroupId, isDefault: true, ...(input.id ? { id: { not: input.id } } : {}) },
        data: { isDefault: false },
      });
    }

    const data = {
      name: input.name,
      category: input.category,
      pausesSla: input.pausesSla,
      colour: input.colour ?? null,
      sortOrder: input.sortOrder,
      isDefault: input.isDefault,
      isActive: input.isActive,
    };

    const result = input.id
      ? await tx.ticketStatus.update({ where: { id: input.id, helpDeskGroupId }, data })
      : await tx.ticketStatus.create({ data: { helpDeskGroupId, ...data } });

    await writeAudit(tx, ctx, 'ticket_status', 'TicketStatus', before, result, helpDeskGroupId);
    return result;
  });
}

// --- Priority --------------------------------------------------------------

export async function savePriority(ctx: Ctx, input: PriorityInput) {
  assertTaxonomyPermission(ctx);
  const helpDeskGroupId = ctx.group.helpDeskGroupId;
  const scoped = scopedDb(helpDeskGroupId);

  const fieldErrors: Record<string, string[]> = {};
  const nameClash = await scoped.priority.findFirst({
    where: { name: input.name, ...(input.id ? { id: { not: input.id } } : {}) },
    select: { id: true },
  });
  if (nameClash) fieldErrors.name = ['That name is already used'];

  const levelClash = await scoped.priority.findFirst({
    where: { level: input.level, ...(input.id ? { id: { not: input.id } } : {}) },
    select: { id: true, name: true },
  });
  if (levelClash)
    fieldErrors.level = [`Level ${input.level} is already used by ${levelClash.name}`];

  if (Object.keys(fieldErrors).length > 0)
    throw new ValidationError('Priority not saved', fieldErrors);

  const before = input.id ? await scoped.priority.findFirst({ where: { id: input.id } }) : null;
  if (input.id && !before) throw new NotFoundError('Priority not found');

  return scopedTransaction(helpDeskGroupId, async (tx) => {
    if (input.isDefault) {
      await tx.priority.updateMany({
        where: { helpDeskGroupId, isDefault: true, ...(input.id ? { id: { not: input.id } } : {}) },
        data: { isDefault: false },
      });
    }

    const data = {
      name: input.name,
      level: input.level,
      colour: input.colour ?? null,
      isDefault: input.isDefault,
      isActive: input.isActive,
    };

    const result = input.id
      ? await tx.priority.update({ where: { id: input.id, helpDeskGroupId }, data })
      : await tx.priority.create({ data: { helpDeskGroupId, ...data } });

    await writeAudit(tx, ctx, 'priority', 'Priority', before, result, helpDeskGroupId);
    return result;
  });
}

// --- TicketType ------------------------------------------------------------

export async function saveTicketType(ctx: Ctx, input: TicketTypeInput) {
  assertTaxonomyPermission(ctx);
  const helpDeskGroupId = ctx.group.helpDeskGroupId;
  const scoped = scopedDb(helpDeskGroupId);

  const clash = await scoped.ticketType.findFirst({
    where: { name: input.name, ...(input.id ? { id: { not: input.id } } : {}) },
    select: { id: true },
  });
  if (clash)
    throw new ValidationError('Ticket type not saved', { name: ['That name is already used'] });

  const before = input.id ? await scoped.ticketType.findFirst({ where: { id: input.id } }) : null;
  if (input.id && !before) throw new NotFoundError('Ticket type not found');

  return scopedTransaction(helpDeskGroupId, async (tx) => {
    if (input.isDefault) {
      await tx.ticketType.updateMany({
        where: { helpDeskGroupId, isDefault: true, ...(input.id ? { id: { not: input.id } } : {}) },
        data: { isDefault: false },
      });
    }

    const data = {
      name: input.name,
      kind: input.kind,
      description: input.description ?? null,
      sortOrder: input.sortOrder,
      isDefault: input.isDefault,
      isActive: input.isActive,
    };

    const result = input.id
      ? await tx.ticketType.update({ where: { id: input.id, helpDeskGroupId }, data })
      : await tx.ticketType.create({ data: { helpDeskGroupId, ...data } });

    await writeAudit(tx, ctx, 'ticket_type', 'TicketType', before, result, helpDeskGroupId);
    return result;
  });
}

/** Shared audit write: only the changed fields, with a consistent action name. */
async function writeAudit(
  tx: Prisma.TransactionClient,
  ctx: Ctx,
  entity: string,
  entityType: string,
  before: Record<string, unknown> | null,
  after: Record<string, unknown>,
  helpDeskGroupId: string,
): Promise<void> {
  const diff = auditDiff(before ?? undefined, after);
  await recordAudit({
    action: `${entity}.${before ? 'update' : 'create'}`,
    entityType,
    entityId: String(after.id),
    helpDeskGroupId,
    before: diff?.before,
    after: diff?.after ?? after,
    actor: ctx.audit,
    tx,
  });
}
