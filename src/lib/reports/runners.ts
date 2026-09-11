import { ChangeStatus, ReportType, StatusCategory } from '@/generated/prisma/enums';
import { scopedDb, type ScopedDb } from '@/lib/db/scoped';
import type { GroupContext } from '@/lib/authz/actor';
import { buildCalendar, type BusinessCalendar } from '@/lib/sla/calendar';
import { computeSla, selectPolicy, summariseAttainment } from '@/lib/sla/attainment';
import { OPEN_CHANGE_STATUSES } from '@/lib/changes/lifecycle';
import { resolvePeriod, type ReportParams, type ReportResult } from '@/lib/reports/types';

/**
 * Report runners. Each takes the group-scoped client and returns the uniform
 * ReportResult, so tenancy is enforced by the same extension that guards every
 * other read -- a report is not an exemption from group isolation.
 */

const OPEN_CATEGORIES: StatusCategory[] = [
  StatusCategory.NEW,
  StatusCategory.OPEN,
  StatusCategory.PENDING,
  StatusCategory.ON_HOLD,
];

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Explicitly typed as ChangeStatus[]: an inline array literal infers a narrow
 * tuple, and `.includes(someStatus)` then fails to compile.
 */
const IMPLEMENTED_CHANGE_STATUSES: ChangeStatus[] = [
  ChangeStatus.COMPLETED,
  ChangeStatus.FAILED,
  ChangeStatus.ROLLED_BACK,
];

const APPROVED_ONWARD_STATUSES: ChangeStatus[] = [
  ChangeStatus.APPROVED,
  ChangeStatus.SCHEDULED,
  ChangeStatus.IN_PROGRESS,
  ChangeStatus.COMPLETED,
];

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function round(value: number, places = 1): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

/** Percentage, or null when the denominator is zero -- never a misleading 0%. */
function pct(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : round((numerator / denominator) * 100);
}

// ---------------------------------------------------------------------------

async function ticketVolume(
  scoped: ScopedDb,
  group: GroupContext,
  params: ReportParams,
): Promise<ReportResult> {
  const { from, to } = resolvePeriod(params);

  const [created, resolved] = await Promise.all([
    scoped.ticket.findMany({
      where: { createdAt: { gte: from, lte: to } },
      select: { createdAt: true },
    }),
    scoped.ticket.findMany({
      where: { resolvedAt: { gte: from, lte: to } },
      select: { resolvedAt: true },
    }),
  ]);

  const createdByDay = new Map<string, number>();
  for (const ticket of created) {
    const key = dayKey(ticket.createdAt);
    createdByDay.set(key, (createdByDay.get(key) ?? 0) + 1);
  }
  const resolvedByDay = new Map<string, number>();
  for (const ticket of resolved) {
    if (!ticket.resolvedAt) continue;
    const key = dayKey(ticket.resolvedAt);
    resolvedByDay.set(key, (resolvedByDay.get(key) ?? 0) + 1);
  }

  const rows: ReportResult['rows'] = [];
  let backlogDelta = 0;
  for (
    let cursor = new Date(dayKey(from));
    cursor <= to;
    cursor = new Date(cursor.getTime() + DAY_MS)
  ) {
    const key = dayKey(cursor);
    const raised = createdByDay.get(key) ?? 0;
    const closed = resolvedByDay.get(key) ?? 0;
    backlogDelta += raised - closed;
    rows.push({ day: key, raised, resolved: closed, netBacklogChange: backlogDelta });
  }

  return {
    type: ReportType.TICKET_VOLUME,
    title: 'Ticket volume',
    description: `Tickets raised and resolved per day in ${group.groupName}.`,
    generatedAt: new Date(),
    periodFrom: from,
    periodTo: to,
    columns: [
      { key: 'day', label: 'Day' },
      { key: 'raised', label: 'Raised', numeric: true },
      { key: 'resolved', label: 'Resolved', numeric: true },
      { key: 'netBacklogChange', label: 'Cumulative net', numeric: true },
    ],
    rows,
    totals: {
      day: 'Total',
      raised: created.length,
      resolved: resolved.length,
      netBacklogChange: created.length - resolved.length,
    },
  };
}

// ---------------------------------------------------------------------------

