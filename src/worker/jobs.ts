import { db } from '@/lib/db/client';
import { syncMailbox } from '@/lib/email/ingest';
import { flushOutbound } from '@/lib/email/reply';
import { logger } from '@/lib/logger';

/**
 * Background jobs. Each handler is platform-level (it enumerates groups with
 * the unscoped client) and then does its per-group work through the scoped
 * services, so row-level security applies to the actual reads and writes.
 *
 * Not here yet, on purpose: SLA warning/breach sweeps. Those need
 * OPEN-QUESTIONS Q1 (escalation path) and Q2 (clock pause semantics)
 * answered; the queue and the container are ready for them.
 */
export const QUEUE_NAME = 'helpdesk';

export const JOB = {
  mailSync: 'mail:sync',
  mailFlush: 'mail:flush',
} as const;

export type JobName = (typeof JOB)[keyof typeof JOB];

export type MailboxCandidate = {
  id: string;
  key: string;
  isActive: boolean;
  mailboxSyncEnabled: boolean;
  inboundEmailAddress: string | null;
};

/** Pure: which groups the poller should touch on this tick. */
export function planMailboxSync(groups: MailboxCandidate[]): MailboxCandidate[] {
  return groups.filter(
    (group) => group.isActive && group.mailboxSyncEnabled && Boolean(group.inboundEmailAddress),
  );
}

export type MailSyncSummary = {
  groups: number;
  created: number;
  appended: number;
  ignored: number;
  failed: number;
  errors: number;
};

export async function runMailSync(): Promise<MailSyncSummary> {
  const candidates = await db().helpDeskGroup.findMany({
    select: {
      id: true,
      key: true,
      isActive: true,
      mailboxSyncEnabled: true,
      inboundEmailAddress: true,
    },
  });
  const plan = planMailboxSync(candidates);

  const summary: MailSyncSummary = {
    groups: plan.length,
    created: 0,
    appended: 0,
    ignored: 0,
    failed: 0,
    errors: 0,
  };

  for (const group of plan) {
    try {
      const result = await syncMailbox(group.id);
      summary.created += result.created;
      summary.appended += result.appended;
      summary.ignored += result.ignored;
      summary.failed += result.failed;
      await flushOutbound(group.id);
    } catch (error) {
      // One group's mailbox being down must not stop the others.
      summary.errors += 1;
      logger.error({ err: error, groupKey: group.key }, 'mailbox sync failed');
    }
  }

  return summary;
}

export async function runMailFlush(): Promise<{ groups: number; errors: number }> {
  const pending = await db().outboundEmail.findMany({
    where: { status: 'QUEUED', attempts: { lt: 5 } },
    distinct: ['helpDeskGroupId'],
    select: { helpDeskGroupId: true },
  });

  let errors = 0;
  for (const row of pending) {
    try {
      await flushOutbound(row.helpDeskGroupId);
    } catch (error) {
      errors += 1;
      logger.error({ err: error, helpDeskGroupId: row.helpDeskGroupId }, 'outbound flush failed');
    }
  }
  return { groups: pending.length, errors };
}

export async function runJob(name: string): Promise<unknown> {
  switch (name) {
    case JOB.mailSync:
      return runMailSync();
    case JOB.mailFlush:
      return runMailFlush();
    default:
      throw new Error(`Unknown job: ${name}`);
  }
}
