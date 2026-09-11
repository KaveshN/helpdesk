import type { Prisma } from '@/generated/prisma/client';
import { db } from '@/lib/db/client';
import { logger } from '@/lib/logger';

/**
 * AUDIT LOGGING (brief §8): every administrative change records who did what,
 * with before/after state.
 *
 * Pass `tx` whenever the change itself runs in a transaction. The audit row
 * then commits or rolls back with the change -- an audit trail that can silently
 * disagree with the data is worse than none, so this deliberately does NOT
 * swallow write failures.
 */

/** Minimal shape shared by the Prisma client and a transaction client. */
type AuditWriter = Pick<Prisma.TransactionClient, 'auditLog'>;

export type AuditActor = {
  userId: string | null;
  email: string;
  ipAddress?: string | null;
  userAgent?: string | null;
};

export type AuditInput = {
  /** `<entity>.<action>`, e.g. "sla_policy.update". */
  action: string;
  entityType: string;
  entityId?: string | null;
  /** NULL for platform-level actions such as creating a help desk group. */
  helpDeskGroupId?: string | null;
  before?: unknown;
  after?: unknown;
  actor: AuditActor;
  tx?: AuditWriter;
};

/**
 * Field names never written to the audit trail, even if a caller passes an
 * entity containing them. Complements the logger's redaction.
 */
const REDACTED_FIELDS = new Set([
  'password',
  'passwordHash',
  'secret',
  'clientSecret',
  'token',
  'accessToken',
  'refreshToken',
  'idToken',
  'smtpPassword',
  'imapPassword',
]);

/** Strip secrets and collapse non-serialisable values before storing as JSON. */
export function sanitiseForAudit(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined || value === null) return undefined;

  const walk = (input: unknown): unknown => {
    if (input instanceof Date) return input.toISOString();
    if (Array.isArray(input)) return input.map(walk);
    if (input !== null && typeof input === 'object') {
      const output: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(input as Record<string, unknown>)) {
        if (REDACTED_FIELDS.has(key)) {
          output[key] = '[redacted]';
          continue;
        }
        if (typeof item === 'function' || typeof item === 'symbol') continue;
        output[key] = walk(item);
      }
      return output;
    }
    if (typeof input === 'bigint') return input.toString();
    return input;
  };

  return walk(value) as Prisma.InputJsonValue;
}

/**
 * Reduce a before/after pair to only the fields that actually changed, so the
 * trail stays readable and small. Returns undefined when nothing changed.
 */
export function auditDiff<T extends Record<string, unknown>>(
  before: T | null | undefined,
  after: T | null | undefined,
): { before: Partial<T>; after: Partial<T> } | undefined {
  if (!before) return after ? { before: {}, after: { ...after } } : undefined;
  if (!after) return { before: { ...before }, after: {} };

  const changedBefore: Partial<T> = {};
  const changedAfter: Partial<T> = {};
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);

  for (const key of keys) {
    const from = before[key as keyof T];
    const to = after[key as keyof T];
    if (JSON.stringify(from ?? null) === JSON.stringify(to ?? null)) continue;
    changedBefore[key as keyof T] = from;
    changedAfter[key as keyof T] = to;
  }

  if (Object.keys(changedAfter).length === 0 && Object.keys(changedBefore).length === 0) {
    return undefined;
  }
  return { before: changedBefore, after: changedAfter };
}

export async function recordAudit(input: AuditInput): Promise<void> {
  const writer: AuditWriter = input.tx ?? db();

  await writer.auditLog.create({
    data: {
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      helpDeskGroupId: input.helpDeskGroupId ?? null,
      actorUserId: input.actor.userId,
      actorEmail: input.actor.email,
      before: sanitiseForAudit(input.before),
      after: sanitiseForAudit(input.after),
      ipAddress: input.actor.ipAddress ?? null,
      userAgent: input.actor.userAgent ?? null,
    },
  });

  logger.info(
    {
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      helpDeskGroupId: input.helpDeskGroupId,
      actorUserId: input.actor.userId,
    },
    'audit',
  );
}
