import Link from 'next/link';
import { Plus, Search } from 'lucide-react';
import { requireSessionContext } from '@/lib/auth/session';
import { listTickets, ticketFormOptions } from '@/lib/tickets/service';
import { ticketFilterSchema } from '@/lib/tickets/schemas';
import { can } from '@/lib/authz/guard';
import { Pill } from '@/components/ui/pill';
import { resolveRequester } from '@/lib/tickets/requester';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { FilterTabs } from '@/components/ui/filter-tabs';
import { Pagination } from '@/components/ui/pagination';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Tickets' };

const VIEWS = [
  { value: 'all', label: 'All' },
  { value: 'open', label: 'Open' },
  { value: 'assigned_to_me', label: 'Assigned to me' },
  { value: 'unassigned', label: 'Unassigned' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'watching', label: 'Watching' },
];

function formatDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export default async function TicketsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { actor, group } = await requireSessionContext();
  const raw = await searchParams;

  // Unparseable query strings fall back to defaults rather than erroring: a
  // stale bookmark should still show a ticket list.
  const parsed = ticketFilterSchema.safeParse(raw);
  const filter = parsed.success ? parsed.data : ticketFilterSchema.parse({});

  const [{ items, total, page, pageSize }, options] = await Promise.all([
    listTickets(actor, group, filter),
    ticketFormOptions(group),
  ]);

  const canCreate = can(actor, 'ticket:create', group.helpDeskGroupId);
  const base = {
    view: filter.view,
    q: filter.q,
    statusId: filter.statusId,
    priorityId: filter.priorityId,
    categoryId: filter.categoryId,
    assigneeId: filter.assigneeId,
  };

  return (
    <>
      <PageHeader
        title="Tickets"
        description={`${total} ticket${total === 1 ? '' : 's'} in ${group.groupName}`}
        actions={
          canCreate ? (
            <Link href="/tickets/new" className="btn-primary">
              <Plus className="size-4" aria-hidden />
              New ticket
            </Link>
          ) : null
        }
      />

      <div className="space-y-4">
        <FilterTabs
          basePath="/tickets"
          params={base}
          paramName="view"
          current={filter.view}
          options={VIEWS}
        />

        {/* Filters live in the URL, so a filtered list is shareable. */}
        <form
          method="get"
          className="card grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6"
        >
          <input type="hidden" name="view" value={filter.view} />
          <div className="sm:col-span-2 xl:col-span-2">
            <label className="sr-only" htmlFor="q">
              Search
            </label>
            <div className="relative">
              <Search
                className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint"
                aria-hidden
              />
              <input
                id="q"
                name="q"
                defaultValue={filter.q ?? ''}
                placeholder="Reference or subject"
                className="input pl-9"
              />
            </div>
          </div>
          <select
            name="statusId"
            defaultValue={filter.statusId ?? ''}
            className="select"
            aria-label="Status"
          >
            <option value="">Any status</option>
            {options.statuses.map((status) => (
              <option key={status.id} value={status.id}>
                {status.name}
              </option>
            ))}
          </select>
          <select
            name="priorityId"
            defaultValue={filter.priorityId ?? ''}
            className="select"
            aria-label="Priority"
          >
            <option value="">Any priority</option>
            {options.priorities.map((priority) => (
              <option key={priority.id} value={priority.id}>
                {priority.name}
              </option>
            ))}
          </select>
          <select
            name="categoryId"
            defaultValue={filter.categoryId ?? ''}
            className="select"
            aria-label="Category"
          >
            <option value="">Any category</option>
            {options.categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
          <div className="flex gap-2">
            <button type="submit" className="btn-primary flex-1">
              Filter
            </button>
            <Link href="/tickets" className="btn-secondary">
              Reset
            </Link>
          </div>
        </form>

        <section className="card overflow-hidden">
          {items.length === 0 ? (
            <EmptyState
              title="Nothing matches this view"
              hint="Try a different view or clear the filters."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Reference</th>
                    <th>Subject</th>
                    <th className="hidden xl:table-cell">Type</th>
                    <th className="hidden sm:table-cell">Status</th>
                    <th className="hidden md:table-cell">Priority</th>
                    <th className="hidden 2xl:table-cell">Requester</th>
                    <th className="hidden lg:table-cell">Assignee</th>
                    <th className="hidden xl:table-cell">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((ticket) => (
                    <tr key={ticket.id}>
                      <td>
                        <Link
                          href={`/tickets/${ticket.id}`}
                          className="link font-mono text-xs whitespace-nowrap"
                        >
                          {ticket.reference}
                        </Link>
                      </td>
                      <td className="max-w-[22rem] truncate" title={ticket.subject}>
                        {ticket.subject}
                        {/* Low-priority columns collapse into the subject on narrow screens. */}
                        <span className="mt-1 flex gap-1.5 sm:hidden">
                          <Pill label={ticket.status.name} colour={ticket.status.colour} />
                          <Pill label={ticket.priority.name} colour={ticket.priority.colour} />
                        </span>
                      </td>
                      <td className="hidden text-muted-foreground xl:table-cell">
                        {ticket.type.name}
                      </td>
                      <td className="hidden sm:table-cell">
                        <Pill label={ticket.status.name} colour={ticket.status.colour} />
                      </td>
                      <td className="hidden md:table-cell">
                        <Pill label={ticket.priority.name} colour={ticket.priority.colour} />
                      </td>
                      <td className="hidden text-muted-foreground 2xl:table-cell">
                        {(() => {
                          const requester = resolveRequester(ticket);
                          return (
                            <>
                              {requester.name}
                              {requester.isExternal ? (
                                <span className="ml-1 text-xs text-faint">external</span>
                              ) : null}
                            </>
                          );
                        })()}
                      </td>
                      <td className="hidden text-muted-foreground lg:table-cell">
                        {ticket.assignee?.name ?? (
                          <span style={{ color: 'var(--warning)' }}>Unassigned</span>
                        )}
                      </td>
                      <td className="hidden whitespace-nowrap text-faint xl:table-cell">
                        {formatDate(ticket.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <Pagination
          basePath="/tickets"
          params={base}
          page={page}
          pageSize={pageSize}
          total={total}
        />
      </div>
    </>
  );
}
