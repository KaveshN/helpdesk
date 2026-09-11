'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireSessionContext } from '@/lib/auth/session';
import { queueReply, flushOutbound } from '@/lib/email/reply';
import { syncMailbox } from '@/lib/email/ingest';
import { requireCapability } from '@/lib/authz/guard';
import { ValidationError } from '@/lib/errors';
import { fieldErrorsFrom, runAction, type ActionResult } from '@/server/actions/result';

const replySchema = z.object({
  ticketId: z.uuid(),
  body: z.string().trim().min(1, 'A reply cannot be empty').max(20_000),
  cc: z
    .string()
    .trim()
    .optional()
    .transform((value) =>
      value
        ? value
            .split(/[,;]/)
            .map((address) => address.trim().toLowerCase())
            .filter(Boolean)
        : [],
    )
    .refine(
      (addresses) => addresses.every((address) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address)),
      'One of the CC addresses is not a valid email address',
    ),
});

function formValues(formData: FormData): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === 'string') values[key] = value;
  }
  return values;
}

/** Send an email reply to the requester from the group's shared mailbox. */
export async function replyByEmailAction(
  _previous: ActionResult<{ commentId: string }> | undefined,
  formData: FormData,
): Promise<ActionResult<{ commentId: string }>> {
  return runAction('replyByEmail', async () => {
    const { actor, group } = await requireSessionContext();
    const parsed = replySchema.safeParse(formValues(formData));
    if (!parsed.success) {
      throw new ValidationError(
        'Please correct the highlighted fields',
        fieldErrorsFrom(parsed.error.issues),
      );
    }

    const result = await queueReply(actor, group, {
      ticketId: parsed.data.ticketId,
      body: parsed.data.body,
      ccAddresses: parsed.data.cc,
    });

    revalidatePath(`/tickets/${parsed.data.ticketId}`);
    return { commentId: result.commentId };
  });
}

/** Poll the mailbox now, rather than waiting for the scheduler. */
export async function syncMailboxAction(): Promise<
  ActionResult<{ created: number; appended: number; ignored: number; failed: number }>
> {
  return runAction('syncMailbox', async () => {
    const { actor, group } = await requireSessionContext();
    requireCapability(actor, 'group:manage_settings', group.helpDeskGroupId);

    const result = await syncMailbox(group.helpDeskGroupId);
    await flushOutbound(group.helpDeskGroupId);

    revalidatePath('/tickets');
    revalidatePath('/admin/configuration');
    return {
      created: result.created,
      appended: result.appended,
      ignored: result.ignored,
      failed: result.failed,
    };
  });
}
