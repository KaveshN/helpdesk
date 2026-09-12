'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LifeBuoy, LogOut, Menu, X } from 'lucide-react';
import { GroupSwitcher } from '@/components/shell/group-switcher';
import { Icon } from '@/components/shell/icon';
import { AppearanceMenu } from '@/components/theme/appearance-menu';
import type { NavSection } from '@/components/shell/nav-items';
import type { GroupSummary } from '@/lib/auth/session';
import { brand } from '@/config/brand';
import { cn } from '@/lib/utils';

/**
 * Application shell navigation.
 *
 * Persistent rail on `lg` and up, slide-over drawer below it — the pattern used
 * by Linear, Height and the Vercel dashboard. The rail is fixed and the content
 * column is offset by its width, so long tables scroll without taking the
 * navigation with them.
 *
 * Rebuilt in the shell redesign step (collapsible rail, command palette,
 * top bar). This revision only moves it onto the new tokens.
 */
export function Sidebar({
  sections,
  groups,
  activeGroupId,
  user,
  signOut,
}: {
  sections: NavSection[];
  groups: GroupSummary[];
  activeGroupId: string | null;
  user: { name: string; email: string; role: string };
  signOut: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  const nav = (
    <div className="flex h-full flex-col gap-4 p-3">
      <div className="flex items-center gap-2 px-1 pt-1">
        <LifeBuoy className="size-5 text-primary" aria-hidden />
        <span className="text-base font-semibold tracking-tight">{brand.productName}</span>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="btn-ghost ml-auto !px-2 lg:hidden"
          aria-label="Close navigation"
        >
          <X className="size-4" />
        </button>
      </div>

      {activeGroupId ? <GroupSwitcher groups={groups} activeGroupId={activeGroupId} /> : null}

      <nav className="scrollbar-thin flex-1 space-y-5 overflow-y-auto" aria-label="Main">
        {sections.map((section, index) => (
          <div key={section.title ?? `section-${index}`} className="space-y-0.5">
            {section.title ? (
              <h2 className="px-2 pb-1 text-2xs font-semibold tracking-wider text-muted-foreground uppercase">
                {section.title}
              </h2>
            ) : null}
            {section.items.map((item) => {
              const active = isActive(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  // Closed on click rather than in an effect watching pathname:
                  // handle the event, don't sync state to it.
                  onClick={() => setOpen(false)}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'group relative flex items-center gap-2.5 rounded-lg px-2 py-[0.4375rem] text-sm font-medium transition',
                    active
                      ? 'bg-muted text-foreground'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                  )}
                >
                  <Icon
                    name={item.icon}
                    className={cn(
                      'size-[1.0625rem] shrink-0',
                      active ? '' : 'text-faint group-hover:text-muted-foreground',
                    )}
                  />
                  <span className="flex-1 truncate">{item.label}</span>
                  {item.badge ? (
                    <span className="rounded-full bg-warning-subtle px-1.5 py-0.5 text-2xs font-semibold text-warning tabular">
                      {item.badge}
                    </span>
                  ) : null}
                  {active ? (
                    <span aria-hidden className="absolute left-0 h-5 w-0.5 rounded-r bg-primary" />
                  ) : null}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="border-t pt-3">
        <div className="flex items-center gap-2 px-1">
          <span
            className="grid size-7 shrink-0 place-items-center rounded-full bg-muted text-2xs font-semibold text-muted-foreground"
            aria-hidden
          >
            {user.name
              .split(' ')
              .slice(0, 2)
              .map((part) => part[0])
              .join('')
              .toUpperCase()}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{user.name}</span>
            <span className="block truncate text-2xs text-muted-foreground">{user.role}</span>
          </span>
          <AppearanceMenu align="end" />
          <form action={signOut}>
            <button
              type="submit"
              className="btn-ghost !px-2"
              title="Sign out"
              aria-label="Sign out"
            >
              <LogOut className="size-4" />
            </button>
          </form>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex items-center gap-2 border-b bg-card/85 px-4 py-2.5 backdrop-blur lg:hidden">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="btn-ghost !px-2"
          aria-label="Open navigation"
        >
          <Menu className="size-5" />
        </button>
        <LifeBuoy className="size-4 text-primary" aria-hidden />
        <span className="truncate text-sm font-semibold">
          {groups.find((group) => group.id === activeGroupId)?.name ?? brand.productName}
        </span>
      </header>

      {/* Backdrop, drawer only */}
      {open ? (
        <button
          type="button"
          aria-label="Close navigation"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-40 cursor-default bg-foreground/40 backdrop-blur-[1px] lg:hidden"
        />
      ) : null}

      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 w-[var(--sidebar-width)] border-r bg-card transition-transform duration-200 ease-out lg:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
        aria-label="Sidebar"
      >
        {nav}
      </aside>
    </>
  );
}
