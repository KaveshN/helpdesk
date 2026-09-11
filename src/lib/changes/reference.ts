import type { Prisma } from '@/generated/prisma/client';

/**
 * Change references use their own per-group counter, independent of tickets:
 * `ITHD-C-000042`. The `C` marker is what stops an agent reading a change
 * reference over the phone as a ticket number.
 */
export function formatChangeReference(groupKey: string, sequence: number): string {
  return `${groupKey}-C-${String(sequence).padStart(6, '0')}`;
}

export function parseChangeReference(
  reference: string,
): { groupKey: string; sequence: number } | null {
  const match = /^([A-Z0-9]{2,10})-C-(\d{1,10})$/.exec(reference.trim().toUpperCase());
  if (!match) return null;
  return { groupKey: match[1]!, sequence: Number.parseInt(match[2]!, 10) };
}

/**
 * Claim the next change number. Same row-lock mechanism as tickets
 * (`UPDATE ... RETURNING`), but against a separate column, so the two series
 * never interleave and neither has gaps caused by the other.
 *
 * MUST run inside the change-creation transaction.
 */
export async function claimChangeSequence(
  tx: Prisma.TransactionClient,
  helpDeskGroupId: string,
): Promise<number> {
  const rows = await tx.$queryRaw<Array<{ changeSequence: number }>>`
    UPDATE "HelpDeskGroup"
       SET "changeSequence" = "changeSequence" + 1
     WHERE "id" = ${helpDeskGroupId}::uuid
    RETURNING "changeSequence"
  `;

  const sequence = rows[0]?.changeSequence;
  if (typeof sequence !== 'number') {
    throw new Error(`Help desk group ${helpDeskGroupId} not found while claiming a change number`);
  }
  return sequence;
}
