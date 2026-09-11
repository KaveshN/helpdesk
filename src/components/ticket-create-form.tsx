'use client';

import { useActionState, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createTicketAction } from '@/server/actions/tickets';
import { FieldError, FormMessage } from '@/components/ui/form-message';

type Option = { id: string; name: string };
type CategoryOption = Option & { subCategories: Option[] };

/**
 * Two-column composer: the narrative on the left, classification on the right.
 * The same split as GitHub/Linear issue creation — it fills the width instead
 * of stacking every field into one narrow column, and keeps the metadata
 * visible while you write.
 */
export function TicketCreateForm({
  types,
  priorities,
  categories,
  assignees,
  canAssign,
}: {
  types: Option[];
  priorities: Option[];
  categories: CategoryOption[];
  assignees: Array<{ id: string; name: string; email: string }>;
  canAssign: boolean;
}) {
  const [state, formAction, pending] = useActionState(createTicketAction, undefined);
  const [categoryId, setCategoryId] = useState('');
  const router = useRouter();

  // Subcategories filter from the chosen category; the server re-validates that
  // the pair actually belongs together.
  const subCategories = useMemo(
    () => categories.find((category) => category.id === categoryId)?.subCategories ?? [],
    [categories, categoryId],
  );

  useEffect(() => {
    if (state?.ok) router.push(`/tickets/${state.data.id}`);
  }, [state, router]);

  return (
    <form action={formAction} className="space-y-4">
      <FormMessage result={state} />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="card space-y-4 p-5">
          <div>
            <label className="label" htmlFor="subject">
              Subject
            </label>
            <input id="subject" name="subject" required maxLength={300} className="input" />
            <FieldError result={state} field="subject" />
          </div>

          <div>
            <label className="label" htmlFor="description">
              Description
            </label>
            <textarea
              id="description"
              name="description"
              required
              rows={14}
              className="textarea"
              placeholder="What happened, what was expected, and anything already tried."
            />
            <FieldError result={state} field="description" />
          </div>
        </div>

        <div className="card h-fit space-y-4 p-5">
          <h2 className="panel-title">Classification</h2>

          <div>
            <label className="label" htmlFor="typeId">
              Type
            </label>
            <select id="typeId" name="typeId" required className="select">
              {types.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.name}
                </option>
              ))}
            </select>
            <FieldError result={state} field="typeId" />
          </div>

          <div>
            <label className="label" htmlFor="priorityId">
              Priority
            </label>
            <select id="priorityId" name="priorityId" required className="select">
              {priorities.map((priority) => (
                <option key={priority.id} value={priority.id}>
                  {priority.name}
                </option>
              ))}
            </select>
            <FieldError result={state} field="priorityId" />
          </div>

          <div>
            <label className="label" htmlFor="categoryId">
              Category
            </label>
            <select
              id="categoryId"
              name="categoryId"
              className="select"
              value={categoryId}
              onChange={(event) => setCategoryId(event.target.value)}
            >
              <option value="">Not categorised</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
            <FieldError result={state} field="categoryId" />
          </div>

          <div>
            <label className="label" htmlFor="subCategoryId">
              Subcategory
            </label>
            <select
              id="subCategoryId"
              name="subCategoryId"
              className="select"
              disabled={subCategories.length === 0}
            >
              <option value="">None</option>
              {subCategories.map((subCategory) => (
                <option key={subCategory.id} value={subCategory.id}>
                  {subCategory.name}
                </option>
              ))}
            </select>
            <FieldError result={state} field="subCategoryId" />
          </div>

          {canAssign ? (
            <div>
              <label className="label" htmlFor="assigneeId">
                Assign to
              </label>
              <select id="assigneeId" name="assigneeId" className="select">
                <option value="">Leave unassigned</option>
                {assignees.map((assignee) => (
                  <option key={assignee.id} value={assignee.id}>
                    {assignee.name}
                  </option>
                ))}
              </select>
              <FieldError result={state} field="assigneeId" />
            </div>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="btn-primary" disabled={pending}>
          {pending ? 'Creating…' : 'Create ticket'}
        </button>
        <span className="text-[0.8125rem] text-muted">
          The reference is issued from this help desk&rsquo;s own sequence.
        </span>
      </div>
    </form>
  );
}
