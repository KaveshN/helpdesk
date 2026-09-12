'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Building2, Check, ChevronsUpDown } from 'lucide-react';
import { toast } from 'sonner';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { switchGroupAction } from '@/server/actions/session';
import type { GroupSummary } from '@/lib/auth/session';
import { cn } from '@/lib/utils';

const ROLE_LABEL: Record<string, string> = {
  HD_ADMIN: 'Administrator',
  AGENT: 'Agent',
  OBSERVER: 'Observer',
};

/**
 * Help desk switcher, styled after the workspace switchers in Linear and
 * Vercel: the current tenant is always visible at the top of the sidebar,
 * because "which tenant am I in" is the single most consequential piece of
 * state in the product.
 *
 * Switching is a server round trip, never client state — the active group
 * decides what every subsequent query is scoped to, so it is re-validated
 * server-side rather than trusted from the browser. Radix DropdownMenu gives
 * the keyboard behaviour the old hand-rolled listbox lacked.
 */
export function GroupSwitcher({
  groups,
  activeGroupId,
  collapsed = false,
}: {
  groups: GroupSummary[];
  activeGroupId: string;
  collapsed?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const active = groups.find((group) => group.id === activeGroupId);
  const canSwitch = groups.length > 1;
  const activeRole = active?.role ? ROLE_LABEL[active.role] : 'Super Administrator';

  function select(groupId: string) {
    if (groupId === activeGroupId) return;
    const formData = new FormData();
    formData.set('helpDeskGroupId', groupId);
    startTransition(async () => {
      const result = await switchGroupAction(formData);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      // Land on the dashboard: a ticket URL from the previous group would
      // 404 under the new scope, which reads as a bug rather than a switch.
      router.push('/dashboard');
      router.refresh();
    });
  }

  const badge = (
    <span
      className="grid size-7 shrink-0 place-items-center rounded-md bg-primary-subtle text-2xs font-bold tracking-tight text-primary"
      aria-hidden
    >
      {active?.key.slice(0, 3) ?? <Building2 className="size-4" />}
    </span>
  );

  const trigger = (
    <button
      type="button"
      disabled={!canSwitch || pending}
      aria-label={collapsed ? `Help desk: ${active?.name ?? 'none'}` : undefined}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-lg border bg-card text-left transition',
        'hover:bg-muted disabled:cursor-default disabled:hover:bg-card',
        'focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none',
        collapsed ? 'justify-center px-0 py-1.5' : 'px-2.5 py-2',
      )}
    >
      {badge}
      {collapsed ? null : (
        <>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold">
              {active?.name ?? 'No help desk'}
            </span>
            <span className="block truncate text-2xs text-muted-foreground">{activeRole}</span>
          </span>
          {canSwitch ? <ChevronsUpDown className="size-4 shrink-0 text-faint" aria-hidden /> : null}
        </>
      )}
    </button>
  );

  if (!canSwitch) {
    return collapsed ? (
      <Tooltip>
        <TooltipTrigger asChild>{trigger}</TooltipTrigger>
        <TooltipContent side="right">
          {active?.name} · {activeRole}
        </TooltipContent>
      </Tooltip>
    ) : (
      trigger
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align="start" side={collapsed ? 'right' : 'bottom'} className="w-64">
        <DropdownMenuLabel className="text-2xs tracking-wider text-muted-foreground uppercase">
          Switch help desk
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {groups.map((group) => {
          const isActive = group.id === activeGroupId;
          return (
            <DropdownMenuItem
              key={group.id}
              onSelect={() => select(group.id)}
              className="gap-2.5"
              aria-current={isActive ? 'true' : undefined}
            >
              <span className="grid size-6 shrink-0 place-items-center rounded-md bg-muted font-mono text-2xs font-bold">
                {group.key.slice(0, 3)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{group.name}</span>
                <span className="block truncate text-2xs text-muted-foreground">
                  {group.role ? ROLE_LABEL[group.role] : 'Super Administrator'}
                </span>
              </span>
              {isActive ? <Check className="size-4 shrink-0 text-primary" aria-hidden /> : null}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
