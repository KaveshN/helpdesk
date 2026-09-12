'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Building2, Check, ChevronsUpDown } from 'lucide-react';
import { switchGroupAction } from '@/server/actions/session';
import type { GroupSummary } from '@/lib/auth/session';

const ROLE_LABEL: Record<string, string> = {
  HD_ADMIN: 'Administrator',
  AGENT: 'Agent',
  OBSERVER: 'Observer',
};

/**
 * Help desk switcher (brief §5), styled after the workspace switchers in Linear
 * and Vercel: the current tenant is always visible at the top of the sidebar,
 * because "which tenant am I in" is the single most consequential piece of
 * state in the product.
 *
 * Switching is a server round trip, never client state — the active group
 * decides what every subsequent query is scoped to, so it is re-validated
 * server-side rather than trusted from the browser.
 */
export function GroupSwitcher({
  groups,
  activeGroupId,
}: {
  groups: GroupSummary[];
  activeGroupId: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const active = groups.find((group) => group.id === activeGroupId);
  const canSwitch = groups.length > 1;

  function select(groupId: string) {
    setOpen(false);
    if (groupId === activeGroupId) return;

    const formData = new FormData();
    formData.set('helpDeskGroupId', groupId);
    startTransition(async () => {
      const result = await switchGroupAction(formData);
      if (result.ok) {
        // Land on the dashboard: a ticket URL from the previous group would
        // 404 under the new scope, which reads as a bug rather than a switch.
        router.push('/dashboard');
        router.refresh();
      }
    });
  }

  return (
    <div className="relative">
      <button
        type="button"
        disabled={!canSwitch || pending}
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup={canSwitch ? 'listbox' : undefined}
        className="flex w-full items-center gap-2.5 rounded-lg border bg-card px-2.5 py-2 text-left transition hover:bg-muted disabled:cursor-default disabled:hover:bg-card"
      >
        <span
          className="grid size-7 shrink-0 place-items-center rounded-md text-2xs font-bold tracking-tight"
          style={{ background: 'var(--primary-subtle)', color: 'var(--primary)' }}
          aria-hidden
        >
          {active?.key.slice(0, 3) ?? <Building2 className="size-4" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">
            {active?.name ?? 'No help desk'}
          </span>
          <span className="block truncate text-2xs text-muted-foreground">
            {active?.role ? ROLE_LABEL[active.role] : 'Super Administrator'}
          </span>
        </span>
        {canSwitch ? <ChevronsUpDown className="size-4 shrink-0 text-faint" aria-hidden /> : null}
      </button>

      {open && canSwitch ? (
        <>
          {/* Click-away catcher; keeps the popover dependency-free. */}
          <button
            type="button"
            aria-label="Close help desk list"
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setOpen(false)}
          />
          <ul
            role="listbox"
            className="absolute z-50 mt-1.5 max-h-80 w-full overflow-y-auto rounded-lg border bg-card p-1"
            style={{ boxShadow: 'var(--shadow-pop)' }}
          >
            {groups.map((group) => (
              <li key={group.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={group.id === activeGroupId}
                  onClick={() => select(group.id)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition hover:bg-muted"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{group.name}</span>
                    <span className="block truncate font-mono text-2xs text-faint">
                      {group.key}
                    </span>
                  </span>
                  {group.id === activeGroupId ? (
                    <Check className="size-4 shrink-0" style={{ color: 'var(--primary)' }} />
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}
