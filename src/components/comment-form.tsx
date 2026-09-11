'use client';

import { useActionState, useEffect, useRef } from 'react';
import { addCommentAction } from '@/server/actions/tickets';
import { FieldError, FormMessage } from '@/components/ui/form-message';

export function CommentForm({
  ticketId,
  canAddInternal,
}: {
  ticketId: string;
  canAddInternal: boolean;
}) {
  const [state, formAction, pending] = useActionState(addCommentAction, undefined);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.ok) formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className="space-y-3">
      <input type="hidden" name="ticketId" value={ticketId} />
      <FormMessage result={state} />

      <div>
        <label className="label" htmlFor="body">
          Add a reply
        </label>
        <textarea id="body" name="body" rows={4} required className="input" />
        <FieldError result={state} field="body" />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        {canAddInternal ? (
          <label className="flex items-center gap-2 text-sm text-foreground">
            {/* Unchecked checkboxes submit nothing at all, which is why the
                schema uses stringbool with a default rather than coercion. */}
            <input type="checkbox" name="isInternal" value="true" className="size-4" />
            Internal note (not visible to the requester or observers)
          </label>
        ) : (
          <span />
        )}
        <button type="submit" className="btn-primary" disabled={pending}>
          {pending ? 'Posting…' : 'Post reply'}
        </button>
      </div>
    </form>
  );
}
