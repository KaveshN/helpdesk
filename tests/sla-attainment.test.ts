import { describe, expect, it } from 'vitest';
import {
  computeSla,
  selectPolicy,
  summariseAttainment,
  type PolicyCandidate,
  type TargetMinutes,
  type TicketForSla,
} from '@/lib/sla/attainment';
import type { BusinessCalendar } from '@/lib/sla/calendar';

const JHB: BusinessCalendar = {
  timeZone: 'Africa/Johannesburg',
  workingHours: Array.from({ length: 7 }, (_, dayOfWeek) => ({
    dayOfWeek,
    isWorkingDay: dayOfWeek >= 1 && dayOfWeek <= 5,
    startMinute: 8 * 60,
    endMinute: 17 * 60,
  })),
  holidays: new Set(),
  recurringHolidays: new Set(),
};

const policy = (overrides: Partial<PolicyCandidate> = {}): PolicyCandidate => ({
  id: 'p-default',
  matchOrder: 1000,
  isDefault: true,
  isActive: true,
  businessHoursOnly: true,
  ticketTypeId: null,
  categoryId: null,
  ...overrides,
});

const target: TargetMinutes = {
  responseMinutes: 60,
  resolutionMinutes: 480,
  warningThresholdPct: 80,
};

// Monday 2026-09-14, 09:00 SAST.
const created = new Date('2026-09-14T07:00:00.000Z');

const ticket = (overrides: Partial<TicketForSla> = {}): TicketForSla => ({
  createdAt: created,
  firstRespondedAt: null,
  resolvedAt: null,
  typeId: 'type-incident',
  categoryId: 'cat-hardware',
  priorityId: 'pri-p3',
  ...overrides,
});

describe('selectPolicy', () => {
  it('picks the lowest matchOrder among matching policies', () => {
    const specific = policy({ id: 'p-specific', matchOrder: 10, isDefault: false, ticketTypeId: 'type-incident' });
    expect(selectPolicy([policy(), specific], ticket())?.id).toBe('p-specific');
  });

  it('ignores a policy whose type condition does not match', () => {
    const other = policy({ id: 'p-other', matchOrder: 10, isDefault: false, ticketTypeId: 'type-request' });
    expect(selectPolicy([policy(), other], ticket())?.id).toBe('p-default');
  });

  it('ignores a policy whose category condition does not match', () => {
    const other = policy({ id: 'p-other', matchOrder: 10, isDefault: false, categoryId: 'cat-network' });
    expect(selectPolicy([policy(), other], ticket())?.id).toBe('p-default');
  });

  it('matches a category-scoped policy for an uncategorised ticket only when the policy is unscoped', () => {
    const scoped = policy({ id: 'p-scoped', matchOrder: 10, isDefault: false, categoryId: 'cat-hardware' });
    expect(selectPolicy([scoped], ticket({ categoryId: null }))).toBeNull();
    expect(selectPolicy([policy()], ticket({ categoryId: null }))?.id).toBe('p-default');
  });

  it('never selects an inactive policy', () => {
    expect(selectPolicy([policy({ isActive: false })], ticket())).toBeNull();
  });

  it('returns null when nothing matches', () => {
    expect(selectPolicy([], ticket())).toBeNull();
  });

  it('breaks a matchOrder tie in favour of the default', () => {
    const nonDefault = policy({ id: 'p-a', isDefault: false });
    const isDefault = policy({ id: 'p-b', isDefault: true });
    expect(selectPolicy([nonDefault, isDefault], ticket())?.id).toBe('p-b');
  });
});