/** Load the group's calendars, indexed by id, plus its default. */
async function loadCalendars(scoped: ScopedDb, timeZone: string) {
  const calendars = await scoped.calendar.findMany({
    where: { isActive: true },
    include: { workingHours: true, holidays: true },
  });

  const byId = new Map<string, BusinessCalendar>();
  for (const calendar of calendars) {
    byId.set(
      calendar.id,
      buildCalendar({
        timeZone: calendar.timeZone,
        workingHours: calendar.workingHours,
        holidays: calendar.holidays,
      }),
    );
  }

  const defaultCalendar = calendars.find((calendar) => calendar.isDefault) ?? calendars[0] ?? null;

  return {
    byId,
    fallback: defaultCalendar
      ? byId.get(defaultCalendar.id)!
      : buildCalendar({ timeZone, workingHours: [], holidays: [] }),
  };
}

async function slaPerformance(
  scoped: ScopedDb,
  group: GroupContext,
  params: ReportParams,
): Promise<ReportResult> {
  const { from, to } = resolvePeriod(params);

  const [tickets, policies, targets, priorities, calendars] = await Promise.all([
    scoped.ticket.findMany({
      where: {
        createdAt: { gte: from, lte: to },
        ...(params.priorityId ? { priorityId: params.priorityId } : {}),
        ...(params.categoryId ? { categoryId: params.categoryId } : {}),
      },
      select: {
        createdAt: true,
        firstRespondedAt: true,
        resolvedAt: true,
        typeId: true,
        categoryId: true,
        priorityId: true,
      },
    }),
    scoped.slaPolicy.findMany({
      select: {
        id: true,
        matchOrder: true,
        isDefault: true,
        isActive: true,
        businessHoursOnly: true,
        ticketTypeId: true,
        categoryId: true,
        calendarId: true,
      },
    }),
    scoped.slaTarget.findMany({
      select: {
        slaPolicyId: true,
        priorityId: true,
        responseMinutes: true,
        resolutionMinutes: true,
        warningThresholdPct: true,
      },
    }),
    scoped.priority.findMany({ orderBy: { level: 'asc' } }),
    loadCalendars(scoped, 'UTC'),
  ]);

  const targetIndex = new Map(
    targets.map((target) => [`${target.slaPolicyId}:${target.priorityId}`, target]),
  );
  const calendarForPolicy = new Map(
    policies.map((policy) => [
      policy.id,
      policy.calendarId
        ? (calendars.byId.get(policy.calendarId) ?? calendars.fallback)
        : calendars.fallback,
    ]),
  );

  const now = new Date();
  const byPriority = new Map<string, ReturnType<typeof computeSla>[]>();
  let unmatched = 0;

  for (const ticket of tickets) {
    const policy = selectPolicy(policies, ticket);
    if (!policy) {
      unmatched += 1;
      continue;
    }
    const target = targetIndex.get(`${policy.id}:${ticket.priorityId}`);
    if (!target) {
      unmatched += 1;
      continue;
    }

    const outcome = computeSla(
      ticket,
      policy,
      target,
      calendarForPolicy.get(policy.id) ?? calendars.fallback,
      now,
    );
    const bucket = byPriority.get(ticket.priorityId) ?? [];
    bucket.push(outcome);
    byPriority.set(ticket.priorityId, bucket);
  }

  const rows = priorities.map((priority) => {
    const outcomes = byPriority.get(priority.id) ?? [];
    const summary = summariseAttainment(outcomes);
    return {
      priority: priority.name,
      tickets: outcomes.length,
      responseAttainment: summary.responseAttainmentPct,
      responseUndecided: summary.responseUndecided,
      resolutionAttainment: summary.resolutionAttainmentPct,
      resolutionUndecided: summary.resolutionUndecided,
      atRisk: summary.atRisk,
      breached: summary.breached,
    };
  });

  const all = [...byPriority.values()].flat();
  const overall = summariseAttainment(all);

  const notes = [
    'Elapsed time is measured in business hours against each ticket’s matched SLA policy and calendar.',
    'Open tickets still inside target are reported as undecided, not as met — counting them as met would flatter the figures.',
    'SLA due dates are computed live from current policy configuration; Phase 2 will persist them on the ticket.',
  ];
  if (unmatched > 0) {
    notes.push(
      `${unmatched} ticket(s) had no matching SLA policy or no target for their priority and are excluded.`,
    );
  }

  return {
    type: ReportType.SLA_PERFORMANCE,
    title: 'SLA performance',
    description: `First-response and resolution attainment by priority in ${group.groupName}.`,
    generatedAt: now,
    periodFrom: from,
    periodTo: to,
    columns: [
      { key: 'priority', label: 'Priority' },
      { key: 'tickets', label: 'Tickets', numeric: true },
      { key: 'responseAttainment', label: 'Response met', numeric: true, percent: true },
      { key: 'responseUndecided', label: 'Response open', numeric: true },
      { key: 'resolutionAttainment', label: 'Resolution met', numeric: true, percent: true },
      { key: 'resolutionUndecided', label: 'Resolution open', numeric: true },
      { key: 'atRisk', label: 'At risk', numeric: true },
      { key: 'breached', label: 'Breached', numeric: true },
    ],
    rows,
    totals: {
      priority: 'All priorities',
      tickets: all.length,
      responseAttainment: overall.responseAttainmentPct,
      responseUndecided: overall.responseUndecided,
      resolutionAttainment: overall.resolutionAttainmentPct,
      resolutionUndecided: overall.resolutionUndecided,
      atRisk: overall.atRisk,
      breached: overall.breached,
    },
    notes,
  };
}

