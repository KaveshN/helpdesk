'use client';

import { useActionState } from 'react';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { recordDecisionAction } from '@/server/actions/changes';
import { FormMessage } from '@/components/ui/form-message';

/**
 * One CAB member's vote. The board's overall outcome is recomputed server-side
 * after every vote, so the reason string below is authoritative rather than a
 * client-side guess.
 */
export function ChangeDecisionForm({ changeRequestId }: { changeRequestId: string }) {
  const [state, formAction, pending] = useActionState(recordDecisionAction, undefined);
  const router = useRouter();

  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state, router]);

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="changeRequestId" value={changeRequestId} />
      <FormMessage result={state} />

      {state?.ok ? (
        <p className="rounded-md border bg-success-subtle px-3 py-2 text-sm text-success">
          Decision recorded. Board outcome: <strong>{state.data.outcome}</strong> &mdash;{' '}
          {state.data.reason}
        </p>
      ) : null}

      <div>
        <label className="label" htmlFor="comment">
          Comment <span className="text-faint">(recorded against your vote)</span>
        </label>
        <textarea id="comment" name="comment" rows={3} className="input" />
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          name="decision"
          value="APPROVED"
          className="btn-primary"
          disabled={pending}
        >
          Approve
        </button>
        <button
          type="submit"
          name="decision"
          value="REJECTED"
          className="btn-danger"
          disabled={pending}
        >
          Reject
        </button>
        <button
          type="submit"
          name="decision"
          value="ABSTAINED"
          className="btn-secondary"
          disabled={pending}
        >
          Abstain
        </button>
      </div>
      <p className="text-xs text-muted">
        Abstaining does not block the change: it removes you from the quorum calculation.
      </p>
    </form>
  );
}
