'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { addWatcherAction, removeWatcherAction } from '@/server/actions/tickets';

/**
 * Observers / watchers / followers for one ticket (brief §5, ticket-level half
 * of observer visibility).
 */
export function WatcherManager({
  ticketId,
  watchers,
  candidates,
  canManage,
}: {
  ticketId: string;
  watchers: Array<{ userId: string; name: string; email: string }>;
  candidates: Array<{ id: string; name: string; email: string }>;
  canManage: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const watching = new Set(watchers.map((watcher) => watcher.userId));
  const addable = candidates.filter((candidate) => !watching.has(candidate.id));

  function submit(action: (formData: FormData) => Promise<unknown>, userId: string) {
    const formData = new FormData();
    formData.set('ticketId', ticketId);
    formData.set('userId', userId);
    startTransition(async () => {
      await action(formData);
      router.refresh();
    });
  }

  return (
    <div className="card space-y-3 p-4">
      <h2 className="text-sm font-semibold text-foreground">Watchers</h2>

      {watchers.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nobody is watching this ticket.</p>
      ) : (
        <ul className="space-y-2">
          {watchers.map((watcher) => (
            <li key={watcher.userId} className="flex items-center justify-between gap-2 text-sm">
              <span title={watcher.email}>{watcher.name}</span>
              {canManage ? (
                <button
                  type="button"
                  className="text-xs text-destructive underline disabled:opacity-50"
                  disabled={pending}
                  onClick={() => submit(removeWatcherAction, watcher.userId)}
                >
                  Remove
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {canManage && addable.length > 0 ? (
        <div className="flex gap-2 border-t pt-3">
          <select
            aria-label="Add watcher"
            className="input"
            defaultValue=""
            disabled={pending}
            onChange={(event) => {
              if (event.target.value) submit(addWatcherAction, event.target.value);
            }}
          >
            <option value="">Add a watcher…</option>
            {addable.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.name}
              </option>
            ))}
          </select>
        </div>
      ) : null}
    </div>
  );
}
