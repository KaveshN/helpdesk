import { TenancyViolationError } from '@/lib/errors';
import { db } from '@/lib/db/client';

/**
 * GROUP ISOLATION (brief §8).
 *
 * `scopedDb(groupId)` returns a Prisma client that rewrites every query against
 * a tenant table so it can only ever see or touch one help desk group. The goal
 * is that leaking data across groups requires deliberately reaching around this
 * layer, rather than merely forgetting a `where` clause.
 *
 * KNOWN GAPS -- read before trusting this blindly:
 *  1. `$queryRaw` / `$executeRaw` bypass extensions entirely. Raw SQL against a
 *     tenant table must filter on helpDeskGroupId by hand.
 *  2. Nested writes (`data: { comments: { create: {...} } }`) are not rewritten;
 *     the extension only sees the top-level model. Set helpDeskGroupId
 *     explicitly on nested rows -- the columns are NOT NULL, so you will get a
 *     loud failure rather than a silent cross-group row.
 *  3. Relation filters (`where: { ticket: { ... } }`) are not rewritten either.
 *     They are still safe: the top-level scope narrows the result set first.
 *  4. The ownership pre-check for single-row writes reads through the unscoped
 *     client, i.e. outside any caller-supplied interactive transaction. A row
 *     created and then updated inside the same transaction is therefore not yet
 *     visible to the check; set helpDeskGroupId explicitly in that case (which
 *     the ticket service does anyway).
 *
 * The durable fix for (1) and (2) is Postgres row-level security with a
 * per-transaction `SET LOCAL app.current_group_id`. That is worth doing before
 * this platform holds data for groups that must not see each other for legal
 * reasons; it is deliberately out of scope for Phase 1.
 */

/** Tables whose `helpDeskGroupId` is NOT NULL. Must match schema.prisma. */
export const GROUP_SCOPED_MODELS = new Set([
  'HelpDeskMembership',
  'TicketType',
  'Priority',
  'TicketStatus',
  'Category',
  'SubCategory',
  'SlaPolicy',
  'SlaTarget',
  'Calendar',
  'WorkingHours',
  'Holiday',
  'AfterHoursConfig',
  'AfterHoursContact',
  'Workflow',
  'WorkflowCondition',
  'WorkflowAction',
  'NotificationTemplate',
  'NotificationLog',
  'Ticket',
  'TicketWatcher',
  'TicketComment',
  'TicketAttachment',
  'TicketEvent',
  'ChangeType',
  'ChangeCategory',
  'ChangeRiskLevel',
  'ChangeRequest',
  'ChangeApproval',
  'ChangeEvent',
  'Cab',
  'CabMember',
  'CabRiskLevel',
  'ArticleTicketLink',
  'ReportDefinition',
  'ScheduledReport',
  'ReportRun',
  'InboundEmail',
  'OutboundEmail',
  'Contact',
  'LeaderboardConfig',
  'AgentTarget',
  'Achievement',
  'AgentAchievement',
  'CsatResponse',
]);

/**
 * Strictly-scoped tables whose `helpDeskGroupId` column is nevertheless
 * nullable, and why.
 *
 * `InboundEmail` rows are written by the email poller before the recipient
 * address has been resolved to a group, so the column starts NULL. Strict
 * scoping is still the correct behaviour: `helpDeskGroupId = <group>` excludes
 * those NULL rows, and unresolved inbound mail is a platform/worker concern
 * rather than something one help desk should see.
 */
export const STRICT_NULLABLE_COLUMN_MODELS = new Set(['InboundEmail']);

/**
 * Tables where `helpDeskGroupId IS NULL` means "platform-global": readable from
 * every group, writable only through the unscoped client (a Super Admin action).
 */
export const GLOBAL_OR_GROUP_MODELS = new Set(['KnowledgeArticle', 'ArticleCategory']);

