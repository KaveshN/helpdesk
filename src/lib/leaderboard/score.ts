/**
 * Leaderboard scoring.
 *
 * Pure and tested because this is the part with behavioural consequences: a
 * leaderboard is an instruction to agents about what the organisation values,
 * and they will optimise for exactly what it measures.
 *
 * The default weighting is deliberately quality-heavy. Volume alone rewards
 * cherry-picking easy tickets and clicking Resolved early; here a reopened
 * ticket costs more than the resolution earned, and CSAT and SLA attainment
 * carry real weight. Priority weighting means a P1 that took an afternoon is
 * not worth the same as a password reset.
 *
 * Every component is returned alongside the total so the UI can show *why*
 * someone ranks where they do. A score nobody can decompose is a score nobody
 * trusts.
 */

export type ScoreWeights = {
  weightResolved: number;
  weightResponseSla: number;
  weightResolutionSla: number;
  weightCsat: number;
  /** Negative by convention. */
  weightReopen: number;
  minimumTicketsToRank: number;
};

export type AgentStats = {
  userId: string;
  name: string;
  /** Sum of priority weights over resolved tickets, not a raw count. */
  weightedResolved: number;
  resolvedCount: number;
  /** 0-100, or null when no ticket in the period had a decided outcome. */
  responseAttainmentPct: number | null;
  resolutionAttainmentPct: number | null;
  /** Mean CSAT 1-5, or null when nobody responded. */
  csatAverage: number | null;
  csatResponses: number;
  reopenedCount: number;
};

export type ScoreBreakdown = {
  resolved: number;
  responseSla: number;
  resolutionSla: number;
  csat: number;
  reopen: number;
};

export type ScoredAgent = AgentStats & {
  score: number;
  breakdown: ScoreBreakdown;
  /** 1-based. Null when below the minimum volume to be ranked. */
  rank: number | null;
  ranked: boolean;
};

/** CSAT is scored relative to neutral, so a 3/5 average earns nothing. */
const CSAT_NEUTRAL = 3;

export function scoreAgent(stats: AgentStats, weights: ScoreWeights): ScoreBreakdown {
  return {
    resolved: stats.weightedResolved * weights.weightResolved,
    // Attainment contributes nothing when undecided rather than counting as
    // zero — an agent with no closed tickets yet is not a failing agent.
    responseSla: (stats.responseAttainmentPct ?? 0) * weights.weightResponseSla,
    resolutionSla: (stats.resolutionAttainmentPct ?? 0) * weights.weightResolutionSla,
    csat:
      stats.csatAverage === null
        ? 0
        : (stats.csatAverage - CSAT_NEUTRAL) * stats.csatResponses * weights.weightCsat,
    reopen: stats.reopenedCount * weights.weightReopen,
  };
}

export function totalScore(breakdown: ScoreBreakdown): number {
  return (
    breakdown.resolved +
    breakdown.responseSla +
    breakdown.resolutionSla +
    breakdown.csat +
    breakdown.reopen
  );
}

/**
 * Rank a group's agents.
 *
 * Agents below `minimumTicketsToRank` are returned but unranked: without a
 * floor, one lucky five-star ticket tops the board over someone who carried a
 * hundred. Ties share a rank (standard competition ranking), because breaking
 * a genuine tie arbitrarily is worse than showing it.
 */
export function buildLeaderboard(
  agents: readonly AgentStats[],
  weights: ScoreWeights,
): ScoredAgent[] {
  const scored = agents.map((stats) => {
    const breakdown = scoreAgent(stats, weights);
    return {
      ...stats,
      breakdown,
      score: Math.round(totalScore(breakdown) * 10) / 10,
      ranked: stats.resolvedCount >= weights.minimumTicketsToRank,
      rank: null as number | null,
    };
  });

  scored.sort((a, b) => {
    if (a.ranked !== b.ranked) return a.ranked ? -1 : 1;
    if (b.score !== a.score) return b.score - a.score;
    // Stable, explicable tie-break for display order only.
    return a.name.localeCompare(b.name);
  });

  let rank = 0;
  let previousScore: number | null = null;
  let seen = 0;

  for (const agent of scored) {
    if (!agent.ranked) continue;
    seen += 1;
    if (previousScore === null || agent.score !== previousScore) {
      rank = seen;
      previousScore = agent.score;
    }
    agent.rank = rank;
  }

  return scored;
}

/** Inclusive period bounds for a leaderboard window, in UTC. */
export function periodBounds(
  period: 'WEEK' | 'MONTH' | 'QUARTER',
  now = new Date(),
): { from: Date; to: Date; label: string } {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();

  if (period === 'WEEK') {
    const day = now.getUTCDay();
    // ISO weeks start Monday; getUTCDay is 0-6 from Sunday.
    const offset = (day + 6) % 7;
    const from = new Date(Date.UTC(year, month, now.getUTCDate() - offset));
    const to = new Date(from.getTime() + 7 * 24 * 60 * 60 * 1000 - 1);
    return { from, to, label: `Week of ${from.toISOString().slice(0, 10)}` };
  }

  if (period === 'QUARTER') {
    const quarter = Math.floor(month / 3);
    const from = new Date(Date.UTC(year, quarter * 3, 1));
    const to = new Date(Date.UTC(year, quarter * 3 + 3, 1) - 1);
    return { from, to, label: `Q${quarter + 1} ${year}` };
  }

  const from = new Date(Date.UTC(year, month, 1));
  const to = new Date(Date.UTC(year, month + 1, 1) - 1);
  return {
    from,
    to,
    label: from.toLocaleString('en', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
  };
}
