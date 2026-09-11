import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireActor } from '@/lib/auth/session';
import { db } from '@/lib/db/client';
import { ASSIGNABLE_ROLES, listMembers } from '@/lib/groups/service';
import { can } from '@/lib/authz/guard';
import {
  removeMembershipAction,
  updateGroupAction,
  upsertMembershipAction,
} from '@/server/actions/groups';
import { ActionForm } from '@/components/action-form';
import { ConfirmForm } from '@/components/confirm-form';
import { NoPermission } from '@/components/no-permission';

export const dynamic = 'force-dynamic';

const ROLE_LABELS: Record<string, string> = {
  HD_ADMIN: 'Help Desk Administrator',
  AGENT: 'Agent',
  OBSERVER: 'Observer',
};

export default async function GroupDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requireActor();

  // A Super Admin manages any group; an HD Admin manages only their own.
  if (!actor.isSuperAdmin && !can(actor, 'group:manage_members', id)) {
    return (
      <NoPermission
        title="You cannot manage members of this help desk"
        detail="Only a Help Desk Administrator for this group, or a Super Administrator, can change memberships and roles."
      />
    );
  }

  const group = await db().helpDeskGroup.findUnique({ where: { id } });
  if (!group) notFound();

  const members = await listMembers(actor, id);
  const canEditSettings = actor.isSuperAdmin || can(actor, 'group:manage_settings', id);

  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <nav className="text-sm text-muted">
        {actor.isSuperAdmin ? (
          <>
            <Link href="/admin/groups" className="underline">
              Help desks
            </Link>
            <span className="mx-2">/</span>
          </>
        ) : null}
        <span>{group.name}</span>
      </nav>

      <header>
        <h1 className="text-xl font-semibold tracking-tight">{group.name}</h1>
        <p className="mt-1 text-sm text-muted">
          <span className="font-mono">{group.key}</span> &middot; {group.timeZone} &middot;{' '}
          {group.isActive ? 'active' : 'inactive'}
        </p>
      </header>

      <section className="card p-5">
        <h2 className="text-base font-semibold">Members and roles</h2>
        <p className="mt-1 mb-4 text-sm text-muted">
          Roles are per group. The same person can be an agent here and an administrator elsewhere.
          Changing a role revokes that person&rsquo;s active sessions immediately.
        </p>

        <table className="data-table w-full text-sm">
          <thead>
            <tr>
              <th className="px-2 py-2">Name</th>
              <th className="px-2 py-2">Email</th>
              <th className="px-2 py-2">Role</th>
              <th className="px-2 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {members.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-2 py-6 text-center text-muted">
                  No members yet.
                </td>
              </tr>
            ) : (
              members.map((membership) => (
                <tr key={membership.id}>
                  <td className="px-2 py-2">
                    {membership.user.name}
                    {membership.user.platformRole === 'SUPER_ADMIN' ? (
                      <span className="ml-2 rounded bg-subtle px-1.5 py-0.5 text-xs">
                        Super Admin
                      </span>
                    ) : null}
                  </td>
                  <td className="px-2 py-2 text-muted">{membership.user.email}</td>
                  <td className="px-2 py-2">{ROLE_LABELS[membership.role] ?? membership.role}</td>
                  <td className="px-2 py-2 text-right">
                    <ConfirmForm
                      action={removeMembershipAction}
                      values={{ helpDeskGroupId: id, userId: membership.userId }}
                      label="Remove"
                      confirmMessage={`Remove ${membership.user.name} from ${group.name}?`}
                    />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        <div className="mt-6 border-t pt-4">
          <h3 className="mb-3 text-sm font-semibold text-foreground">Add or change a member</h3>
          <ActionForm action={upsertMembershipAction} submitLabel="Save member" compact>
            <input type="hidden" name="helpDeskGroupId" value={id} />
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="sm:col-span-2">
                <label className="label" htmlFor="email">
                  Email address
                </label>
                <input id="email" name="email" type="email" required className="input" />
                <p className="mt-1 text-xs text-muted">
                  An unknown address creates a placeholder user, linked to their Entra identity the
                  first time they sign in.
                </p>
              </div>
              <div>
                <label className="label" htmlFor="role">
                  Role
                </label>
                <select id="role" name="role" className="input" defaultValue="AGENT">
                  {ASSIGNABLE_ROLES.map((role) => (
                    <option key={role} value={role}>
                      {ROLE_LABELS[role]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-3">
                <label className="label" htmlFor="name">
                  Display name (new users only)
                </label>
                <input id="name" name="name" className="input" />
              </div>
            </div>
          </ActionForm>
        </div>
      </section>

      {canEditSettings ? (
        <section className="card p-5">
          <h2 className="text-base font-semibold">Group settings</h2>
          <p className="mt-1 mb-4 text-sm text-muted">
            Every change here is written to the audit trail with before and after values.
          </p>

          <ActionForm action={updateGroupAction} submitLabel="Save settings">
            <input type="hidden" name="helpDeskGroupId" value={id} />
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              <div>
                <label className="label" htmlFor="settings-name">
                  Name
                </label>
                <input
                  id="settings-name"
                  name="name"
                  defaultValue={group.name}
                  required
                  className="input"
                />
              </div>
              <div>
                <label className="label" htmlFor="settings-timeZone">
                  Time zone
                </label>
                <input
                  id="settings-timeZone"
                  name="timeZone"
                  defaultValue={group.timeZone}
                  required
                  className="input"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="label" htmlFor="settings-description">
                  Description
                </label>
                <input
                  id="settings-description"
                  name="description"
                  defaultValue={group.description ?? ''}
                  className="input"
                />
              </div>
              <div>
                <label className="label" htmlFor="settings-inbound">
                  Inbound email address
                </label>
                <input
                  id="settings-inbound"
                  name="inboundEmailAddress"
                  type="email"
                  defaultValue={group.inboundEmailAddress ?? ''}
                  className="input"
                />
              </div>
              <div>
                <label className="label" htmlFor="settings-outbound">
                  Outbound (from) address
                </label>
                <input
                  id="settings-outbound"
                  name="outboundEmailAddress"
                  type="email"
                  defaultValue={group.outboundEmailAddress ?? ''}
                  className="input"
                />
              </div>
              <div>
                <label className="label" htmlFor="settings-observerScope">
                  Observer visibility
                </label>
                <select
                  id="settings-observerScope"
                  name="observerScope"
                  className="input"
                  defaultValue={group.observerScope}
                >
                  <option value="WATCHED_ONLY">Only tickets they watch</option>
                  <option value="ALL_TICKETS">Every ticket in the group</option>
                </select>
              </div>
              {actor.isSuperAdmin ? (
                <label className="flex items-end gap-2 pb-2 text-sm">
                  <input
                    type="checkbox"
                    name="isActive"
                    value="true"
                    defaultChecked={group.isActive}
                    className="size-4"
                  />
                  Group is active
                </label>
              ) : null}
            </div>
          </ActionForm>
        </section>
      ) : null}
    </div>
  );
}