/**
 * Platform tables the scope never touches. Listed explicitly so that adding a
 * model to schema.prisma without classifying it here is caught by a test rather
 * than silently defaulting to "unscoped".
 */
export const UNSCOPED_MODELS = new Set([
  'User',
  'HelpDeskGroup',
  'AuditLog',
  'KnowledgeArticleVersion',
]);

const READ_OPERATIONS = new Set([
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
]);

/** Operations addressing a single row by unique key -- need an ownership check. */
const UNIQUE_WRITE_OPERATIONS = new Set(['update', 'delete', 'upsert']);

const BATCH_WRITE_OPERATIONS = new Set(['updateMany', 'updateManyAndReturn', 'deleteMany']);

const CREATE_OPERATIONS = new Set(['create', 'createMany', 'createManyAndReturn']);

type AnyArgs = Record<string, unknown>;

export type ScopeMode = 'strict' | 'globalOrGroup';

export function scopeModeFor(model: string): ScopeMode | null {
  if (GROUP_SCOPED_MODELS.has(model)) return 'strict';
  if (GLOBAL_OR_GROUP_MODELS.has(model)) return 'globalOrGroup';
  return null;
}

/** The clause ANDed onto every read for a scoped model. */
export function scopeClause(mode: ScopeMode, groupId: string): AnyArgs {
  return mode === 'strict'
    ? { helpDeskGroupId: groupId }
    : { OR: [{ helpDeskGroupId: groupId }, { helpDeskGroupId: null }] };
}

/**
 * ANDs `clause` onto an existing `where` without clobbering it. The original
 * top-level keys are preserved so `findUnique`-style unique lookups still
 * satisfy Prisma's "needs a unique field" validation.
 */
export function mergeWhere(where: unknown, clause: AnyArgs): AnyArgs {
  const original = (where ?? {}) as AnyArgs;
  const existingAnd = original.AND;
  const andList =
    existingAnd === undefined ? [] : Array.isArray(existingAnd) ? existingAnd : [existingAnd];
  return { ...original, AND: [...andList, clause] };
}

/**
 * Force the tenant column onto created rows, rejecting any explicit value that
 * disagrees with the active scope.
 */
export function scopeCreateData(
  data: unknown,
  groupId: string,
  model: string,
  operation: string,
): unknown {
  if (Array.isArray(data)) {
    return data.map((row) => scopeCreateData(row, groupId, model, operation));
  }
  if (data === null || typeof data !== 'object') return data;

  const row = data as AnyArgs;
  const declared = row.helpDeskGroupId;
  if (declared !== undefined && declared !== groupId) {
    throw new TenancyViolationError({
      model,
      operation,
      expected: groupId,
      actual: typeof declared === 'string' ? declared : null,
    });
  }
  return { ...row, helpDeskGroupId: groupId };
}

/**
 * Pure rewrite of a Prisma operation's arguments for a given scope.
 *
 * Returned `operation` may differ from the input: `findUnique` becomes
 * `findFirst` so the tenant filter can be applied without depending on
 * Prisma's extended-unique-where semantics.
 *
 * `ownershipCheck` is set for single-row writes; the caller must verify the
 * target row's group before running the query (see `scopedDb`).
 */