// ---------------------------------------------------------------------------

async function agentPerformance(
  scoped: ScopedDb,
  group: GroupContext,
  params: ReportParams,
): Promise<ReportResult> {
  const { from, to } = resolvePeriod(params);

  const [tickets, members] = await Promise.all([
    scoped.ticket.findMany({
      where: {
        assigneeId: { not: null },
        OR: [{ createdAt: { gte: from, lte: to } }, { resolvedAt: { gte: from, lte: to } }],
      },
      select: {
        assigneeId: true,
        createdAt: true,
        firstRespondedAt: true,
        resolvedAt: true,
        reopenCount: true,
        status: { select: { category: true } },
      },
    }),
    scoped.helpDeskMembership.findMany({
      where: { isActive: true, role: { in: ['AGENT', 'HD_ADMIN'] } },
      include: { user: { select: { id: true, name: true } } },
      orderBy: { user: { name: 'asc' } },
    }),
  ]);

  const byAgent = new Map<string, typeof tickets>();
  for (const ticket of tickets) {
    if (!ticket.assigneeId) continue;
    const bucket = byAgent.get(ticket.assigneeId) ?? [];
    bucket.push(ticket);
    byAgent.set(ticket.assigneeId, bucket);
  }

  const rows = members.map((membership) => {
    const assigned = byAgent.get(membership.user.id) ?? [];
    const resolved = assigned.filter((ticket) => ticket.resolvedAt);
    const responded = assigned.filter((ticket) => ticket.firstRespondedAt);
    const reopened = assigned.filter((ticket) => ticket.reopenCount > 0);
    const open = assigned.filter((ticket) => OPEN_CATEGORIES.includes(ticket.status.category));

    // Wall-clock hours, not business hours: this is a handling-time indicator,
    // not an SLA measure. The SLA report is where business hours matter.
    const handlingHours = resolved.map(
      (ticket) => (ticket.resolvedAt!.getTime() - ticket.createdAt.getTime()) / 3_600_000,
    );
    const meanHandlingHours =
      handlingHours.length === 0
        ? null
        : round(handlingHours.reduce((sum, hours) => sum + hours, 0) / handlingHours.length);

    return {
      agent: membership.user.name,
      assigned: assigned.length,
      resolved: resolved.length,
      stillOpen: open.length,
      firstResponded: responded.length,
      reopenRate: pct(reopened.length, resolved.length),
      meanHandlingHours,
    };
  });

  return {
    type: ReportType.AGENT_PERFORMANCE,
    title: 'Agent performance',
    description: `Component metrics per agent in ${group.groupName}.`,
    generatedAt: new Date(),
    periodFrom: from,
    periodTo: to,
    columns: [
      { key: 'agent', label: 'Agent' },
      { key: 'assigned', label: 'Assigned', numeric: true },
      { key: 'resolved', label: 'Resolved', numeric: true },
      { key: 'stillOpen', label: 'Still open', numeric: true },
      { key: 'firstResponded', label: 'Responded', numeric: true },
      { key: 'reopenRate', label: 'Reopen rate', numeric: true, percent: true },
      { key: 'meanHandlingHours', label: 'Mean hours to resolve', numeric: true },
    ],
    rows,
    notes: [
      'Reported as separate components rather than a single score: composite scores get optimised for, and hide which input actually moved.',
      'Mean hours to resolve is wall-clock, not business hours — use the SLA report for attainment.',
      'Reopen rate is a proportion of that agent’s resolved tickets, so a small denominator moves it sharply.',
    ],
  };
}

