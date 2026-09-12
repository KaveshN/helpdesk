import Link from 'next/link';
import { Plus, Search, Vote } from 'lucide-react';
import { requireSessionContext } from '@/lib/auth/session';
import { changeFilterSchema } from '@/lib/changes/schemas';
import { changeFormOptions, listChanges, pendingApprovalCount } from '@/lib/changes/service';
import { can } from '@/lib/authz/guard';
import { NoPermission } from '@/components/no-permission';
import { EmptyState } from '@/components/ui/empty-state';
import { Pill } from '@/components/ui/pill';
import { PageHeader } from '@/components/ui/page-header';
import { FilterTabs } from '@/components/ui/filter-tabs';
import { Pagination } from '@/components/ui/pagination';
import { ChangeStatusBadge } from '@/components/change-status-badge';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Change requests' };

const VIEWS = [
  { value: 'open', label: 'In flight' },
  { value: 'awaiting_my_approval', label: 'Awaiting my approval' },
  { value: 'mine', label: 'Mine' },
  { value: 'scheduled', label: 'Approved / scheduled' },
  { value: 'completed', label: 'Completed' },
  { value: 'all', label: 'All' },
];

function formatDate(value: Date | null): string {
  return value ? value.toISOString().slice(0, 10) : '—';
}

export default async function ChangesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { actor, group } = await requireSessionContext();

  if (!can(actor, 'change:read', group.helpDeskGroupId)) {
    return (
      <NoPermission
        title="You do not have access to change management"
        detail={`Your role in ${group.groupName} does not include the change module.`}
      />
    );
  }

  const raw = await searchParams;
  const parsed = changeFilterSchema.safeParse(raw);
  const filter = parsed.success ? parsed.data : changeFilterSchema.parse({});

  const [{ items, total, page, pageSize }, options, awaitingMe] = await Promise.all([
    listChanges(actor, group, filter),
    changeFormOptions(group),
    pendingApprovalCount(actor, group),
  ]);

  const base = {
    view: filter.view,
    q: filter.q,
    riskLevelId: filter.riskLevelId,
    changeTypeId: filter.changeTypeId,
  };

  return (
    <>
      <PageHeader
        title="Change requests"
        description={`${total} change${total === 1 ? '' : 's'} in ${group.groupName} · own numbering, own approvals, separate from tickets`}
        actions={
          can(actor, 'change:create', group.helpDeskGroupId) ? (
            <Link href="/changes/new" className="btn-primary">
              <Plus className="size-4" aria-hidden />
              Raise a change
            </Link>
          ) : null
        }
      />

      <div className="space-y-4">
        {awaitingMe > 0 ? (
          <div
            className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border px-4 py-3"
            style={{
              background: 'var(--warning-subtle)',
              borderColor: 'color-mix(in oklch, var(--warning) 30%, transparent)',
              color: 'var(--warning)',
            }}
          >
            <Vote className="size-4 shrink-0" aria-hidden />
            <strong className="tabular">{awaitingMe}</strong>
            <span>change{awaitingMe === 1 ? '' : 's'} awaiting your CAB decision.</span>
            <Link href="/changes?view=awaiting_my_approval" className="link">
              Review them
            </Link>
          </div>
        ) : null}

        <FilterTabs
          basePath="/changes"
          params={base}
          paramName="view"
          current={filter.view}
          options={VIEWS}
        />

        <form method="get" className="card grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-4">
          <input type="hidden" name="view" value={filter.view} />
          <div className="sm:col-span-2 lg:col-span-1">
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
                placeholder="Reference or title"
                className="input pl-9"
              />
            </div>
          </div>
          <select
            name="riskLevelId"
            defaultValue={filter.riskLevelId ?? ''}
            className="select"
            aria-label="Risk level"
          >
            <option value="">Any risk level</option>
            {options.riskLevels.map((risk) => (
              <option key={risk.id} value={risk.id}>
                {risk.name}
              </option>
            ))}
          </select>
          <select
            name="changeTypeId"
            defaultValue={filter.changeTypeId ?? ''}
            className="select"
            aria-label="Change type"
          >
            <option value="">Any type</option>
            {options.types.map((type) => (
              <option key={type.id} value={type.id}>
                {type.name}
              </option>
            ))}
          </select>
          <div className="flex gap-2">
            <button type="submit" className="btn-primary flex-1">
              Filter
            </button>
            <Link href="/changes" className="btn-secondary">
              Reset
            </Link>
          </div>
        </form>

        <section className="card overflow-hidden">
          {items.length === 0 ? (
            <EmptyState
              title="No change requests in this view"
              hint="Raise one, or switch to a different view."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Reference</th>
                    <th>Title</th>
                    <th className="hidden sm:table-cell">Status</th>
                    <th className="hidden md:table-cell">Risk</th>
                    <th className="hidden xl:table-cell">Type</th>
                    <th className="hidden 2xl:table-cell">CAB</th>
                    <th className="hidden lg:table-cell">Planned start</th>
                    <th className="hidden 2xl:table-cell">Requester</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((change) => (
                    <tr key={change.id}>
                      <td>
                        <Link
                          href={`/changes/${change.id}`}
                          className="link font-mono text-xs whitespace-nowrap"
                        >
                          {change.reference}
                        </Link>
                      </td>
                      <td className="max-w-[24rem] truncate" title={change.title}>
                        {change.title}
                        <span className="mt-1 flex flex-wrap gap-1.5 sm:hidden">
                          <ChangeStatusBadge status={change.status} />
                          <Pill label={change.riskLevel.name} colour={change.riskLevel.colour} />
                        </span>
                      </td>
                      <td className="hidden sm:table-cell">
                        <ChangeStatusBadge status={change.status} />
                      </td>
                      <td className="hidden md:table-cell">
                        <Pill label={change.riskLevel.name} colour={change.riskLevel.colour} />
                      </td>
                      <td className="hidden text-muted-foreground xl:table-cell">
                        {change.changeType.name}
                        {change.changeType.isPreApproved ? (
                          <span className="ml-1 text-xs text-success">pre-approved</span>
                        ) : null}
                      </td>
                      <td className="hidden text-muted-foreground 2xl:table-cell">
                        {change.cab?.name ?? '—'}
                      </td>
                      <td className="hidden whitespace-nowrap text-faint lg:table-cell">
                        {formatDate(change.plannedStartAt)}
                      </td>
                      <td className="hidden text-muted-foreground 2xl:table-cell">
                        {change.requester.name}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <Pagination
          basePath="/changes"
          params={base}
          page={page}
          pageSize={pageSize}
          total={total}
        />
      </div>
    </>
  );
}
