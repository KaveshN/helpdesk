import type { Prisma } from '@/generated/prisma/client';
import { TenancyViolationError } from '@/lib/errors';
import { db } from '@/lib/db/client';

/**
 * GROUP ISOLATION (brief §8).
 *
 * Two layers, and they agree on the same model classification below:
 *
 *  1. Prisma query rewriting. `scopedDb(groupId)` returns a client that ANDs
 *     `helpDeskGroupId = groupId` onto every read and forces the column onto
 *     every create, so leaking data across groups requires deliberately
 *     reaching around this layer rather than merely forgetting a `where`.
 *
 *  2. Postgres row-level security. Every scoped operation, raw query and
 *     `scopedTransaction()` runs inside a transaction that starts with
 *     `SET LOCAL ROLE helpdesk_app` and `set_config('app.current_group_id',
 *     …, true)`. The policies in the shared_calendars_and_rls migration then
 *     filter rows in the database, which covers what (1) cannot see: raw SQL,
 *     nested writes, and relation filters. With no group set the app role
 *     sees nothing, so a forgotten scope fails closed rather than open.
 *
 * REMAINING GAPS -- read before trusting this blindly:
 *  - The unscoped `db()` client runs as the platform role and bypasses RLS.
 *    That is intended for platform-level code (auth, Super Admin, audit) and
 *    for transactions that set `helpDeskGroupId` explicitly on every row. Do
 *    not reach for it inside a group-level service; use `scopedTransaction`.
 *  - The ownership pre-check for single-row writes reads through the unscoped
 *    client, i.e. outside any caller-supplied transaction. A row created and
 *    then updated inside the same transaction is therefore not yet visible to
 *    the check; RLS still rejects a cross-group row at commit time.
 *  - Detecting "already inside an interactive transaction" uses Prisma's
 *    `__internalParams.transaction`, which is not public API. If it ever
 *    disappears, every scoped read inside `scopedDb(g).$transaction` would
 *    open a nested batch and `scripts/verify-rls.ts` fails loudly.
 */

/** Postgres roles created by the RLS migration. */
export const APP_ROLE = 'helpdesk_app';
export const PLATFORM_ROLE = 'helpdesk_platform';
/** Transaction-local setting the policies read. */
export const GROUP_SETTING = 'app.current_group_id';

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
 *
 * Calendars (with their hours and holidays) joined this set on 2026-09-12 so
 * one "South Africa business hours" calendar can serve several groups.
 */
export const GLOBAL_OR_GROUP_MODELS = new Set([
  'KnowledgeArticle',
  'ArticleCategory',
  'Calendar',
  'WorkingHours',
  'Holiday',
]);

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

const RAW_METHODS = new Set(['$queryRaw', '$queryRawUnsafe', '$executeRaw', '$executeRawUnsafe']);

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

function assertGroupId(groupId: string): void {
  if (!groupId) {
    throw new TenancyViolationError({
      model: '(any)',
      operation: '(any)',
      expected: '<none>',
      actual: null,
    });
  }
}

type RawRunner = Pick<Prisma.TransactionClient, '$executeRaw' | '$executeRawUnsafe'>;

/**
 * The two statements that put a transaction into tenant mode. `SET LOCAL` and
 * `set_config(..., true)` both end with the transaction, so a pooled
 * connection never carries one request's group into the next.
 */
function scopeStatements(client: RawRunner, groupId: string) {
  return [
    client.$executeRawUnsafe(`SET LOCAL ROLE ${APP_ROLE}`),
    client.$executeRaw`SELECT set_config(${GROUP_SETTING}, ${groupId}, true)`,
  ] as const;
}

async function enterScope(tx: Prisma.TransactionClient, groupId: string): Promise<void> {
  await tx.$executeRawUnsafe(`SET LOCAL ROLE ${APP_ROLE}`);
  await tx.$executeRaw`SELECT set_config(${GROUP_SETTING}, ${groupId}, true)`;
}

/**
 * An interactive transaction that Postgres itself scopes to one group.
 *
 * Use this, not `db().$transaction`, for every group-level write: rows still
 * need `helpDeskGroupId` set explicitly (the transaction client does not
 * rewrite queries), but a wrong or missing value is now rejected by the
 * database with a row-level security error instead of being stored.
 */
export async function scopedTransaction<T>(
  groupId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  options?: { maxWait?: number; timeout?: number },
): Promise<T> {
  assertGroupId(groupId);
  return db().$transaction(async (tx) => {
    await enterScope(tx, groupId);
    return fn(tx);
  }, options);
}

/**
 * A Prisma client locked to one help desk group.
 *
 * Note that `HelpDeskMembership` is in the scoped set, so resolving *which*
 * groups a user belongs to must use the unscoped `db()` -- see
 * src/lib/auth/session.ts.
 */
export function scopedDb(groupId: string) {
  assertGroupId(groupId);

  const base = db();

  const extended = base.$extends({
    name: `helpDeskGroupScope(${groupId})`,
    query: {
      $allModels: {
        async $allOperations(params) {
          const { model, operation, args, query } = params;
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

          const dispatch = (): Prisma.PrismaPromise<unknown> => {
            if (rewritten.operation !== operation) {
              // Re-enter through the base client so the substituted operation
              // (findUnique -> findFirst) is actually dispatched.
              const delegate = base[
                modelToDelegate(model) as keyof typeof base
              ] as unknown as Record<string, (a: unknown) => Prisma.PrismaPromise<unknown>>;
              return delegate[rewritten.operation]!(rewritten.args);
            }
            return query(rewritten.args) as Prisma.PrismaPromise<unknown>;
          };

          // Inside a caller's interactive transaction the scope was set by the
          // wrapped `$transaction` below; opening a nested batch here would run
          // on a different connection, outside that transaction.
          const inTransaction = Boolean(
            (params as { __internalParams?: { transaction?: unknown } }).__internalParams
              ?.transaction,
          );
          if (inTransaction) return dispatch();

          const [, , result] = await base.$transaction([
            ...scopeStatements(base, groupId),
            dispatch(),
          ]);
          return result;
        },
      },
    },
  });

  type Extended = typeof extended;

  /** `$transaction` that enters the scope first, in both its forms. */
  const transaction = ((input: unknown, options?: unknown) => {
    if (typeof input === 'function') {
      return extended.$transaction(async (tx) => {
        await enterScope(tx as unknown as Prisma.TransactionClient, groupId);
        return (input as (tx: unknown) => Promise<unknown>)(tx);
      }, options as never);
    }
    const queries = input as Prisma.PrismaPromise<unknown>[];
    return extended
      .$transaction([...scopeStatements(extended, groupId), ...queries], options as never)
      .then((results) => results.slice(2));
  }) as Extended['$transaction'];

  return new Proxy(extended, {
    get(target, property, receiver) {
      if (property === '$transaction') return transaction;

      if (typeof property === 'string' && RAW_METHODS.has(property)) {
        // Raw SQL runs as the app role with the group set, so the policies
        // filter it. Gap (1) of the pre-RLS design is closed here.
        return (...rawArgs: unknown[]) => {
          const raw = (target as unknown as Record<string, (...a: unknown[]) => unknown>)[
            property
          ]!.apply(target, rawArgs) as Prisma.PrismaPromise<unknown>;
          return base
            .$transaction([...scopeStatements(base, groupId), raw])
            .then((results) => results[2]);
        };
      }

      const value = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }) as Extended;
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