// ---------------------------------------------------------------------------

async function ticketAgeing(
  scoped: ScopedDb,
  group: GroupContext,
  params: ReportParams,
): Promise<ReportResult> {
  const now = new Date();
  const { from, to } = resolvePeriod(params, now);

  const tickets = await scoped.ticket.findMany({
    where: { status: { category: { in: OPEN_CATEGORIES } } },
    select: { createdAt: true, priority: { select: { id: true, name: true, level: true } } },
  });

  const buckets = [
    { key: 'age0to1', label: '< 1 day', min: 0, max: 1 },
    { key: 'age1to3', label: '1–3 days', min: 1, max: 3 },
    { key: 'age3to7', label: '3–7 days', min: 3, max: 7 },
    { key: 'age7to30', label: '7–30 days', min: 7, max: 30 },
    { key: 'age30plus', label: '30+ days', min: 30, max: Number.POSITIVE_INFINITY },
  ];

  const byPriority = new Map<
    string,
    { name: string; level: number; counts: Record<string, number> }
  >();
  for (const ticket of tickets) {
    const ageDays = (now.getTime() - ticket.createdAt.getTime()) / DAY_MS;
    const bucket = buckets.find((candidate) => ageDays >= candidate.min && ageDays < candidate.max);
    if (!bucket) continue;

    const entry = byPriority.get(ticket.priority.id) ?? {
      name: ticket.priority.name,
      level: ticket.priority.level,
      counts: Object.fromEntries(buckets.map((candidate) => [candidate.key, 0])),
    };
    entry.counts[bucket.key] = (entry.counts[bucket.key] ?? 0) + 1;
    byPriority.set(ticket.priority.id, entry);
  }

  const rows: ReportResult['rows'] = [...byPriority.values()]
    .sort((a, b) => a.level - b.level)
    .map((entry) => ({
      priority: entry.name,
      ...entry.counts,
      total: Object.values(entry.counts).reduce((sum, count) => sum + count, 0),
    }));

  const totals: Record<string, number | string> = { priority: 'All open' };
  // Bucket keys are dynamic, hence the indexed access on a ReportCell row.
  for (const bucket of buckets) {
    totals[bucket.key] = rows.reduce((sum, row) => sum + Number(row[bucket.key] ?? 0), 0);
  }
  totals.total = tickets.length;

  return {
    type: ReportType.TICKET_AGEING,
    title: 'Ticket ageing',
    description: `Open tickets in ${group.groupName} bucketed by age.`,
    generatedAt: now,
    periodFrom: from,
    periodTo: to,
    columns: [
      { key: 'priority', label: 'Priority' },
      ...buckets.map((bucket) => ({ key: bucket.key, label: bucket.label, numeric: true })),
      { key: 'total', label: 'Total', numeric: true },
    ],
    rows,
    totals,
    notes: [
      'Ageing is a snapshot as at generation time and ignores the reporting period — an old ticket is old regardless of the window.',
    ],
  };
}

// ---------------------------------------------------------------------------