describe('computeSla', () => {
  it('computes due dates in business hours', () => {
    const outcome = computeSla(ticket(), policy(), target, JHB, created);
    // 09:00 + 60 working minutes = 10:00 SAST; + 480 = 17:00 SAST.
    expect(outcome.firstResponseDueAt?.toISOString()).toBe('2026-09-14T08:00:00.000Z');
    expect(outcome.resolutionDueAt?.toISOString()).toBe('2026-09-14T15:00:00.000Z');
  });

  it('ignores the calendar when the policy is 24/7', () => {
    const outcome = computeSla(ticket(), policy({ businessHoursOnly: false }), target, JHB, created);
    expect(outcome.firstResponseDueAt?.toISOString()).toBe('2026-09-14T08:00:00.000Z');
    // 480 calendar minutes from 09:00 = 17:00 too, but a weekend ticket differs:
    const weekend = ticket({ createdAt: new Date('2026-09-13T00:00:00.000Z') });
    const always = computeSla(weekend, policy({ businessHoursOnly: false }), target, JHB, created);
    expect(always.firstResponseDueAt?.toISOString()).toBe('2026-09-13T01:00:00.000Z');
  });

  it('marks a response inside target as met', () => {
    const outcome = computeSla(
      ticket({ firstRespondedAt: new Date('2026-09-14T07:30:00.000Z') }), // 30 mins later
      policy(),
      target,
      JHB,
      new Date('2026-09-14T08:00:00.000Z'),
    );
    expect(outcome.responseMinutesUsed).toBe(30);
    expect(outcome.responseMet).toBe(true);
    expect(outcome.responseBreached).toBe(false);
  });

  it('marks a late response as missed', () => {
    const outcome = computeSla(
      ticket({ firstRespondedAt: new Date('2026-09-14T09:00:00.000Z') }), // 120 mins
      policy(),
      target,
      JHB,
      new Date('2026-09-14T09:00:00.000Z'),
    );
    expect(outcome.responseMinutesUsed).toBe(120);
    expect(outcome.responseMet).toBe(false);
    expect(outcome.responseBreached).toBe(true);
  });

  it('leaves an open, in-target ticket UNDECIDED rather than counting it as met', () => {
    // This is the assertion that keeps the reports honest.
    const outcome = computeSla(ticket(), policy(), target, JHB, new Date('2026-09-14T07:30:00.000Z'));
    expect(outcome.responseMet).toBeNull();
    expect(outcome.resolutionMet).toBeNull();
    expect(outcome.responseBreached).toBe(false);
  });

  it('breaches an open ticket once it passes target even with no response', () => {
    const outcome = computeSla(ticket(), policy(), target, JHB, new Date('2026-09-14T09:00:00.000Z'));
    expect(outcome.responseMet).toBe(false);
    expect(outcome.responseBreached).toBe(true);
  });

  it('flags at-risk at the warning threshold but not before', () => {
    // 80% of 60 minutes = 48 minutes.
    const before = computeSla(ticket(), policy(), target, JHB, new Date('2026-09-14T07:47:00.000Z'));
    const after = computeSla(ticket(), policy(), target, JHB, new Date('2026-09-14T07:48:00.000Z'));
    expect(before.responseAtRisk).toBe(false);
    expect(after.responseAtRisk).toBe(true);
  });

  it('stops the clock at resolution, not at now', () => {
    const outcome = computeSla(
      ticket({ resolvedAt: new Date('2026-09-14T11:00:00.000Z') }), // 240 working mins
      policy(),
      target,
      JHB,
      new Date('2026-09-30T07:00:00.000Z'), // long after
    );
    expect(outcome.resolutionMinutesUsed).toBe(240);
    expect(outcome.resolutionMet).toBe(true);
  });

  it('does not consume budget over a weekend', () => {
    // Raised Friday 16:30, responded Monday 08:15 -> 30 + 15 = 45 working minutes.
    const outcome = computeSla(
      ticket({
        createdAt: new Date('2026-09-18T14:30:00.000Z'),
        firstRespondedAt: new Date('2026-09-21T06:15:00.000Z'),
      }),
      policy(),
      target,
      JHB,
      new Date('2026-09-21T06:15:00.000Z'),
    );
    expect(outcome.responseMinutesUsed).toBe(45);
    expect(outcome.responseMet).toBe(true);
  });
});

describe('summariseAttainment', () => {
  const outcome = (over: Partial<ReturnType<typeof computeSla>>) =>
    ({
      policyId: 'p',
      firstResponseDueAt: null,
      resolutionDueAt: null,
      responseMinutesUsed: 0,
      resolutionMinutesUsed: 0,
      responseMet: null,
      resolutionMet: null,
      responseBreached: false,
      resolutionBreached: false,
      responseAtRisk: false,
      resolutionAtRisk: false,
      ...over,
    }) as ReturnType<typeof computeSla>;

  it('reports percentages over decided outcomes only', () => {
    const summary = summariseAttainment([
      outcome({ responseMet: true }),
      outcome({ responseMet: true }),
      outcome({ responseMet: false, responseBreached: true }),
      outcome({ responseMet: null }), // still open, in target
    ]);

    expect(summary.responseDecided).toBe(3);
    expect(summary.responseMet).toBe(2);
    expect(summary.responseAttainmentPct).toBeCloseTo(66.67, 1);
    expect(summary.responseUndecided).toBe(1);
  });

  it('returns null rather than 0% or 100% when nothing is decided', () => {
    // An empty period must read as "no data", not as perfect or total failure.
    const summary = summariseAttainment([outcome({}), outcome({})]);
    expect(summary.responseAttainmentPct).toBeNull();
    expect(summary.resolutionAttainmentPct).toBeNull();
  });

  it('counts at-risk and breached independently', () => {
    const summary = summariseAttainment([
      outcome({ responseAtRisk: true }),
      outcome({ resolutionBreached: true, resolutionMet: false }),
    ]);
    expect(summary.atRisk).toBe(1);
    expect(summary.breached).toBe(1);
  });

  it('handles an empty set', () => {
    const summary = summariseAttainment([]);
    expect(summary.responseAttainmentPct).toBeNull();
    expect(summary.breached).toBe(0);
  });
});
