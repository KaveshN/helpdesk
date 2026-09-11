import Link from 'next/link';
import { Plus } from 'lucide-react';
import { requireSessionContext } from '@/lib/auth/session';
import { dashboardSummary, listTickets } from '@/lib/tickets/service';
import { ticketFilterSchema } from '@/lib/tickets/schemas';
import { can } from '@/lib/authz/guard';
import { StatTile } from '@/components/ui/stat-tile';
import { Pill } from '@/components/ui/pill';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { LeaderboardPanel } from '@/components/leaderboard-panel';
import { getLeaderboard } from '@/lib/leaderboard/service';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Dashboard' };

/** Horizontal proportion bar — cheaper to read than a pie at this size. */
function Breakdown({
  rows,
}: {
  rows: Array<{ id: string; name: string; colour: string | null; count: number }>;
}) {
  const total = rows.reduce((sum, row) => sum + row.count, 0);

  return (
    <ul className="space-y-2.5">
      {rows.map((row) => (
        <li key={row.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
          <div className="min-w-0">
            <div className="flex items-center justify-between gap-2">
              <Pill label={row.name} colour={row.colour} />
              <span className="tabular text-muted">{row.count}</span>
            </div>
            <div
              className="mt-1.5 h-1 w-full overflow-hidden rounded-full"
              style={{ background: 'var(--subtle)' }}
              aria-hidden
            >
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: total === 0 ? '0%' : `${(row.count / total) * 100}%`,
                  background: row.colour ?? 'var(--faint)',
                }}
              />
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

export default async function DashboardPage() {
  const { actor, group } = await requireSessionContext();

  const [summary, recent, leaderboard] = await Promise.all([
    dashboardSummary(actor, group),
    listTickets(actor, group, ticketFilterSchema.parse({ view: 'open', pageSize: 8 })),
    getLeaderboard(actor, group),
  ]);

  const canCreate = can(actor, 'ticket:create', group.helpDeskGroupId);

  return (
    <>
      <PageHeader
        title={group.groupName}
        description={`Signed in as ${actor.name} · ${actor.isSuperAdmin ? 'Super Administrator' : (group.role ?? 'no role in this group')}`}
        actions={
          canCreate ? (
            <Link href="/tickets/new" className="btn-primary">
              <Plus className="size-4" aria-hidden />
              New ticket
            </Link>
          ) : null
        }
      />

      <div className="space-y-6">
        <section aria-label="Ticket counts">
          {/* Reflows 2 → 3 → 5 across breakpoints rather than sitting in a fixed row. */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
            <StatTile
              label="Assigned to me"
              value={summary.tiles.assignedToMe}
              href="/tickets?view=assigned_to_me"
            />
            <StatTile label="Open" value={summary.tiles.open} href="/tickets?view=open" />
            <StatTile
              label="Unassigned"
              value={summary.tiles.unassigned}
              href="/tickets?view=unassigned"
              tone={summary.tiles.unassigned > 0 ? 'warning' : 'neutral'}
            />
            <StatTile
              label="Overdue"
              value={summary.tiles.overdue}
              href="/tickets?view=overdue"
              tone={summary.tiles.overdue > 0 ? 'danger' : 'neutral'}
              hint={summary.tiles.overdue === 0 ? 'SLA dates land in Phase 2' : undefined}
            />
            <StatTile label="Resolved today" value={summary.tiles.resolvedToday} tone="good" />
          </div>
        </section>

        {/* Table gets the width it needs; breakdowns sit beside it on wide screens. */}
        <div className="grid gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <section className="card overflow-hidden">
            <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
              <h2 className="panel-title">Open tickets</h2>
              <Link href="/tickets" className="link text-[0.8125rem] text-muted">
                View all
              </Link>
            </div>
            {recent.items.length === 0 ? (
              <EmptyState
                title="No open tickets in this help desk"
                hint="Create one to see the per-group numbering in action."
                action={
                  canCreate ? (
                    <Link href="/tickets/new" className="btn-secondary">
                      New ticket
                    </Link>
                  ) : null
                }
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Reference</th>
                      <th>Subject</th>
                      <th className="hidden sm:table-cell">Status</th>
                      <th className="hidden md:table-cell">Priority</th>
                      <th className="hidden lg:table-cell">Assignee</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recent.items.map((ticket) => (
                      <tr key={ticket.id}>
                        <td>
                          <Link
                            href={`/tickets/${ticket.id}`}
                            className="link font-mono text-xs whitespace-nowrap"
                          >
                            {ticket.reference}
                          </Link>
                        </td>
                        <td className="max-w-xs truncate" title={ticket.subject}>
                          {ticket.subject}
                        </td>
                        <td className="hidden sm:table-cell">
                          <Pill label={ticket.status.name} colour={ticket.status.colour} />
                        </td>
                        <td className="hidden md:table-cell">
                          <Pill label={ticket.priority.name} colour={ticket.priority.colour} />
                        </td>
                        <td className="hidden text-muted lg:table-cell">
                          {ticket.assignee?.name ?? (
                            <span style={{ color: 'var(--warning)' }}>Unassigned</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-1">
            {leaderboard ? <LeaderboardPanel view={leaderboard} /> : null}
            <section className="card p-4">
              <h2 className="panel-title mb-3">By status</h2>
              <Breakdown rows={summary.byStatus} />
            </section>

            <section className="card p-4">
              <h2 className="panel-title mb-3">Open by priority</h2>
              <Breakdown rows={summary.byPriority} />
            </section>
          </div>
        </div>
      </div>
    </>
  );
}
