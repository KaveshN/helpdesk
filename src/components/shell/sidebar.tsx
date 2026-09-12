'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LifeBuoy, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { GroupSwitcher } from '@/components/shell/group-switcher';
import { Icon } from '@/components/shell/icon';
import { useShell } from '@/components/shell/shell-provider';
import type { NavSection } from '@/components/shell/nav-items';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { GroupSummary } from '@/lib/auth/session';
import { cn } from '@/lib/utils';

/**
 * Application shell navigation.
 *
 * Desktop: a fixed rail that collapses to icons (the state lives in a cookie,
 * see ShellProvider). Below `lg`: a Radix Sheet, which traps focus and
 * restores it on close — the previous hand-rolled drawer did neither.
 *
 * The rail's width is `--sidebar-width`, swapped by `data-sidebar` on <html>,
 * so the content column offsets itself in CSS with no layout shift.
 */
export function Sidebar({
  sections,
  groups,
  activeGroupId,
  brandName,
}: {
  sections: NavSection[];
  groups: GroupSummary[];
  activeGroupId: string | null;
  brandName: string;
}) {
  const { collapsed, setCollapsed, mobileOpen, setMobileOpen } = useShell();

  return (
    <>
      <aside
        className="fixed inset-y-0 left-0 z-40 hidden w-[var(--sidebar-width)] flex-col border-r bg-card transition-[width] duration-200 ease-out lg:flex"
        aria-label="Sidebar"
      >
        <SidebarContent
          sections={sections}
          groups={groups}
          activeGroupId={activeGroupId}
          brandName={brandName}
          collapsed={collapsed}
          footer={
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => setCollapsed(!collapsed)}
                  aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                  aria-expanded={!collapsed}
                  className={cn(
                    'flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm text-muted-foreground transition hover:bg-muted hover:text-foreground',
                    collapsed ? 'justify-center' : '',
                  )}
                >
                  {collapsed ? (
                    <PanelLeftOpen className="size-[1.0625rem]" aria-hidden />
                  ) : (
                    <>
                      <PanelLeftClose className="size-[1.0625rem]" aria-hidden />
                      <span>Collapse</span>
                    </>
                  )}
                </button>
              </TooltipTrigger>
              {collapsed ? <TooltipContent side="right">Expand sidebar</TooltipContent> : null}
            </Tooltip>
          }
        />
      </aside>

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-[var(--sidebar-width)] gap-0 p-0" showCloseButton>
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SheetDescription className="sr-only">Main navigation for {brandName}</SheetDescription>
          <SidebarContent
            sections={sections}
            groups={groups}
            activeGroupId={activeGroupId}
            brandName={brandName}
            collapsed={false}
            onNavigate={() => setMobileOpen(false)}
          />
        </SheetContent>
      </Sheet>
    </>
  );
}

function SidebarContent({
  sections,
  groups,
  activeGroupId,
  brandName,
  collapsed,
  footer,
  onNavigate,
}: {
  sections: NavSection[];
  groups: GroupSummary[];
  activeGroupId: string | null;
  brandName: string;
  collapsed: boolean;
  footer?: React.ReactNode;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <div className={cn('flex h-full flex-col gap-4', collapsed ? 'p-2' : 'p-3')}>
      <Link
        href="/dashboard"
        onClick={onNavigate}
        className={cn(
          'flex items-center gap-2 rounded-lg px-1 pt-1',
          collapsed ? 'justify-center' : '',
        )}
        aria-label={collapsed ? brandName : undefined}
      >
        <LifeBuoy className="size-5 shrink-0 text-primary" aria-hidden />
        {collapsed ? null : (
          <span className="truncate text-base font-semibold tracking-tight">{brandName}</span>
        )}
      </Link>

      {activeGroupId ? (
        <GroupSwitcher groups={groups} activeGroupId={activeGroupId} collapsed={collapsed} />
      ) : null}

      <nav className="scrollbar-thin flex-1 space-y-5 overflow-y-auto" aria-label="Main">
        {sections.map((section, index) => (
          <div key={section.title ?? `section-${index}`} className="space-y-0.5">
            {section.title && !collapsed ? (
              <h2 className="px-2 pb-1 text-2xs font-semibold tracking-wider text-muted-foreground uppercase">
                {section.title}
              </h2>
            ) : null}
            {section.title && collapsed && index > 0 ? (
              <div className="mx-2 mb-1 border-t" aria-hidden />
            ) : null}
            {section.items.map((item) => {
              const active = isActive(item.href);
              const link = (
                <Link
                  href={item.href}
                  onClick={onNavigate}
                  aria-current={active ? 'page' : undefined}
                  aria-label={collapsed ? item.label : undefined}
                  className={cn(
                    'group relative flex items-center gap-2.5 rounded-lg text-sm font-medium transition',
                    collapsed ? 'justify-center px-0 py-2' : 'px-2 py-[0.4375rem]',
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
                  {collapsed ? null : <span className="flex-1 truncate">{item.label}</span>}
                  {item.badge ? (
                    collapsed ? (
                      <span
                        aria-hidden
                        className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-warning"
                      />
                    ) : (
                      <span className="rounded-full bg-warning-subtle px-1.5 py-0.5 text-2xs font-semibold text-warning tabular">
                        {item.badge}
                      </span>
                    )
                  ) : null}
                  {active ? (
                    <span aria-hidden className="absolute left-0 h-5 w-0.5 rounded-r bg-primary" />
                  ) : null}
                </Link>
              );
              return collapsed ? (
                <Tooltip key={item.href}>
                  <TooltipTrigger asChild>{link}</TooltipTrigger>
                  <TooltipContent side="right">
                    {item.label}
                    {item.badge ? ` · ${item.badge} awaiting you` : ''}
                  </TooltipContent>
                </Tooltip>
              ) : (
                <div key={item.href}>{link}</div>
              );
            })}
          </div>
        ))}
      </nav>

      {footer ? <div className="border-t pt-2">{footer}</div> : null}
    </div>
  );
}
