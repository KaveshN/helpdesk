import type { Prisma } from '@/generated/prisma/client';

/** `ITHD` + 123 -> `ITHD-000123`. */
export function formatTicketReference(groupKey: string, sequence: number): string {
  return `${groupKey}-${String(sequence).padStart(6, '0')}`;
}

/** Parse a reference back into its parts, or null if it isn't one. */
export function parseTicketReference(
  reference: string,
): { groupKey: string; sequence: number } | null {
  const match = /^([A-Z0-9]{2,10})-(\d{1,10})$/.exec(reference.trim().toUpperCase());
  if (!match) return null;
  return { groupKey: match[1]!, sequence: Number.parseInt(match[2]!, 10) };
}

/**
 * Claim the next reference number for a group.
 *
 * `UPDATE ... RETURNING` takes a row lock on the group, so two concurrent
 * ticket creations serialise on it and can never receive the same sequence.
 * Reading the counter and writing back would race; a Postgres SEQUENCE would
 * not, but sequences are not transactional (gaps on rollback) and we want the
 * reference a user was shown to be the reference that exists.
 *
 * MUST be called inside the same transaction as the ticket insert.
 *
 * Raw SQL is used deliberately here and is safe: it is parameterised, and
 * HelpDeskGroup is a platform table that the tenancy extension does not scope.
 */
export async function claimTicketSequence(
  tx: Prisma.TransactionClient,
  helpDeskGroupId: string,
): Promise<number> {
  const rows = await tx.$queryRaw<Array<{ ticketSequence: number }>>`
    UPDATE "HelpDeskGroup"
       SET "ticketSequence" = "ticketSequence" + 1
     WHERE "id" = ${helpDeskGroupId}::uuid
    RETURNING "ticketSequence"
  `;

  const sequence = rows[0]?.ticketSequence;
  if (typeof sequence !== 'number') {
    throw new Error(`Help desk group ${helpDeskGroupId} not found while claiming a ticket number`);
  }
  return sequence;
}
