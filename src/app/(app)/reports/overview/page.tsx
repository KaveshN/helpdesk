import Link from 'next/link';
import { getAccessibleGroups, requireActor } from '@/lib/auth/session';
import { db } from '@/lib/db/client';
import { can } from '@/lib/authz/guard';
import { summariseGroup, type GroupOverview } from '@/lib/reports/overview';
import { NoPermission } from '@/components/no-permission';
import { TONE_TEXT, type Tone } from '@/lib/design/tones';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'All help desks' };

function Metric({
  label,
  value,
  tone = 'neutral',
  suffix,
}: {
  label: string;
  value: number | null;
  tone?: Tone;
  suffix?: string;
}) {

  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${TONE_TEXT[tone]}`}>
        {value === null ? <span className="text-faint">—</span> : `${value}${suffix ?? ''}`}
      </div>
    </div>
  );
}

function GroupPanel({ overview }: { overview: GroupOverview }) {
  return (
    <section className="card p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold">
          {overview.groupName}
          <span className="ml-2 font-mono text-xs font-normal text-muted-foreground">{overview.groupKey}</span>
        </h2>
        <span className="text-xs text-muted-foreground">{overview.timeZone}</span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4 2xl:grid-cols-4">
        <Metric label="Open tickets" value={overview.openTickets} />
        <Metric
          label="Unassigned"
          value={overview.unassignedTickets}
          tone={overview.unassignedTickets > 0 ? 'warning' : 'neutral'}
        />
        <Metric label="Resolved (30d)" value={overview.resolvedLast30} tone="success" />
        <Metric
          label="SLA breached"
          value={overview.slaBreached}
          tone={overview.slaBreached > 0 ? 'destructive' : 'neutral'}
        />
        <Metric
          label="Response met"
          value={
            overview.responseAttainmentPct === null
              ? null
              : Math.round(overview.responseAttainmentPct)
          }
          suffix="%"
        />
        <Metric
          label="Resolution met"
          value={
            overview.resolutionAttainmentPct === null
              ? null
              : Math.round(overview.resolutionAttainmentPct)
          }
          suffix="%"
        />
        <Metric label="Changes in flight" value={overview.changesInFlight} />
        <Metric
          label="Awaiting CAB"
          value={overview.changesAwaitingApproval}
          tone={overview.changesAwaitingApproval > 0 ? 'warning' : 'neutral'}
        />
      </div>
    </section>
  );
}

export default async function OverviewPage() {
  const actor = await requireActor();

  if (!can(actor, 'platform:view_all_dashboards')) {
    return (
      <NoPermission
        title="The cross-help-desk view is for Super Administrators"
        detail="Your own help desk's reports are under Reports."
        backHref="/reports"
        backLabel="Back to reports"
      />
    );
  }

  const accessible = await getAccessibleGroups();
  const groups = await db().helpDeskGroup.findMany({
    where: { id: { in: accessible.map((group) => group.id) } },
    select: { id: true, key: true, name: true, timeZone: true, observerScope: true },
    orderBy: { name: 'asc' },
  });

  // Summarised one group at a time, each through its own scoped client.
  const overviews = await Promise.all(
    groups.map((group) =>
      summariseGroup({
        helpDeskGroupId: group.id,
        groupKey: group.key,
        groupName: group.name,
        role: null,
        observerScope: group.observerScope,
        timeZone: group.timeZone,
      }),
    ),
  );

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">All help desks</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {groups.length} help desk{groups.length === 1 ? '' : 's'}, each summarised separately.
          </p>
        </div>
        <Link href="/reports" className="btn-secondary">
          Single help desk reports
        </Link>
      </header>

      <p className="rounded-md border bg-muted px-4 py-3 text-xs text-muted-foreground">
        There is deliberately no platform-wide total. Adding one group&rsquo;s SLA attainment to
        another&rsquo;s produces a figure that describes neither &mdash; each help desk has its own
        calendar, priorities and targets. Compare the panels; do not sum them.
      </p>

      <div className="grid gap-4 2xl:grid-cols-2">
        {overviews.map((overview) => (
          <GroupPanel key={overview.helpDeskGroupId} overview={overview} />
        ))}
      </div>
    </div>
  );
}