export function rewriteOperation(input: {
  model: string;
  operation: string;
  args: AnyArgs;
  groupId: string;
}): { operation: string; args: AnyArgs; ownershipCheck: boolean } {
  const { model, operation, groupId } = input;
  const mode = scopeModeFor(model);
  if (!mode) return { operation, args: input.args, ownershipCheck: false };

  const clause = scopeClause(mode, groupId);
  const args = { ...input.args };

  if (operation === 'findUnique' || operation === 'findUniqueOrThrow') {
    return {
      operation: operation === 'findUnique' ? 'findFirst' : 'findFirstOrThrow',
      args: { ...args, where: mergeWhere(args.where, clause) },
      ownershipCheck: false,
    };
  }

  if (READ_OPERATIONS.has(operation) || BATCH_WRITE_OPERATIONS.has(operation)) {
    return {
      operation,
      args: { ...args, where: mergeWhere(args.where, clause) },
      ownershipCheck: false,
    };
  }

  if (CREATE_OPERATIONS.has(operation)) {
    return {
      operation,
      args: { ...args, data: scopeCreateData(args.data, groupId, model, operation) },
      ownershipCheck: false,
    };
  }

  if (UNIQUE_WRITE_OPERATIONS.has(operation)) {
    const next: AnyArgs = { ...args };
    if (operation === 'upsert' && next.create !== undefined) {
      next.create = scopeCreateData(next.create, groupId, model, operation);
    }
    // `where` is left as-is: it must stay a valid unique selector. Tenancy is
    // enforced by the ownership pre-check instead.
    return { operation, args: next, ownershipCheck: true };
  }

  // Unrecognised operation (e.g. a future Prisma addition). Fail closed.
  throw new TenancyViolationError({
    model,
    operation,
    expected: groupId,
    actual: null,
  });
}

/**
 * A Prisma client locked to one help desk group.
 *
 * Note that `HelpDeskMembership` is in the scoped set, so resolving *which*
 * groups a user belongs to must use the unscoped `db()` -- see
 * src/lib/auth/memberships.ts.
 */
export function scopedDb(groupId: string) {
  if (!groupId) {
    throw new TenancyViolationError({
      model: '(any)',
      operation: '(any)',
      expected: '<none>',
      actual: null,
    });
  }

  const base = db();

  return base.$extends({
    name: `helpDeskGroupScope(${groupId})`,
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const mode = scopeModeFor(model);
          if (!mode) return query(args);

          const rewritten = rewriteOperation({
            model,
            operation,
            args: args as AnyArgs,
            groupId,
          });

          if (rewritten.ownershipCheck) {
            await assertRowInScope({
              model,
              operation,
              where: (rewritten.args.where ?? {}) as AnyArgs,
              groupId,
              allowGlobal: false,
            });
          }

          if (rewritten.operation !== operation) {
            // Re-enter through the base client so the substituted operation
            // (findUnique -> findFirst) is actually dispatched.
            const delegate = base[modelToDelegate(model) as keyof typeof base] as unknown as Record<
              string,
              (a: unknown) => Promise<unknown>
            >;
            return delegate[rewritten.operation]!(rewritten.args);
          }

          return query(rewritten.args);
        },
      },
    },
  });
}

/**
 * Verify that the row a single-row write targets belongs to the active group.
 * Uses the unscoped client on purpose: we need to see rows outside the scope in
 * order to reject them with a clear error instead of a confusing "not found".
 */
async function assertRowInScope(input: {
  model: string;
  operation: string;
  where: AnyArgs;
  groupId: string;
  allowGlobal: boolean;
}): Promise<void> {
  const { model, operation, where, groupId, allowGlobal } = input;
  const delegate = db()[modelToDelegate(model) as keyof ReturnType<typeof db>] as unknown as {
    findFirst: (args: unknown) => Promise<{ helpDeskGroupId: string | null } | null>;
  };

  const existing = await delegate.findFirst({
    where,
    select: { helpDeskGroupId: true },
  });

  // Row absent: let the real query raise Prisma's own P2025 so callers keep
  // getting the error they expect for a missing record.
  if (!existing) return;

  const owner = existing.helpDeskGroupId;
  const permitted = owner === groupId || (allowGlobal && owner === null);
  if (!permitted) {
    throw new TenancyViolationError({ model, operation, expected: groupId, actual: owner });
  }
}

/** "TicketComment" -> "ticketComment" (Prisma's delegate property name). */
export function modelToDelegate(model: string): string {
  return model.charAt(0).toLowerCase() + model.slice(1);
}

export type ScopedDb = ReturnType<typeof scopedDb>;
