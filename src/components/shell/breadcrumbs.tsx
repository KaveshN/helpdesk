'use client';

import { useEffect, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

export type Crumb = { label: string; href?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Route-derived trail. Detail pages replace the generic last crumb ("Ticket")
 * with the record's reference through `<SetBreadcrumbs>`; everything else is
 * knowable from the path alone. Pure, so it is unit-tested.
 */
export function crumbsForPath(pathname: string): Crumb[] {
  const segments = pathname.split('/').filter(Boolean);
  const [first, second, third] = segments;

  switch (first) {
    case undefined:
    case 'dashboard':
      return [{ label: 'Dashboard' }];
    case 'tickets':
      if (!second) return [{ label: 'Tickets' }];
      if (second === 'new')
        return [{ label: 'Tickets', href: '/tickets' }, { label: 'New ticket' }];
      return [
        { label: 'Tickets', href: '/tickets' },
        { label: UUID.test(second) ? 'Ticket' : second },
      ];
    case 'changes':
      if (!second) return [{ label: 'Changes' }];
      if (second === 'new') {
        return [{ label: 'Changes', href: '/changes' }, { label: 'Raise a change' }];
      }
      return [
        { label: 'Changes', href: '/changes' },
        { label: UUID.test(second) ? 'Change' : second },
      ];
    case 'reports':
      if (second === 'overview') {
        return [{ label: 'Reports', href: '/reports' }, { label: 'All help desks' }];
      }
      return [{ label: 'Reports' }];
    case 'admin': {
      const admin: Crumb = { label: 'Administration' };
      switch (second) {
        case 'configuration':
          return [admin, { label: 'Configuration' }];
        case 'change-config':
          return [admin, { label: 'CAB & risk' }];
        case 'audit':
          return [admin, { label: 'Audit trail' }];
        case 'groups':
          if (!third) return [admin, { label: 'Help desks' }];
          return [admin, { label: 'Help desks', href: '/admin/groups' }, { label: 'Help desk' }];
        default:
          return [admin];
      }
    }
    default:
      return segments.map((segment) => ({ label: segment }));
  }
}

/**
 * A tiny external store rather than context state: a page sets its crumbs
 * from an effect, and writing to a module-level store from an effect is
 * "synchronising with an external system", which is what effects are for.
 * The top bar subscribes with useSyncExternalStore.
 */
type Override = { pathname: string; items: Crumb[] } | null;
let override: Override = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
const getSnapshot = () => override;
const getServerSnapshot = (): Override => null;

/** Rendered by a page (server or client) to name the current record. */
export function SetBreadcrumbs({ items }: { items: Crumb[] }) {
  const pathname = usePathname();
  const key = JSON.stringify(items);
  useEffect(() => {
    override = { pathname, items: JSON.parse(key) as Crumb[] };
    emit();
    return () => {
      if (override?.pathname === pathname) {
        override = null;
        emit();
      }
    };
  }, [pathname, key]);
  return null;
}

export function useBreadcrumbs(): Crumb[] {
  const pathname = usePathname();
  const current = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return current && current.pathname === pathname ? current.items : crumbsForPath(pathname);
}

export function Breadcrumbs({ className }: { className?: string }) {
  const crumbs = useBreadcrumbs();
  return (
    <nav aria-label="Breadcrumb" className={cn('min-w-0', className)}>
      <ol className="flex min-w-0 items-center gap-1 text-sm">
        {crumbs.map((crumb, index) => {
          const last = index === crumbs.length - 1;
          return (
            <li key={`${crumb.label}-${index}`} className="flex min-w-0 items-center gap-1">
              {index > 0 ? (
                <ChevronRight className="size-3.5 shrink-0 text-faint" aria-hidden />
              ) : null}
              {crumb.href && !last ? (
                <Link
                  href={crumb.href}
                  className="truncate text-muted-foreground transition hover:text-foreground"
                >
                  {crumb.label}
                </Link>
              ) : (
                <span
                  aria-current={last ? 'page' : undefined}
                  className={cn(
                    'truncate',
                    last ? 'font-medium text-foreground' : 'text-muted-foreground',
                  )}
                >
                  {crumb.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
