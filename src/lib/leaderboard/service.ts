import { StatusCategory } from '@/generated/prisma/enums';
import { db } from '@/lib/db/client';
import { scopedDb } from '@/lib/db/scoped';
import type { Actor, GroupContext } from '@/lib/authz/actor';
import { can } from '@/lib/authz/guard';
import { buildCalendar } from '@/lib/sla/calendar';
import { computeSla, selectPolicy } from '@/lib/sla/attainment';
import {
  buildLeaderboard,
  periodBounds,
  type AgentStats,
  type ScoredAgent,
  type ScoreWeights,
} from '@/lib/leaderboard/score';

/**
 * Gathers the per-agent statistics the leaderboard scores.
 *
 * SLA attainment is computed with the same calculator the reports use, so the
 * number on the leaderboard and the number on the SLA report agree. Two
 * implementations that disagree is how a leaderboard loses credibility.
 */

export const DEFAULT_WEIGHTS: ScoreWeights = {
  weightResolved: 10,
  weightResponseSla: 0.4,
  weightResolutionSla: 0.6,
  weightCsat: 8,
  weightReopen: -15,
  minimumTicketsToRank: 3,
};

export type LeaderboardView = {
  enabled: boolean;
  visible: boolean;
  periodLabel: string;
  from: Date;
  to: Date;
  rows: ScoredAgent[];
  weights: ScoreWeights;
  /** The viewer's own row, so they can find themselves without scanning. */
  me: ScoredAgent | null;
};

