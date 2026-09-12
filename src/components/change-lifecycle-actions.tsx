'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { submitChangeAction, transitionChangeAction } from '@/server/actions/changes';
import type { ChangeStatus } from '@/generated/prisma/enums';

type Transition = {
  to: ChangeStatus;
  label: string;
  tone: 'primary' | 'secondary' | 'danger';
  needsNotes?: boolean;
};

/**
 * Lifecycle buttons. Only transitions the server state machine allows are
 * rendered, and the server re-checks: this list is an affordance, not the rule.
 */
export function ChangeLifecycleActions({
  changeRequestId,
  canSubmit,
  transitions,
}: {
  changeRequestId: string;
  canSubmit: boolean;
  transitions: Transition[];
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const router = useRouter();

  function run(
    action: (formData: FormData) => Promise<{ ok: boolean; error?: string }>,
    values: Record<string, string>,
  ) {
    setError(null);
    const formData = new FormData();
    formData.set('changeRequestId', changeRequestId);
    for (const [key, value] of Object.entries(values)) formData.set(key, value);
    startTransition(async () => {
      const result = await action(formData);
      if (!result.ok) setError(result.error ?? 'That action could not be completed.');
      router.refresh();
    });
  }

  const needsNotes = transitions.some((transition) => transition.needsNotes);

  return (
    <div className="space-y-3">
      {error ? (
        <p
          role="alert"
          className="rounded-md border bg-destructive-subtle px-3 py-2 text-sm text-destructive"
        >
          {error}
        </p>
      ) : null}

      {needsNotes ? (
        <div>
          <label className="label" htmlFor="outcomeNotes">
            Outcome notes
          </label>
          <textarea
            id="outcomeNotes"
            rows={3}
            className="input"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="What happened during implementation?"
          />
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {canSubmit ? (
          <button
            type="button"
            className="btn-primary"
            disabled={pending}
            onClick={() => run(submitChangeAction, {})}
          >
            {pending ? 'Working…' : 'Submit for approval'}
          </button>
        ) : null}

        {transitions.map((transition) => (
          <button
            key={transition.to}
            type="button"
            disabled={pending}
            className={
              transition.tone === 'primary'
                ? 'btn-primary'
                : transition.tone === 'danger'
                  ? 'btn-danger'
                  : 'btn-secondary'
            }
            onClick={() => {
              if (transition.tone === 'danger' && !window.confirm(`${transition.label}?`)) return;
              run(transitionChangeAction, {
                to: transition.to,
                ...(transition.needsNotes && notes ? { outcomeNotes: notes } : {}),
              });
            }}
          >
            {transition.label}
          </button>
        ))}
      </div>
    </div>
  );
}
