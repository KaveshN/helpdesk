'use client';

import { useActionState } from 'react';
import { updateTicketAction } from '@/server/actions/tickets';
import { FieldError, FormMessage } from '@/components/ui/form-message';

type Option = { id: string; name: string };

export function TicketUpdatePanel({
  ticketId,
  statuses,
  priorities,
  types,
  categories,
  assignees,
  current,
  canAssign,
}: {
  ticketId: string;
  statuses: Option[];
  priorities: Option[];
  types: Option[];
  categories: Option[];
  assignees: Array<{ id: string; name: string }>;
  current: {
    statusId: string;
    priorityId: string;
    typeId: string;
    categoryId: string | null;
    assigneeId: string | null;
  };
  canAssign: boolean;
}) {
  const [state, formAction, pending] = useActionState(updateTicketAction, undefined);

  return (
    <form action={formAction} className="card space-y-4 p-4">
      <h2 className="text-sm font-semibold text-foreground">Ticket properties</h2>
      <input type="hidden" name="ticketId" value={ticketId} />
      <FormMessage result={state} />

      <div>
        <label className="label" htmlFor="statusId">
          Status
        </label>
        <select id="statusId" name="statusId" defaultValue={current.statusId} className="input">
          {statuses.map((status) => (
            <option key={status.id} value={status.id}>
              {status.name}
            </option>
          ))}
        </select>
        <FieldError result={state} field="statusId" />
      </div>

      <div>
        <label className="label" htmlFor="priorityId">
          Priority
        </label>
        <select
          id="priorityId"
          name="priorityId"
          defaultValue={current.priorityId}
          className="input"
        >
          {priorities.map((priority) => (
            <option key={priority.id} value={priority.id}>
              {priority.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="label" htmlFor="typeId">
          Type
        </label>
        <select id="typeId" name="typeId" defaultValue={current.typeId} className="input">
          {types.map((type) => (
            <option key={type.id} value={type.id}>
              {type.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="label" htmlFor="categoryId">
          Category
        </label>
        <select
          id="categoryId"
          name="categoryId"
          defaultValue={current.categoryId ?? ''}
          className="input"
        >
          <option value="">Not categorised</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
      </div>

      {canAssign ? (
        <div>
          <label className="label" htmlFor="assigneeId">
            Assignee
          </label>
          <select
            id="assigneeId"
            name="assigneeId"
            defaultValue={current.assigneeId ?? ''}
            className="input"
          >
            <option value="">Unassigned</option>
            {assignees.map((assignee) => (
              <option key={assignee.id} value={assignee.id}>
                {assignee.name}
              </option>
            ))}
          </select>
          <FieldError result={state} field="assigneeId" />
        </div>
      ) : null}

      <button type="submit" className="btn-primary w-full" disabled={pending}>
        {pending ? 'Saving…' : 'Save changes'}
      </button>
      {state?.ok ? <p className="text-xs text-success">Saved.</p> : null}
    </form>
  );
}
