'use server';

import { revalidatePath } from 'next/cache';
import { requireSessionContext } from '@/lib/auth/session';
import {
  categoryInputSchema,
  priorityInputSchema,
  statusInputSchema,
  subCategoryInputSchema,
  ticketTypeInputSchema,
} from '@/lib/taxonomy/schemas';
import {
  saveCategory,
  savePriority,
  saveStatus,
  saveSubCategory,
  saveTicketType,
} from '@/lib/taxonomy/service';
import { ValidationError } from '@/lib/errors';
import { auditContext } from '@/server/actions/context';
import { fieldErrorsFrom, runAction, type ActionResult } from '@/server/actions/result';
import type { z } from 'zod';

function formValues(formData: FormData): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === 'string' && value !== '') values[key] = value;
  }
  return values;
}

/**
 * Factory for the five near-identical taxonomy actions.
 *
 * The *services* stay per-entity for type safety; only this thin
 * parse-then-delegate shell is shared, which is the part that genuinely repeats.
 */
function taxonomyAction<S extends z.ZodType>(
  name: string,
  schema: S,
  save: (
    ctx: Awaited<ReturnType<typeof requireSessionContext>> & {
      audit: Awaited<ReturnType<typeof auditContext>>;
    },
    input: z.output<S>,
  ) => Promise<{ id: string }>,
) {
  return async function action(
    _previous: ActionResult<{ id: string }> | undefined,
    formData: FormData,
  ): Promise<ActionResult<{ id: string }>> {
    return runAction(name, async () => {
      const session = await requireSessionContext();
      const parsed = schema.safeParse(formValues(formData));
      if (!parsed.success) {
        throw new ValidationError(
          'Please correct the highlighted fields',
          fieldErrorsFrom(parsed.error.issues),
        );
      }

      const result = await save(
        { ...session, audit: await auditContext(session.actor) },
        parsed.data,
      );

      revalidatePath('/admin/configuration');
      revalidatePath('/tickets/new');
      return { id: result.id };
    });
  };
}

export const saveCategoryAction = taxonomyAction(
  'saveCategory',
  categoryInputSchema,
  (ctx, input) => saveCategory(ctx, input),
);
export const saveSubCategoryAction = taxonomyAction(
  'saveSubCategory',
  subCategoryInputSchema,
  (ctx, input) => saveSubCategory(ctx, input),
);
export const saveStatusAction = taxonomyAction('saveStatus', statusInputSchema, (ctx, input) =>
  saveStatus(ctx, input),
);
export const savePriorityAction = taxonomyAction(
  'savePriority',
  priorityInputSchema,
  (ctx, input) => savePriority(ctx, input),
);
export const saveTicketTypeAction = taxonomyAction(
  'saveTicketType',
  ticketTypeInputSchema,
  (ctx, input) => saveTicketType(ctx, input),
);
