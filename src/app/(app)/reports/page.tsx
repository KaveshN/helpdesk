import Link from 'next/link';
import { Download, LayoutGrid } from 'lucide-react';
import { requireSessionContext } from '@/lib/auth/session';
import { can } from '@/lib/authz/guard';
import { REPORT_CATALOGUE, reportParamsSchema, resolvePeriod } from '@/lib/reports/types';
import { runReport } from '@/lib/reports/runners';
import { NoPermission } from '@/components/no-permission';
import { ReportTable } from '@/components/report-table';
import { PageHeader } from '@/components/ui/page-header';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Reports' };

const PERIODS = [
  { value: 7, label: 'Last 7 days' },
  { value: 30, label: 'Last 30 days' },
  { value: 90, label: 'Last 90 days' },
  { value: 365, label: 'Last 12 months' },
];

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { actor, group } = await requireSessionContext();

  if (!can(actor, 'report:view', group.helpDeskGroupId)) {
    return (
      <NoPermission
        title="You do not have access to reports"
        detail={`Reporting in ${group.groupName} is available to agents and administrators.`}
      />
    );
  }

  const raw = await searchParams;
  const parsed = reportParamsSchema.safeParse({ type: 'TICKET_VOLUME', ...raw });
  const params = parsed.success ? parsed.data : reportParamsSchema.parse({ type: 'TICKET_VOLUME' });

  // A report the actor cannot see the underlying data for is not offered.
  const available = REPORT_CATALOGUE.filter(
    (entry) => !entry.requires || can(actor, entry.requires, group.helpDeskGroupId),
  );
  const selected = available.find((entry) => entry.type === params.type) ?? available[0]!;
  const effective = { ...params, type: selected.type };

  const report = await runReport(group, effective);
  const { from, to } = resolvePeriod(effective);

  const exportQuery = new URLSearchParams({
    type: effective.type,
    days: String(effective.days),
    ...(raw.from && typeof raw.from === 'string' ? { from: raw.from } : {}),
    ...(raw.to && typeof raw.to === 'string' ? { to: raw.to } : {}),
  });

  return (
    <>
      <PageHeader
        title="Reports"
        description={`${group.groupName} only — reports never merge data across help desks.`}
        actions={
          <>
            {can(actor, 'platform:view_all_dashboards') ? (
              <Link href="/reports/overview" className="btn-secondary">
                <LayoutGrid className="size-4" aria-hidden />
                All help desks
              </Link>
            ) : null}
            <a href={`/api/reports/export?${exportQuery.toString()}`} className="btn-primary">
              <Download className="size-4" aria-hidden />
              Download CSV
            </a>
          </>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[17rem_minmax(0,1fr)]">
        <nav
          className="scrollbar-thin -mx-1 flex gap-2 overflow-x-auto px-1 pb-2 lg:mx-0 lg:flex-col lg:gap-1 lg:overflow-visible lg:px-0 lg:pb-0"
          aria-label="Report catalogue"
        >
          {available.map((entry) => {
            const active = entry.type === selected.type;
            const query = new URLSearchParams({ type: entry.type, days: String(effective.days) });
            return (
              <Link
                key={entry.type}
                href={`/reports?${query.toString()}`}
                aria-current={active ? 'page' : undefined}
                className={`block rounded-md border px-3 py-2 text-sm ${
                  active
                    ? 'border-slate-900 bg-card text-white'
                    : ' bg-card text-foreground hover:bg-subtle'
                }`}
              >
                <span className="font-medium">{entry.title}</span>
                <span className={`mt-0.5 block text-xs ${active ? 'text-faint' : 'text-muted'}`}>
                  {entry.description}
                </span>
              </Link>
            );
          })}
        </nav>

        <div className="space-y-4">
          <form method="get" className="card flex flex-wrap items-end gap-3 p-4">
            <input type="hidden" name="type" value={selected.type} />
            <div>
              <label className="label" htmlFor="days">
                Period
              </label>
              <select id="days" name="days" defaultValue={String(effective.days)} className="input">
                {PERIODS.map((period) => (
                  <option key={period.value} value={period.value}>
                    {period.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="from">
                From (overrides period)
              </label>
              <input
                id="from"
                name="from"
                type="date"
                defaultValue={typeof raw.from === 'string' ? raw.from : ''}
                className="input"
              />
            </div>
            <div>
              <label className="label" htmlFor="to">
                To
              </label>
              <input
                id="to"
                name="to"
                type="date"
                defaultValue={typeof raw.to === 'string' ? raw.to : ''}
                className="input"
              />
            </div>
            <button type="submit" className="btn-primary">
              Run report
            </button>
          </form>

          <section>
            <h2 className="text-base font-semibold">{report.title}</h2>
            <p className="mt-1 mb-3 text-sm text-muted">{report.description}</p>
            <ReportTable report={report} />
          </section>

          {can(actor, 'report:manage', group.helpDeskGroupId) ? (
            <p className="text-xs text-muted">
              Scheduled delivery of these reports by email is Phase 4&rsquo;s remaining piece: the
              <code className="mx-1">ScheduledReport</code> and{' '}
              <code className="mx-1">ReportRun</code>
              tables exist, and the job runner arrives with the Phase 2 mail transport. Period
              start/end is {from.toISOString().slice(0, 10)} to {to.toISOString().slice(0, 10)}.
            </p>
          ) : null}
        </div>
      </div>
    </>
  );
}
