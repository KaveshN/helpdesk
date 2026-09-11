import Link from 'next/link';
import { requireActor, resolveGroupContext } from '@/lib/auth/session';
import { db } from '@/lib/db/client';
import { can } from '@/lib/authz/guard';
import { EmptyState } from '@/components/ui/empty-state';
import { NoPermission } from '@/components/no-permission';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Audit trail' };

const PAGE_SIZE = 50;

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const actor = await requireActor();
  const group = await resolveGroupContext();

  const canViewGroupAudit = group ? can(actor, 'group:view_audit', group.helpDeskGroupId) : false;
  if (!actor.isSuperAdmin && !canViewGroupAudit) {
    return (
      <NoPermission
        title="You cannot view the audit trail"
        detail="The audit trail is available to Help Desk Administrators for their own group, and to Super Administrators platform-wide."
      />
    );
  }

  const page = Math.max(1, Number.parseInt((await searchParams).page ?? '1', 10) || 1);

  /**
   * A Super Administrator sees the whole platform trail, including
   * platform-level rows with no group. An HD Admin sees only their own group --
   * the audit trail is not an exception to tenancy.
   */
  const where = actor.isSuperAdmin ? {} : { helpDeskGroupId: group!.helpDeskGroupId };

  const [entries, total] = await Promise.all([
    db().auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { group: { select: { key: true, name: true } } },
    }),
    db().auditLog.count({ where }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Audit trail</h1>
        <p className="mt-1 text-sm text-muted">
          {actor.isSuperAdmin
            ? `Every administrative change across the platform (${total} entries).`
            : `Administrative changes in ${group?.groupName} (${total} entries).`}
        </p>
      </header>

      <section className="card overflow-x-auto">
        {entries.length === 0 ? (
          <EmptyState
            title="Nothing recorded yet"
            hint="Creating a group, changing a role or editing configuration will appear here."
          />
        ) : (
          <table className="data-table w-full min-w-[900px] text-sm">
            <thead>
              <tr>
                <th className="px-4 py-2">When</th>
                <th className="px-4 py-2">Actor</th>
                <th className="px-4 py-2">Action</th>
                <th className="px-4 py-2">Entity</th>
                <th className="px-4 py-2">Help desk</th>
                <th className="px-4 py-2">Change</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {entries.map((entry) => (
                <tr key={entry.id} className="align-top hover:bg-subtle">
                  <td className="whitespace-nowrap px-4 py-2 font-mono text-xs text-muted">
                    {entry.createdAt.toISOString().slice(0, 19).replace('T', ' ')}
                  </td>
                  <td className="px-4 py-2 text-foreground">{entry.actorEmail}</td>
                  <td className="px-4 py-2 font-mono text-xs">{entry.action}</td>
                  <td className="px-4 py-2 text-muted">{entry.entityType}</td>
                  <td className="px-4 py-2 text-muted">
                    {entry.group ? entry.group.key : <span className="text-faint">platform</span>}
                  </td>
                  <td className="px-4 py-2">
                    {entry.before || entry.after ? (
                      <details>
                        <summary className="cursor-pointer text-xs text-muted">
                          before / after
                        </summary>
                        <pre className="mt-1 max-w-md overflow-x-auto rounded bg-subtle p-2 text-[11px] leading-tight">
                          {JSON.stringify({ before: entry.before, after: entry.after }, null, 2)}
                        </pre>
                      </details>
                    ) : (
                      <span className="text-xs text-faint">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {totalPages > 1 ? (
        <nav className="flex items-center justify-between text-sm" aria-label="Pagination">
          <span className="text-muted">
            Page {page} of {totalPages}
          </span>
          <div className="flex gap-2">
            {page > 1 ? (
              <Link href={`/admin/audit?page=${page - 1}`} className="btn-secondary">
                Previous
              </Link>
            ) : null}
            {page < totalPages ? (
              <Link href={`/admin/audit?page=${page + 1}`} className="btn-secondary">
                Next
              </Link>
            ) : null}
          </div>
        </nav>
      ) : null}
    </div>
  );
}
