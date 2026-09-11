'use server';

import { revalidatePath } from 'next/cache';
import { requireActor } from '@/lib/auth/session';
import {
  createGroupSchema,
  removeMembershipSchema,
  updateGroupSchema,
  upsertMembershipSchema,
} from '@/lib/groups/schemas';
import { createGroup, removeMembership, updateGroup, upsertMembership } from '@/lib/groups/service';
import { ValidationError } from '@/lib/errors';
import { auditContext } from '@/server/actions/context';
import { fieldErrorsFrom, runAction, type ActionResult } from '@/server/actions/result';

function formValues(formData: FormData): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === 'string') values[key] = value;
  }
  return values;
}

export async function createGroupAction(
  _previous: ActionResult<{ id: string; key: string }> | undefined,
  formData: FormData,
): Promise<ActionResult<{ id: string; key: string }>> {
  return runAction('createGroup', async () => {
    const actor = await requireActor();
    const parsed = createGroupSchema.safeParse(formValues(formData));
    if (!parsed.success) {
      throw new ValidationError(
        'Please correct the highlighted fields',
        fieldErrorsFrom(parsed.error.issues),
      );
    }

    const group = await createGroup(actor, parsed.data, await auditContext(actor));
    revalidatePath('/admin/groups');
    revalidatePath('/', 'layout');
    return { id: group.id, key: group.key };
  });
}

export async function updateGroupAction(
  _previous: ActionResult<{ id: string }> | undefined,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  return runAction('updateGroup', async () => {
    const actor = await requireActor();
    const parsed = updateGroupSchema.safeParse(formValues(formData));
    if (!parsed.success) {
      throw new ValidationError(
        'Please correct the highlighted fields',
        fieldErrorsFrom(parsed.error.issues),
      );
    }

    const group = await updateGroup(actor, parsed.data, await auditContext(actor));
    revalidatePath('/admin/groups');
    revalidatePath('/', 'layout');
    return { id: group.id };
  });
}

export async function upsertMembershipAction(
  _previous: ActionResult<{ id: string }> | undefined,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  return runAction('upsertMembership', async () => {
    const actor = await requireActor();
    const parsed = upsertMembershipSchema.safeParse(formValues(formData));
    if (!parsed.success) {
      throw new ValidationError(
        'Please correct the highlighted fields',
        fieldErrorsFrom(parsed.error.issues),
      );
    }

    const membership = await upsertMembership(actor, parsed.data, await auditContext(actor));
    revalidatePath(`/admin/groups/${parsed.data.helpDeskGroupId}`);
    revalidatePath('/admin/members');
    return { id: membership.id };
  });
}

export async function removeMembershipAction(formData: FormData): Promise<ActionResult> {
  return runAction('removeMembership', async () => {
    const actor = await requireActor();
    const parsed = removeMembershipSchema.safeParse(formValues(formData));
    if (!parsed.success) {
      throw new ValidationError('Invalid request', fieldErrorsFrom(parsed.error.issues));
    }

    await removeMembership(actor, parsed.data, await auditContext(actor));
    revalidatePath(`/admin/groups/${parsed.data.helpDeskGroupId}`);
    revalidatePath('/admin/members');
    return undefined;
  });
}
