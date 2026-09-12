import Link from 'next/link';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getAccessibleGroups, getActor, resolveGroupContext } from '@/lib/auth/session';
import { signOut } from '@/lib/auth/config';
import { can } from '@/lib/authz/guard';
import { pendingApprovalCount } from '@/lib/changes/service';
import { readPreferences } from '@/lib/preferences/schema';
import { brand } from '@/config/brand';
import { AppShell } from '@/components/shell/app-shell';
import type { NavSection } from '@/components/shell/nav-items';

/**
 * Authentication and tenant resolution for every signed-in page.
 *
 * force-dynamic matters here: a cached layout would serve one user's group
 * context to another. Every authenticated route renders per request.
 */
export const dynamic = 'force-dynamic';

const ROLE_LABEL: Record<string, string> = {
  HD_ADMIN: 'Help Desk Administrator',
  AGENT: 'Agent',
  OBSERVER: 'Observer',
};

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const actor = await getActor();
  if (!actor) redirect('/login');

  const [groups, group, cookieStore] = await Promise.all([
    getAccessibleGroups(),
    resolveGroupContext(),
    cookies(),
  ]);
  const preferences = readPreferences((name) => cookieStore.get(name)?.value);

  async function handleSignOut() {
    'use server';
    await signOut({ redirectTo: '/login' });
  }

  const groupId = group?.helpDeskGroupId;
  const allow = (capability: Parameters<typeof can>[1]) =>
    groupId ? can(actor, capability, groupId) : false;

  const awaitingApproval =
    group && allow('change:read') ? await pendingApprovalCount(actor, group) : 0;

  // Navigation is derived from capabilities, so a link never leads to a page
  // the actor will be refused at.
  const sections: NavSection[] = [];

  if (group) {
    sections.push({
      items: [
        { href: '/dashboard', label: 'Dashboard', icon: 'dashboard' },
        { href: '/tickets', label: 'Tickets', icon: 'tickets' },
        ...(allow('change:read')
          ? [
              {
                href: '/changes',
                label: 'Changes',
                icon: 'changes' as const,
                badge: awaitingApproval || undefined,
              },
            ]
          : []),
      ],
    });
  }

  const insights = [
    ...(allow('report:view')
      ? [{ href: '/reports', label: 'Reports', icon: 'reports' as const }]
      : []),
    ...(can(actor, 'platform:view_all_dashboards')
      ? [{ href: '/reports/overview', label: 'All help desks', icon: 'overview' as const }]
      : []),
  ];
  if (insights.length > 0) sections.push({ title: 'Insights', items: insights });

  const administration = [
    ...(allow('group:manage_members') || allow('group:manage_taxonomy')
      ? [{ href: '/admin/configuration', label: 'Configuration', icon: 'settings' as const }]
      : []),
    ...(allow('group:manage_change_config') || allow('group:manage_cab')
      ? [{ href: '/admin/change-config', label: 'CAB & risk', icon: 'shield' as const }]
      : []),
    ...(actor.isSuperAdmin
      ? [{ href: '/admin/groups', label: 'Help desks', icon: 'groups' as const }]
      : []),
    ...(allow('group:view_audit') || actor.isSuperAdmin
      ? [{ href: '/admin/audit', label: 'Audit trail', icon: 'audit' as const }]
      : []),
  ];
  if (administration.length > 0) sections.push({ title: 'Administration', items: administration });

  return (
    <AppShell
      sections={sections}
      groups={groups}
      activeGroupId={groupId ?? null}
      user={{
        name: actor.name,
        email: actor.email,
        role: actor.isSuperAdmin
          ? 'Super Administrator'
          : (ROLE_LABEL[group?.role ?? ''] ?? 'No role'),
      }}
      signOut={handleSignOut}
      quickActions={{
        canCreateTicket: allow('ticket:create'),
        canCreateChange: allow('change:create'),
      }}
      initialCollapsed={preferences.sidebar === 'collapsed'}
      brandName={brand.productName}
    >
      {group ? (
        children
      ) : (
        <div className="card mx-auto max-w-lg p-6">
          <h1 className="text-lg font-semibold">No help desk yet</h1>
          <p className="mt-2 text-muted-foreground">
            Your account exists but is not a member of any help desk group. A Super Administrator
            needs to add you to one before you can see tickets.
          </p>
          {actor.isSuperAdmin ? (
            <Link href="/admin/groups" className="btn-primary mt-5">
              Create the first help desk
            </Link>
          ) : null}
        </div>
      )}
    </AppShell>
  );
}