async function trendAnalysis(
  scoped: ScopedDb,
  group: GroupContext,
  params: ReportParams,
): Promise<ReportResult> {
  const { from, to } = resolvePeriod(params);

  const tickets = await scoped.ticket.findMany({
    where: { createdAt: { gte: from, lte: to } },
    select: { createdAt: true, resolvedAt: true, reopenCount: true },
  });

  /** ISO week start (Monday) for grouping. */
  const weekStart = (date: Date): string => {
    const copy = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    const day = copy.getUTCDay();
    copy.setUTCDate(copy.getUTCDate() - ((day + 6) % 7));
    return copy.toISOString().slice(0, 10);
  };

  const byWeek = new Map<
    string,
    { raised: number; resolved: number; hours: number[]; reopened: number }
  >();
  for (const ticket of tickets) {
    const key = weekStart(ticket.createdAt);
    const entry = byWeek.get(key) ?? { raised: 0, resolved: 0, hours: [], reopened: 0 };
    entry.raised += 1;
    if (ticket.resolvedAt) {
      entry.resolved += 1;
      entry.hours.push((ticket.resolvedAt.getTime() - ticket.createdAt.getTime()) / 3_600_000);
    }
    if (ticket.reopenCount > 0) entry.reopened += 1;
    byWeek.set(key, entry);
  }

  const rows = [...byWeek.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([week, entry]) => ({
      week,
      raised: entry.raised,
      resolved: entry.resolved,
      resolutionRate: pct(entry.resolved, entry.raised),
      meanHoursToResolve:
        entry.hours.length === 0
          ? null
          : round(entry.hours.reduce((sum, hours) => sum + hours, 0) / entry.hours.length),
      reopened: entry.reopened,
    }));

  return {
    type: ReportType.TREND_ANALYSIS,
    title: 'Trend analysis',
    description: `Week-on-week movement in ${group.groupName}.`,
    generatedAt: new Date(),
    periodFrom: from,
    periodTo: to,
    columns: [
      { key: 'week', label: 'Week beginning' },
      { key: 'raised', label: 'Raised', numeric: true },
      { key: 'resolved', label: 'Resolved', numeric: true },
      { key: 'resolutionRate', label: 'Resolved in period', numeric: true, percent: true },
      { key: 'meanHoursToResolve', label: 'Mean hours to resolve', numeric: true },
      { key: 'reopened', label: 'Reopened', numeric: true },
    ],
    rows,
    notes: [
      'Tickets are grouped by the week they were raised, so a recent week’s resolution rate rises as its tickets are worked.',
    ],
  };
}

// ---------------------------------------------------------------------------

async function changeSummary(
  scoped: ScopedDb,
  group: GroupContext,
  params: ReportParams,
): Promise<ReportResult> {
  const { from, to } = resolvePeriod(params);

  const [changes, riskLevels] = await Promise.all([
    scoped.changeRequest.findMany({
      where: { createdAt: { gte: from, lte: to } },
      select: {
        status: true,
        submittedAt: true,
        decidedAt: true,
        riskLevelId: true,
        riskLevel: { select: { id: true, name: true, level: true } },
      },
    }),
    scoped.changeRiskLevel.findMany({ orderBy: { level: 'asc' } }),
  ]);

  const rows = riskLevels.map((risk) => {
    const inRisk = changes.filter((change) => change.riskLevelId === risk.id);
    const decided = inRisk.filter((change) => change.submittedAt && change.decidedAt);
    const turnaroundHours = decided.map(
      (change) => (change.decidedAt!.getTime() - change.submittedAt!.getTime()) / 3_600_000,
    );
    const implemented = inRisk.filter((change) =>
      IMPLEMENTED_CHANGE_STATUSES.includes(change.status),
    );
    const succeeded = inRisk.filter((change) => change.status === ChangeStatus.COMPLETED);

    return {
      risk: risk.name,
      total: inRisk.length,
      inFlight: inRisk.filter((change) => OPEN_CHANGE_STATUSES.includes(change.status)).length,
      approved: inRisk.filter((change) => APPROVED_ONWARD_STATUSES.includes(change.status)).length,
      rejected: inRisk.filter((change) => change.status === ChangeStatus.REJECTED).length,
      completed: succeeded.length,
      failedOrRolledBack: implemented.length - succeeded.length,
      successRate: pct(succeeded.length, implemented.length),
      meanApprovalHours:
        turnaroundHours.length === 0
          ? null
          : round(turnaroundHours.reduce((sum, hours) => sum + hours, 0) / turnaroundHours.length),
    };
  });

  const implementedAll = changes.filter((change) =>
    IMPLEMENTED_CHANGE_STATUSES.includes(change.status),
  );
  const succeededAll = changes.filter((change) => change.status === ChangeStatus.COMPLETED);

  return {
    type: ReportType.CHANGE_SUMMARY,
    title: 'Change summary',
    description: `Change requests in ${group.groupName} by risk level.`,
    generatedAt: new Date(),
    periodFrom: from,
    periodTo: to,
    columns: [
      { key: 'risk', label: 'Risk level' },
      { key: 'total', label: 'Raised', numeric: true },
      { key: 'inFlight', label: 'In flight', numeric: true },
      { key: 'approved', label: 'Approved', numeric: true },
      { key: 'rejected', label: 'Rejected', numeric: true },
      { key: 'completed', label: 'Completed', numeric: true },
      { key: 'failedOrRolledBack', label: 'Failed / rolled back', numeric: true },
      { key: 'successRate', label: 'Success rate', numeric: true, percent: true },
      { key: 'meanApprovalHours', label: 'Mean hours to decide', numeric: true },
    ],
    rows,
    totals: {
      risk: 'All risk levels',
      total: changes.length,
      completed: succeededAll.length,
      failedOrRolledBack: implementedAll.length - succeededAll.length,
      successRate: pct(succeededAll.length, implementedAll.length),
    },
    notes: [
      'Success rate counts only changes that reached implementation; approved-but-not-yet-implemented changes are excluded.',
      'Mean hours to decide is wall-clock between submission and the CAB’s decision.',
    ],
  };
}

