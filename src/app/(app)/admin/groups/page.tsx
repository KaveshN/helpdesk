import Link from 'next/link';
import { requireActor } from '@/lib/auth/session';
import { listGroupsForAdmin } from '@/lib/groups/service';
import { can } from '@/lib/authz/guard';
import { createGroupAction } from '@/server/actions/groups';
import { ActionForm } from '@/components/action-form';
import { NoPermission } from '@/components/no-permission';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Help desks' };

/** Common IANA zones for this deployment; the field accepts any zone string. */
const TIME_ZONES = [
  'Africa/Johannesburg',
  'Africa/Nairobi',
  'Africa/Lagos',
  'Africa/Cairo',
  'Europe/London',
  'UTC',
];

export default async function AdminGroupsPage() {
  const actor = await requireActor();

  if (!can(actor, 'platform:manage_groups')) {
    return (
      <NoPermission
        title="Help desk groups are managed by a Super Administrator"
        detail="Creating and configuring help desk groups is a platform-level action. Your own group's settings are under Configuration."
      />
    );
  }

  const groups = await listGroupsForAdmin(actor);

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Help desk groups</h1>
        <p className="mt-1 text-sm text-muted">
          Each group is an independent help desk: its own queues, taxonomy, SLAs, calendars and
          reporting. Administration is central; configuration is not.
        </p>
      </header>

      <section className="card overflow-x-auto">
        <table className="data-table w-full min-w-[720px] text-sm">
          <thead>
            <tr>
              <th className="px-4 py-2">Name</th>
              <th className="px-4 py-2">Key</th>
              <th className="px-4 py-2">Time zone</th>
              <th className="px-4 py-2">Members</th>
              <th className="px-4 py-2">Tickets</th>
              <th className="px-4 py-2">Inbound email</th>
              <th className="px-4 py-2">State</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {groups.map((group) => (
              <tr key={group.id} className="hover:bg-subtle">
                <td className="px-4 py-2 font-medium">
                  <Link href={`/admin/groups/${group.id}`} className="underline">
                    {group.name}
                  </Link>
                </td>
                <td className="px-4 py-2 font-mono text-xs">{group.key}</td>
                <td className="px-4 py-2 text-muted">{group.timeZone}</td>
                <td className="px-4 py-2 tabular-nums">{group._count.memberships}</td>
                <td className="px-4 py-2 tabular-nums">{group._count.tickets}</td>
                <td className="px-4 py-2 text-muted">{group.inboundEmailAddress ?? '—'}</td>
                <td className="px-4 py-2">
                  {group.isActive ? (
                    <span className="text-success">Active</span>
                  ) : (
                    <span className="text-muted">Inactive</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card p-5 xl:max-w-4xl">
        <h2 className="text-base font-semibold">Create a help desk</h2>
        <p className="mt-1 mb-4 text-sm text-muted">
          Creating a group also provisions its statuses, priorities, types, a business-hours
          calendar, notification templates and a default SLA policy, so it can accept a ticket
          immediately.
        </p>

        <ActionForm
          action={createGroupAction}
          submitLabel="Create help desk"
          successMessage="Created."
        >
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <div>
              <label className="label" htmlFor="name">
                Name
              </label>
              <input
                id="name"
                name="name"
                required
                className="input"
                placeholder="Kenya Help Desk"
              />
            </div>
            <div>
              <label className="label" htmlFor="key">
                Reference key
              </label>
              <input
                id="key"
                name="key"
                required
                maxLength={10}
                className="input font-mono uppercase"
                placeholder="KEN"
              />
              <p className="mt-1 text-xs text-muted">
                Prefixes every ticket number, e.g. KEN-000123. Cannot be reused.
              </p>
            </div>
            <div className="sm:col-span-2">
              <label className="label" htmlFor="description">
                Description
              </label>
              <input id="description" name="description" className="input" />
            </div>
            <div>
              <label className="label" htmlFor="timeZone">
                Time zone
              </label>
              <select
                id="timeZone"
                name="timeZone"
                className="input"
                defaultValue="Africa/Johannesburg"
              >
                {TIME_ZONES.map((zone) => (
                  <option key={zone} value={zone}>
                    {zone}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-muted">
                Drives working hours and SLA arithmetic for this group.
              </p>
            </div>
            <div>
              <label className="label" htmlFor="observerScope">
                Observer visibility
              </label>
              <select
                id="observerScope"
                name="observerScope"
                className="input"
                defaultValue="WATCHED_ONLY"
              >
                <option value="WATCHED_ONLY">Only tickets they watch</option>
                <option value="ALL_TICKETS">Every ticket in the group</option>
              </select>
            </div>
            <div>
              <label className="label" htmlFor="inboundEmailAddress">
                Inbound email address
              </label>
              <input
                id="inboundEmailAddress"
                name="inboundEmailAddress"
                type="email"
                className="input"
                placeholder="kenya-helpdesk@example.com"
              />
              <p className="mt-1 text-xs text-muted">Used by email-to-ticket in Phase 6.</p>
            </div>
            <div>
              <label className="label" htmlFor="outboundEmailAddress">
                Outbound (from) address
              </label>
              <input
                id="outboundEmailAddress"
                name="outboundEmailAddress"
                type="email"
                className="input"
              />
            </div>
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input
                type="checkbox"
                name="includeStarterConfig"
                value="true"
                defaultChecked
                className="size-4"
              />
              Include starter categories and a default SLA policy
            </label>
          </div>
        </ActionForm>
      </section>
    </div>
  );
}
