'use server';

import { revalidatePath } from 'next/cache';
import { requireSessionContext } from '@/lib/auth/session';
import {
  createChangeSchema,
  recordDecisionSchema,
  removeCabMemberSchema,
  saveCabMemberSchema,
  saveCabSchema,
  saveChangeCategorySchema,
  saveChangeTypeSchema,
  saveRiskLevelSchema,
  submitChangeSchema,
  transitionChangeSchema,
  updateChangeSchema,
} from '@/lib/changes/schemas';
import {
  createChange,
  recordDecision,
  submitChange,
  transitionChange,
  updateChange,
} from '@/lib/changes/service';
import {
  removeCabMember,
  saveCab,
  saveCabMember,
  saveChangeCategory,
  saveChangeType,
  saveRiskLevel,
} from '@/lib/changes/config';
import { ValidationError } from '@/lib/errors';
import { auditContext } from '@/server/actions/context';
import { fieldErrorsFrom, runAction, type ActionResult } from '@/server/actions/result';

/** FormData -> object; repeated `name[]` keys collect into an array. */
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

function revalidateChange(changeRequestId?: string) {
  revalidatePath('/changes');
  revalidatePath('/reports');
  if (changeRequestId) revalidatePath(`/changes/${changeRequestId}`);
}

export async function createChangeAction(
  _previous: ActionResult<{ id: string; reference: string }> | undefined,
  formData: FormData,
): Promise<ActionResult<{ id: string; reference: string }>> {
  return runAction('createChange', async () => {
    const { actor, group } = await requireSessionContext();
    const parsed = createChangeSchema.safeParse(formValues(formData));
    if (!parsed.success) {
      throw new ValidationError(
        'Please correct the highlighted fields',
        fieldErrorsFrom(parsed.error.issues),
      );
    }
    const change = await createChange(actor, group, parsed.data);
    revalidateChange();
    return change;
  });
}

export async function updateChangeAction(
  _previous: ActionResult<{ id: string }> | undefined,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  return runAction('updateChange', async () => {
    const { actor, group } = await requireSessionContext();
    const parsed = updateChangeSchema.safeParse(formValues(formData));
    if (!parsed.success) {
      throw new ValidationError(
        'Please correct the highlighted fields',
        fieldErrorsFrom(parsed.error.issues),
      );
    }
    const change = await updateChange(actor, group, parsed.data);
    revalidateChange(change.id);
    return change;
  });
}

export async function submitChangeAction(formData: FormData): Promise<ActionResult> {
  return runAction('submitChange', async () => {
    const { actor, group } = await requireSessionContext();
    const parsed = submitChangeSchema.safeParse(formValues(formData));
    if (!parsed.success) {
      throw new ValidationError('Invalid request', fieldErrorsFrom(parsed.error.issues));
    }
    await submitChange(actor, group, parsed.data);
    revalidateChange(parsed.data.changeRequestId);
    return undefined;
  });
}

export async function recordDecisionAction(
  _previous: ActionResult<{ outcome: string; reason: string }> | undefined,
  formData: FormData,
): Promise<ActionResult<{ outcome: string; reason: string }>> {
  return runAction('recordDecision', async () => {
    const { actor, group } = await requireSessionContext();
    const parsed = recordDecisionSchema.safeParse(formValues(formData));
    if (!parsed.success) {
      throw new ValidationError('Please choose a decision', fieldErrorsFrom(parsed.error.issues));
    }
    const outcome = await recordDecision(actor, group, parsed.data);
    revalidateChange(parsed.data.changeRequestId);
    return { outcome: outcome.outcome, reason: outcome.reason };
  });
}

export async function transitionChangeAction(formData: FormData): Promise<ActionResult> {
  return runAction('transitionChange', async () => {
    const { actor, group } = await requireSessionContext();
    const parsed = transitionChangeSchema.safeParse(formValues(formData));
    if (!parsed.success) {
      throw new ValidationError('Invalid request', fieldErrorsFrom(parsed.error.issues));
    }
    await transitionChange(actor, group, parsed.data);
    revalidateChange(parsed.data.changeRequestId);
    return undefined;
  });
}

// --- configuration -------------------------------------------------------

function configAction<T>(
  name: string,
  run: (
    ctx: Awaited<ReturnType<typeof requireSessionContext>> & {
      audit: Awaited<ReturnType<typeof auditContext>>;
    },
    values: Record<string, unknown>,
  ) => Promise<T>,
) {
  return async function action(
    _previous: ActionResult<T> | undefined,
    formData: FormData,
  ): Promise<ActionResult<T>> {
    return runAction(name, async () => {
      const session = await requireSessionContext();
      const result = await run(
        { ...session, audit: await auditContext(session.actor) },
        formValues(formData),
      );
      revalidatePath('/admin/change-config');
      revalidatePath('/changes');
      return result;
    });
  };
}

export const saveChangeTypeAction = configAction('saveChangeType', async (ctx, values) => {
  const parsed = saveChangeTypeSchema.safeParse(values);
  if (!parsed.success) {
    throw new ValidationError(
      'Please correct the highlighted fields',
      fieldErrorsFrom(parsed.error.issues),
    );
  }
  const result = await saveChangeType(ctx, parsed.data);
  return { id: result.id };
});

export const saveChangeCategoryAction = configAction('saveChangeCategory', async (ctx, values) => {
  const parsed = saveChangeCategorySchema.safeParse(values);
  if (!parsed.success) {
    throw new ValidationError(
      'Please correct the highlighted fields',
      fieldErrorsFrom(parsed.error.issues),
    );
  }
  const result = await saveChangeCategory(ctx, parsed.data);
  return { id: result.id };
});

export const saveRiskLevelAction = configAction('saveRiskLevel', async (ctx, values) => {
  const parsed = saveRiskLevelSchema.safeParse(values);
  if (!parsed.success) {
    throw new ValidationError(
      'Please correct the highlighted fields',
      fieldErrorsFrom(parsed.error.issues),
    );
  }
  const result = await saveRiskLevel(ctx, parsed.data);
  return { id: result.id };
});

export const saveCabAction = configAction('saveCab', async (ctx, values) => {
  const parsed = saveCabSchema.safeParse({
    ...values,
    riskLevelIds: Array.isArray(values.riskLevelIds) ? values.riskLevelIds : [],
  });
  if (!parsed.success) {
    throw new ValidationError(
      'Please correct the highlighted fields',
      fieldErrorsFrom(parsed.error.issues),
    );
  }
  const result = await saveCab(ctx, parsed.data);
  return { id: result.id };
});

export const saveCabMemberAction = configAction('saveCabMember', async (ctx, values) => {
  const parsed = saveCabMemberSchema.safeParse(values);
  if (!parsed.success) {
    throw new ValidationError('Please choose a person', fieldErrorsFrom(parsed.error.issues));
  }
  const result = await saveCabMember(ctx, parsed.data);
  return { id: result.id };
});

export async function removeCabMemberAction(formData: FormData): Promise<ActionResult> {
  return runAction('removeCabMember', async () => {
    const session = await requireSessionContext();
    const parsed = removeCabMemberSchema.safeParse(formValues(formData));
    if (!parsed.success) {
      throw new ValidationError('Invalid request', fieldErrorsFrom(parsed.error.issues));
    }
    await removeCabMember({ ...session, audit: await auditContext(session.actor) }, parsed.data);
    revalidatePath('/admin/change-config');
    return undefined;
  });
}
