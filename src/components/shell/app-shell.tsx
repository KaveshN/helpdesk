'use client';

import { CommandPalette, type QuickActions } from '@/components/shell/command-palette';
import type { NavSection } from '@/components/shell/nav-items';
import { ShellProvider } from '@/components/shell/shell-provider';
import { Sidebar } from '@/components/shell/sidebar';
import { TopBar } from '@/components/shell/top-bar';
import type { GroupSummary } from '@/lib/auth/session';

/**
 * The signed-in frame: rail + top bar + content column + palette. Everything
 * it receives is serialisable data computed on the server (navigation is
 * derived from capabilities in the layout), plus the sign-out server action.
 */
export function AppShell({
  sections,
  groups,
  activeGroupId,
  user,
  signOut,
  quickActions,
  initialCollapsed,
  brandName,
  children,
}: {
  sections: NavSection[];
  groups: GroupSummary[];
  activeGroupId: string | null;
  user: { name: string; email: string; role: string };
  signOut: () => Promise<void>;
  quickActions: QuickActions;
  initialCollapsed: boolean;
  brandName: string;
  children: React.ReactNode;
}) {
  return (
    <ShellProvider initialCollapsed={initialCollapsed}>
      <Sidebar
        sections={sections}
        groups={groups}
        activeGroupId={activeGroupId}
        brandName={brandName}
      />
      {/* Offset by the rail on desktop; full bleed below it. The padding reads
          the same variable the rail's width does, so both move together. */}
      <div className="min-h-screen transition-[padding] duration-200 ease-out lg:pl-[var(--sidebar-width)]">
        <TopBar user={user} signOut={signOut} />
        <main className="page-max page-x py-5 lg:py-6">{children}</main>
      </div>
      <CommandPalette sections={sections} quickActions={quickActions} />
    </ShellProvider>
  );
}