export async function getLeaderboard(
  actor: Actor,
  group: GroupContext,
  now = new Date(),
): Promise<LeaderboardView | null> {
  const helpDeskGroupId = group.helpDeskGroupId;
  const scoped = scopedDb(helpDeskGroupId);

  const config = await scoped.leaderboardConfig.findFirst({});
  const weights: ScoreWeights = config
    ? {
        weightResolved: config.weightResolved,
        weightResponseSla: config.weightResponseSla,
        weightResolutionSla: config.weightResolutionSla,
        weightCsat: config.weightCsat,
        weightReopen: config.weightReopen,
        minimumTicketsToRank: config.minimumTicketsToRank,
      }
    : DEFAULT_WEIGHTS;

  if (config && !config.isEnabled) return null;

  // When the board is manager-only, agents simply do not receive it.
  const managerView = can(actor, 'dashboard:view_group', helpDeskGroupId);
  const visible = config?.visibleToAgents !== false || managerView;
  if (!visible) return null;

  const { from, to, label } = periodBounds(config?.period ?? 'MONTH', now);

  const [members, tickets, csat, policies, targets, calendars, priorities] = await Promise.all([
    scoped.helpDeskMembership.findMany({
      where: { isActive: true, role: { in: ['AGENT', 'HD_ADMIN'] } },
      include: { user: { select: { id: true, name: true } } },
    }),
    scoped.ticket.findMany({
      where: { assigneeId: { not: null }, resolvedAt: { gte: from, lte: to } },
      select: {
        assigneeId: true,
        createdAt: true,
        firstRespondedAt: true,
        resolvedAt: true,
        reopenCount: true,
        typeId: true,
        categoryId: true,
        priorityId: true,
        priority: { select: { leaderboardWeight: true } },
      },
    }),
    scoped.csatResponse.findMany({
      where: { createdAt: { gte: from, lte: to } },
      select: { rating: true, ticket: { select: { assigneeId: true } } },
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
    scoped.calendar.findMany({
      where: { isActive: true },
      include: { workingHours: true, holidays: true },
    }),
    scoped.priority.findMany({ select: { id: true, leaderboardWeight: true } }),
  ]);

  const calendarById = new Map(
    calendars.map((calendar) => [
      calendar.id,
      buildCalendar({
        timeZone: calendar.timeZone,
        workingHours: calendar.workingHours,
        holidays: calendar.holidays,
      }),
    ]),
  );
  const fallbackCalendar =
    calendarById.get(calendars.find((calendar) => calendar.isDefault)?.id ?? '') ??
    [...calendarById.values()][0] ??
    buildCalendar({ timeZone: 'UTC', workingHours: [], holidays: [] });

  const targetIndex = new Map(
    targets.map((target) => [`${target.slaPolicyId}:${target.priorityId}`, target]),
  );
  const priorityWeight = new Map(
    priorities.map((priority) => [priority.id, priority.leaderboardWeight]),
  );

  type Bucket = {
    weighted: number;
    resolved: number;
    responseMet: number;
    responseDecided: number;
    resolutionMet: number;
    resolutionDecided: number;
    reopened: number;
    csatTotal: number;
    csatCount: number;
  };
  const buckets = new Map<string, Bucket>();
  const bucketFor = (userId: string): Bucket => {
    const existing = buckets.get(userId);
    if (existing) return existing;
    const created: Bucket = {
      weighted: 0,
      resolved: 0,
      responseMet: 0,
      responseDecided: 0,
      resolutionMet: 0,
      resolutionDecided: 0,
      reopened: 0,
      csatTotal: 0,
      csatCount: 0,
    };
    buckets.set(userId, created);
    return created;
  };

  // The SLA matcher does not carry calendarId, so index it separately.
  const policyCalendar = new Map(policies.map((policy) => [policy.id, policy.calendarId]));

  for (const ticket of tickets) {
    if (!ticket.assigneeId) continue;
    const bucket = bucketFor(ticket.assigneeId);
    bucket.resolved += 1;
    bucket.weighted += priorityWeight.get(ticket.priorityId) ?? 1;
    if (ticket.reopenCount > 0) bucket.reopened += ticket.reopenCount;

    const policy = selectPolicy(policies, ticket);
    const target = policy ? targetIndex.get(`${policy.id}:${ticket.priorityId}`) : undefined;
    if (!policy || !target) continue;

    const calendarId = policyCalendar.get(policy.id);
    const outcome = computeSla(
      ticket,
      policy,
      target,
      calendarId ? (calendarById.get(calendarId) ?? fallbackCalendar) : fallbackCalendar,
      now,
    );
    if (outcome.responseMet !== null) {
      bucket.responseDecided += 1;
      if (outcome.responseMet) bucket.responseMet += 1;
    }
    if (outcome.resolutionMet !== null) {
      bucket.resolutionDecided += 1;
      if (outcome.resolutionMet) bucket.resolutionMet += 1;
    }
  }

  for (const response of csat) {
    const assignee = response.ticket.assigneeId;
    if (!assignee) continue;
    const bucket = bucketFor(assignee);
    bucket.csatTotal += response.rating;
    bucket.csatCount += 1;
  }

  const stats: AgentStats[] = members.map((membership) => {
    const bucket = buckets.get(membership.user.id);
    return {
      userId: membership.user.id,
      name: membership.user.name,
      weightedResolved: bucket?.weighted ?? 0,
      resolvedCount: bucket?.resolved ?? 0,
      responseAttainmentPct:
        bucket && bucket.responseDecided > 0
          ? (bucket.responseMet / bucket.responseDecided) * 100
          : null,
      resolutionAttainmentPct:
        bucket && bucket.resolutionDecided > 0
          ? (bucket.resolutionMet / bucket.resolutionDecided) * 100
          : null,
      csatAverage: bucket && bucket.csatCount > 0 ? bucket.csatTotal / bucket.csatCount : null,
      csatResponses: bucket?.csatCount ?? 0,
      reopenedCount: bucket?.reopened ?? 0,
    };
  });

  const rows = buildLeaderboard(stats, weights);

  return {
    enabled: true,
    visible: true,
    periodLabel: label,
    from,
    to,
    rows,
    weights,
    me: rows.find((row) => row.userId === actor.userId) ?? null,
  };
}

/** Ensure a group has a leaderboard config row, creating the default if not. */
export async function ensureLeaderboardConfig(helpDeskGroupId: string) {
  return db().leaderboardConfig.upsert({
    where: { helpDeskGroupId },
    create: { helpDeskGroupId },
    update: {},
  });
}

export const OPEN_STATUS_CATEGORIES: StatusCategory[] = [
  StatusCategory.NEW,
  StatusCategory.OPEN,
  StatusCategory.PENDING,
  StatusCategory.ON_HOLD,
];
