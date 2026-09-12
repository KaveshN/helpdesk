'use server';

import { revalidatePath } from 'next/cache';
import { requireSessionContext } from '@/lib/auth/session';
import {
  addCommentSchema,
  createTicketSchema,
  updateTicketSchema,
  watcherSchema,
} from '@/lib/tickets/schemas';
import { addComment, createTicket, updateTicket } from '@/lib/tickets/service';
import { scopedDb, scopedTransaction } from '@/lib/db/scoped';
import { db } from '@/lib/db/client';
import { TicketEventType } from '@/generated/prisma/enums';
import { requireCapability } from '@/lib/authz/guard';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { fieldErrorsFrom, runAction, type ActionResult } from '@/server/actions/result';

/** FormData -> plain object, dropping empty strings so zod defaults apply. */
function formValues(formData: FormData): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value !== 'string') continue;
    if (key.endsWith('[]')) {
      const name = key.slice(0, -2);
      ((values[name] ??= []) as string[]).push(value);
      continue;
    }
    values[key] = value;
  }
  return values;
}

export async function createTicketAction(
  _previous: ActionResult<{ id: string; reference: string }> | undefined,
  formData: FormData,
): Promise<ActionResult<{ id: string; reference: string }>> {
  return runAction('createTicket', async () => {
    const { actor, group } = await requireSessionContext();

    const raw = formValues(formData);
    const parsed = createTicketSchema.safeParse({
      ...raw,
      watcherIds: Array.isArray(raw.watcherIds) ? raw.watcherIds : [],
    });
    if (!parsed.success) {
      throw new ValidationError(
        'Please correct the highlighted fields',
        fieldErrorsFrom(parsed.error.issues),
      );
    }

    const ticket = await createTicket(actor, group, parsed.data);
    revalidatePath('/tickets');
    revalidatePath('/dashboard');
    return ticket;
  });
}

export async function updateTicketAction(
  _previous: ActionResult<{ id: string }> | undefined,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  return runAction('updateTicket', async () => {
    const { actor, group } = await requireSessionContext();

    const parsed = updateTicketSchema.safeParse(formValues(formData));
    if (!parsed.success) {
      throw new ValidationError(
        'Please correct the highlighted fields',
        fieldErrorsFrom(parsed.error.issues),
      );
    }

    const ticket = await updateTicket(actor, group, parsed.data);
    revalidatePath(`/tickets/${ticket.id}`);
    revalidatePath('/tickets');
    revalidatePath('/dashboard');
    return ticket;
  });
}

export async function addCommentAction(
  _previous: ActionResult<{ id: string }> | undefined,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  return runAction('addComment', async () => {
    const { actor, group } = await requireSessionContext();

    const parsed = addCommentSchema.safeParse(formValues(formData));
    if (!parsed.success) {
      throw new ValidationError(
        'Please correct the highlighted fields',
        fieldErrorsFrom(parsed.error.issues),
      );
    }

    const comment = await addComment(actor, group, parsed.data);
    revalidatePath(`/tickets/${parsed.data.ticketId}`);
    return comment;
  });
}

export async function addWatcherAction(formData: FormData): Promise<ActionResult> {
  return runAction('addWatcher', async () => {
    const { actor, group } = await requireSessionContext();
    requireCapability(actor, 'ticket:manage_watchers', group.helpDeskGroupId);

    const parsed = watcherSchema.safeParse(formValues(formData));
    if (!parsed.success) {
      throw new ValidationError('Please choose a person', fieldErrorsFrom(parsed.error.issues));
    }

    const helpDeskGroupId = group.helpDeskGroupId;
    const scoped = scopedDb(helpDeskGroupId);

    const ticket = await scoped.ticket.findFirst({
      where: { id: parsed.data.ticketId },
      select: { id: true },
    });
    if (!ticket) throw new NotFoundError('Ticket not found');

    // A watcher must belong to the group, otherwise adding one becomes a way to
    // grant an outsider read access to this group's tickets.
    const membership = await db().helpDeskMembership.findFirst({
      where: { helpDeskGroupId, userId: parsed.data.userId, isActive: true },
      select: { id: true },
    });
    if (!membership) {
      throw new ValidationError('Invalid watcher', {
        userId: ['That person is not a member of this help desk'],
      });
    }

    await scopedTransaction(helpDeskGroupId, async (tx) => {
      await tx.ticketWatcher.upsert({
        where: { ticketId_userId: { ticketId: ticket.id, userId: parsed.data.userId } },
        create: {
          helpDeskGroupId,
          ticketId: ticket.id,
          userId: parsed.data.userId,
          addedById: actor.userId,
        },
        update: {},
      });
      await tx.ticketEvent.create({
        data: {
          helpDeskGroupId,
          ticketId: ticket.id,
          actorId: actor.userId,
          type: TicketEventType.WATCHER_ADDED,
          newValue: parsed.data.userId,
        },
      });
    });

    revalidatePath(`/tickets/${ticket.id}`);
    return undefined;
  });
}

export async function removeWatcherAction(formData: FormData): Promise<ActionResult> {
  return runAction('removeWatcher', async () => {
    const { actor, group } = await requireSessionContext();
    requireCapability(actor, 'ticket:manage_watchers', group.helpDeskGroupId);

    const parsed = watcherSchema.safeParse(formValues(formData));
    if (!parsed.success) {
      throw new ValidationError('Please choose a person', fieldErrorsFrom(parsed.error.issues));
    }

    const helpDeskGroupId = group.helpDeskGroupId;
    const existing = await scopedDb(helpDeskGroupId).ticketWatcher.findFirst({
      where: { ticketId: parsed.data.ticketId, userId: parsed.data.userId },
      select: { id: true },
    });
    if (!existing) throw new NotFoundError('That person is not watching this ticket');

    await scopedTransaction(helpDeskGroupId, async (tx) => {
      await tx.ticketWatcher.delete({ where: { id: existing.id } });
      await tx.ticketEvent.create({
        data: {
          helpDeskGroupId,
          ticketId: parsed.data.ticketId,
          actorId: actor.userId,
          type: TicketEventType.WATCHER_REMOVED,
          oldValue: parsed.data.userId,
        },
      });
    });

    revalidatePath(`/tickets/${parsed.data.ticketId}`);
    return undefined;
  });
}