// ---------------------------------------------------------------------------

async function csat(
  scoped: ScopedDb,
  group: GroupContext,
  params: ReportParams,
): Promise<ReportResult> {
  const { from, to } = resolvePeriod(params);

  const responses = await scoped.csatResponse.findMany({
    where: { createdAt: { gte: from, lte: to } },
    select: { rating: true, ticket: { select: { assignee: { select: { name: true } } } } },
  });

  const byAgent = new Map<string, number[]>();
  for (const response of responses) {
    const name = response.ticket.assignee?.name ?? 'Unassigned';
    byAgent.set(name, [...(byAgent.get(name) ?? []), response.rating]);
  }

  const rows = [...byAgent.entries()].map(([agent, ratings]) => ({
    agent,
    responses: ratings.length,
    meanRating: round(ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length, 2),
    promoters: ratings.filter((rating) => rating >= 4).length,
    detractors: ratings.filter((rating) => rating <= 2).length,
  }));

  return {
    type: ReportType.CSAT,
    title: 'Customer satisfaction',
    description: `CSAT responses in ${group.groupName}.`,
    generatedAt: new Date(),
    periodFrom: from,
    periodTo: to,
    columns: [
      { key: 'agent', label: 'Agent' },
      { key: 'responses', label: 'Responses', numeric: true },
      { key: 'meanRating', label: 'Mean rating', numeric: true },
      { key: 'promoters', label: 'Rated 4–5', numeric: true },
      { key: 'detractors', label: 'Rated 1–2', numeric: true },
    ],
    rows,
    notes:
      responses.length === 0
        ? ['No CSAT responses recorded. The survey is part of Phase 7 and is not yet enabled.']
        : undefined,
  };
}

// ---------------------------------------------------------------------------

const RUNNERS: Record<
  ReportType,
  (scoped: ScopedDb, group: GroupContext, params: ReportParams) => Promise<ReportResult>
> = {
  [ReportType.TICKET_VOLUME]: ticketVolume,
  [ReportType.SLA_PERFORMANCE]: slaPerformance,
  [ReportType.AGENT_PERFORMANCE]: agentPerformance,
  [ReportType.TICKET_AGEING]: ticketAgeing,
  [ReportType.TREND_ANALYSIS]: trendAnalysis,
  [ReportType.CHANGE_SUMMARY]: changeSummary,
  [ReportType.CSAT]: csat,
};

/** Run one report for the active group. */
export async function runReport(group: GroupContext, params: ReportParams): Promise<ReportResult> {
  const scoped = scopedDb(group.helpDeskGroupId);
  return RUNNERS[params.type](scoped, group, params);
}
