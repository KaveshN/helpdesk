import {
  ALWAYS_OPEN,
  addBusinessMinutes,
  businessMinutesBetween,
  type BusinessCalendar,
} from '@/lib/sla/calendar';

/**
 * SLA policy selection and attainment, computed rather than stored.
 *
 * Phase 2 will persist due dates on the ticket and sweep for breaches. Until
 * then reporting derives them here from the group's own SLAPolicy + Calendar
 * config, so "SLA performance" shows real numbers instead of an empty table.
 * When Phase 2 lands it should populate Ticket.firstResponseDueAt /
 * resolutionDueAt using exactly these functions -- not a second implementation.
 */

/** A policy as the matcher needs it: narrowing conditions plus its ordering. */
export type PolicyCandidate = {
  id: string;
  matchOrder: number;
  isDefault: boolean;
  isActive: boolean;
  businessHoursOnly: boolean;
  /** null means "applies to any". */
  ticketTypeId: string | null;
  categoryId: string | null;
};

export type TargetMinutes = {
  responseMinutes: number;
  resolutionMinutes: number;
  warningThresholdPct: number;
};

export type TicketForSla = {
  createdAt: Date;
  firstRespondedAt: Date | null;
  resolvedAt: Date | null;
  typeId: string;
  categoryId: string | null;
  priorityId: string;
};

/**
 * Pick the policy that governs a ticket.
 *
 * Most specific wins, decided by the admin-controlled `matchOrder` (lower wins)
 * rather than by counting matched fields -- so an administrator can always
 * predict and override which policy applies. A policy whose conditions do not
 * match is never selected, even if it is the default.
 */
export function selectPolicy(
  candidates: readonly PolicyCandidate[],
  ticket: Pick<TicketForSla, 'typeId' | 'categoryId'>,
): PolicyCandidate | null {
  const matching = candidates
    .filter((candidate) => candidate.isActive)
    .filter(
      (candidate) =>
        (candidate.ticketTypeId === null || candidate.ticketTypeId === ticket.typeId) &&
        (candidate.categoryId === null || candidate.categoryId === ticket.categoryId),
    )
    .sort((a, b) => a.matchOrder - b.matchOrder || Number(b.isDefault) - Number(a.isDefault));

  return matching[0] ?? null;
}

export type SlaOutcome = {
  policyId: string;
  firstResponseDueAt: Date | null;
  resolutionDueAt: Date | null;
  /** Working minutes consumed so far (or until resolution). */
  responseMinutesUsed: number;
  resolutionMinutesUsed: number;
  /** null while still open and not yet breached -- i.e. outcome unknown. */
  responseMet: boolean | null;
  resolutionMet: boolean | null;
  responseBreached: boolean;
  resolutionBreached: boolean;
  /** Past the warning threshold but not yet breached. */
  responseAtRisk: boolean;
  resolutionAtRisk: boolean;
};

/**
 * Compute due dates and attainment for one ticket.
 *
 * `now` is injected so reporting can compute "as at" a period end and so tests
 * are not clock-dependent.
 */
export function computeSla(
  ticket: TicketForSla,
  policy: PolicyCandidate,
  target: TargetMinutes,
  calendar: BusinessCalendar,
  now: Date,
): SlaOutcome {
  const effective = policy.businessHoursOnly ? calendar : ALWAYS_OPEN;

  const firstResponseDueAt = addBusinessMinutes(
    ticket.createdAt,
    target.responseMinutes,
    effective,
  );
  const resolutionDueAt = addBusinessMinutes(ticket.createdAt, target.resolutionMinutes, effective);

  const responseEnd = ticket.firstRespondedAt ?? now;
  const resolutionEnd = ticket.resolvedAt ?? now;

  const responseMinutesUsed = businessMinutesBetween(ticket.createdAt, responseEnd, effective);
  const resolutionMinutesUsed = businessMinutesBetween(ticket.createdAt, resolutionEnd, effective);

  // A met/missed verdict only exists once the milestone happened. While a
  // ticket is open and inside target the outcome is genuinely unknown, and
  // reporting must not count unknown as success -- that flatters the numbers.
  const responseMet = ticket.firstRespondedAt
    ? responseMinutesUsed <= target.responseMinutes
    : responseMinutesUsed > target.responseMinutes
      ? false
      : null;

  const resolutionMet = ticket.resolvedAt
    ? resolutionMinutesUsed <= target.resolutionMinutes
    : resolutionMinutesUsed > target.resolutionMinutes
      ? false
      : null;

  const responseThreshold = (target.responseMinutes * target.warningThresholdPct) / 100;
  const resolutionThreshold = (target.resolutionMinutes * target.warningThresholdPct) / 100;

  return {
    policyId: policy.id,
    firstResponseDueAt,
    resolutionDueAt,
    responseMinutesUsed,
    resolutionMinutesUsed,
    responseMet,
    resolutionMet,
    responseBreached: responseMet === false,
    resolutionBreached: resolutionMet === false,
    responseAtRisk:
      responseMet === null && !ticket.firstRespondedAt && responseMinutesUsed >= responseThreshold,
    resolutionAtRisk:
      resolutionMet === null && !ticket.resolvedAt && resolutionMinutesUsed >= resolutionThreshold,
  };
}

/** Attainment percentages over a set of outcomes, ignoring unknowns. */
export function summariseAttainment(outcomes: readonly SlaOutcome[]) {
  const responseDecided = outcomes.filter((outcome) => outcome.responseMet !== null);
  const resolutionDecided = outcomes.filter((outcome) => outcome.resolutionMet !== null);

  const pct = (met: number, total: number) => (total === 0 ? null : (met / total) * 100);

  return {
    responseMet: responseDecided.filter((outcome) => outcome.responseMet).length,
    responseDecided: responseDecided.length,
    responseAttainmentPct: pct(
      responseDecided.filter((outcome) => outcome.responseMet).length,
      responseDecided.length,
    ),
    resolutionMet: resolutionDecided.filter((outcome) => outcome.resolutionMet).length,
    resolutionDecided: resolutionDecided.length,
    resolutionAttainmentPct: pct(
      resolutionDecided.filter((outcome) => outcome.resolutionMet).length,
      resolutionDecided.length,
    ),
    /** Open tickets whose outcome is not yet decided -- reported, never assumed. */
    responseUndecided: outcomes.length - responseDecided.length,
    resolutionUndecided: outcomes.length - resolutionDecided.length,
    atRisk: outcomes.filter((outcome) => outcome.responseAtRisk || outcome.resolutionAtRisk).length,
    breached: outcomes.filter((outcome) => outcome.responseBreached || outcome.resolutionBreached)
      .length,
  };
}
