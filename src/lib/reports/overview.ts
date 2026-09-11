import { ChangeStatus, ReportType, StatusCategory } from '@/generated/prisma/enums';
import { scopedDb } from '@/lib/db/scoped';
import type { GroupContext } from '@/lib/authz/actor';
import { OPEN_CHANGE_STATUSES } from '@/lib/changes/lifecycle';
import { runReport } from '@/lib/reports/runners';
import { reportParamsSchema } from '@/lib/reports/types';

/**
 * Multi-help-desk overview (brief §7 Phase 4: "per-group views, not merged").
 *
 * Each group is summarised independently and returned as its own panel. There
 * is deliberately no platform-wide total: adding IT Help Desk's SLA attainment
 * to Kenya's would produce a number that describes neither, and would quietly
 * undo the tenancy model everywhere else in the product.
 */

export type GroupOverview = {
  helpDeskGroupId: string;
  groupKey: string;
  groupName: string;
  timeZone: string;
  openTickets: number;
  unassignedTickets: number;
  resolvedLast30: number;
  changesInFlight: number;
  changesAwaitingApproval: number;
  /** Null when no ticket in the window has a decided SLA outcome. */
  responseAttainmentPct: number | null;
  resolutionAttainmentPct: number | null;
  slaBreached: number;
};

const OPEN_CATEGORIES: StatusCategory[] = [
  StatusCategory.NEW,
  StatusCategory.OPEN,
  StatusCategory.PENDING,
  StatusCategory.ON_HOLD,
];

export async function summariseGroup(
  group: GroupContext & { timeZone: string },
): Promise<GroupOverview> {
  const scoped = scopedDb(group.helpDeskGroupId);
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [openTickets, unassignedTickets, resolvedLast30, changesInFlight, changesAwaiting, sla] =
    await Promise.all([
      scoped.ticket.count({ where: { status: { category: { in: OPEN_CATEGORIES } } } }),
      scoped.ticket.count({
        where: { assigneeId: null, status: { category: { in: OPEN_CATEGORIES } } },
      }),
      scoped.ticket.count({ where: { resolvedAt: { gte: since } } }),
      scoped.changeRequest.count({ where: { status: { in: [...OPEN_CHANGE_STATUSES] } } }),
      scoped.changeRequest.count({ where: { status: ChangeStatus.PENDING_APPROVAL } }),
      runReport(group, reportParamsSchema.parse({ type: ReportType.SLA_PERFORMANCE, days: 30 })),
    ]);

  const totals = sla.totals ?? {};

  return {
    helpDeskGroupId: group.helpDeskGroupId,
    groupKey: group.groupKey,
    groupName: group.groupName,
    timeZone: group.timeZone,
    openTickets,
    unassignedTickets,
    resolvedLast30,
    changesInFlight,
    changesAwaitingApproval: changesAwaiting,
    responseAttainmentPct:
      typeof totals.responseAttainment === 'number' ? totals.responseAttainment : null,
    resolutionAttainmentPct:
      typeof totals.resolutionAttainment === 'number' ? totals.resolutionAttainment : null,
    slaBreached: typeof totals.breached === 'number' ? totals.breached : 0,
  };
}
