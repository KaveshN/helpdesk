'use client';

import { useActionState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import type { ActionResult } from '@/server/actions/result';
import { FormMessage } from '@/components/ui/form-message';

/**
 * Thin `useActionState` wrapper for the admin forms.
 *
 * Fields are passed in as children from the (server) page, which works because
 * plain inputs carry no event handlers -- only the state plumbing needs to be a
 * client component. Field-level errors are listed above the form rather than
 * threaded into each input, which keeps one component usable for every entity.
 */
export function ActionForm<T>({
  action,
  submitLabel,
  children,
  className = 'space-y-4',
  successMessage = 'Saved.',
  compact = false,
  redirectTo,
}: {
  action: (previous: ActionResult<T> | undefined, formData: FormData) => Promise<ActionResult<T>>;
  submitLabel: string;
  children: React.ReactNode;
  className?: string;
  successMessage?: string;
  compact?: boolean;
  /**
   * Path to navigate to on success. `:id` is replaced with the returned
   * record's id.
   *
   * A template string rather than a callback because props crossing the
   * server/client boundary must be serialisable -- passing a function throws
   * "Functions cannot be passed directly to Client Components".
   */
  redirectTo?: string;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const router = useRouter();

  useEffect(() => {
    if (!state?.ok || !redirectTo) return;
    const id = (state.data as { id?: string } | undefined)?.id;
    router.push(id ? redirectTo.replace(':id', id) : redirectTo);
  }, [state, redirectTo, router]);

  const fieldErrors = state && !state.ok ? state.fieldErrors : undefined;

  return (
    <form action={formAction} className={className}>
      <FormMessage result={state} />

      {fieldErrors ? (
        <ul className="list-inside list-disc rounded-md bg-danger-subtle px-3 py-2 text-xs text-danger">
          {Object.entries(fieldErrors).map(([field, messages]) => (
            <li key={field}>
              <span className="font-medium">{field === '_form' ? 'Form' : field}</span>:{' '}
              {messages.join(' ')}
            </li>
          ))}
        </ul>
      ) : null}

      {children}

      <div className={compact ? 'flex items-center gap-2' : 'flex items-center gap-3'}>
        <button
          type="submit"
          className={compact ? 'btn-secondary' : 'btn-primary'}
          disabled={pending}
        >
          {pending ? 'Saving…' : submitLabel}
        </button>
        {state?.ok ? <span className="text-xs text-success">{successMessage}</span> : null}
      </div>
    </form>
  );
}
