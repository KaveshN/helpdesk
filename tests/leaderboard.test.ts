import { describe, expect, it } from 'vitest';
import {
  buildLeaderboard,
  periodBounds,
  scoreAgent,
  totalScore,
  type AgentStats,
  type ScoreWeights,
} from '@/lib/leaderboard/score';

const weights: ScoreWeights = {
  weightResolved: 10,
  weightResponseSla: 0.4,
  weightResolutionSla: 0.6,
  weightCsat: 8,
  weightReopen: -15,
  minimumTicketsToRank: 3,
};

const agent = (over: Partial<AgentStats> = {}): AgentStats => ({
  userId: 'u1',
  name: 'Agent One',
  weightedResolved: 10,
  resolvedCount: 10,
  responseAttainmentPct: 100,
  resolutionAttainmentPct: 100,
  csatAverage: null,
  csatResponses: 0,
  reopenedCount: 0,
  ...over,
});

describe('scoreAgent', () => {
  it('credits priority-weighted volume, not a raw count', () => {
    // Ten P4s and ten P1s must not score the same.
    const easy = scoreAgent(agent({ weightedResolved: 10, resolvedCount: 10 }), weights);
    const hard = scoreAgent(agent({ weightedResolved: 30, resolvedCount: 10 }), weights);
    expect(hard.resolved).toBeGreaterThan(easy.resolved);
    expect(easy.resolved).toBe(100);
    expect(hard.resolved).toBe(300);
  });

  it('scores CSAT relative to neutral, so a 3/5 average earns nothing', () => {
    expect(scoreAgent(agent({ csatAverage: 3, csatResponses: 5 }), weights).csat).toBe(0);
    expect(scoreAgent(agent({ csatAverage: 5, csatResponses: 5 }), weights).csat).toBe(80);
  });

  it('lets poor CSAT subtract', () => {
    expect(scoreAgent(agent({ csatAverage: 1, csatResponses: 4 }), weights).csat).toBe(-64);
  });

  it('penalises reopens', () => {
    expect(scoreAgent(agent({ reopenedCount: 2 }), weights).reopen).toBe(-30);
  });

  it('treats undecided SLA as zero contribution, not as failure', () => {
    const undecided = scoreAgent(
      agent({ responseAttainmentPct: null, resolutionAttainmentPct: null }),
      weights,
    );
    expect(undecided.responseSla).toBe(0);
    expect(undecided.resolutionSla).toBe(0);
  });

  it('scores no CSAT responses as zero, not negative', () => {
    expect(scoreAgent(agent({ csatAverage: null, csatResponses: 0 }), weights).csat).toBe(0);
  });
});

describe('the anti-gaming property', () => {
  it('makes closing junk fast lose to doing fewer tickets well', () => {
    // This is the whole point of the weighting. The volume agent closes twice
    // as many tickets but reopens six of them and has poor satisfaction.
    const churner = agent({
      userId: 'churn',
      name: 'Churner',
      weightedResolved: 40,
      resolvedCount: 40,
      responseAttainmentPct: 100,
      resolutionAttainmentPct: 100,
      csatAverage: 2,
      csatResponses: 10,
      reopenedCount: 12,
    });
    const careful = agent({
      userId: 'careful',
      name: 'Careful',
      weightedResolved: 20,
      resolvedCount: 18,
      responseAttainmentPct: 100,
      resolutionAttainmentPct: 100,
      csatAverage: 4.6,
      csatResponses: 12,
      reopenedCount: 0,
    });

    const board = buildLeaderboard([churner, careful], weights);
    expect(board[0]!.name).toBe('Careful');
    expect(board[0]!.score).toBeGreaterThan(board[1]!.score);
  });

  it('does not let one lucky ticket top the board', () => {
    const newcomer = agent({
      userId: 'new',
      name: 'Newcomer',
      weightedResolved: 4,
      resolvedCount: 1, // below minimumTicketsToRank
      csatAverage: 5,
      csatResponses: 1,
    });
    const veteran = agent({
      userId: 'vet',
      name: 'Veteran',
      weightedResolved: 25,
      resolvedCount: 20,
    });

    const board = buildLeaderboard([newcomer, veteran], weights);
    expect(board[0]!.name).toBe('Veteran');
    expect(board[0]!.rank).toBe(1);
    // Listed, but explicitly unranked rather than hidden.
    const unranked = board.find((row) => row.name === 'Newcomer')!;
    expect(unranked.ranked).toBe(false);
    expect(unranked.rank).toBeNull();
  });
});

describe('buildLeaderboard', () => {
  it('ranks by score descending', () => {
    const board = buildLeaderboard(
      [
        agent({ userId: 'a', name: 'A', weightedResolved: 10, resolvedCount: 10 }),
        agent({ userId: 'b', name: 'B', weightedResolved: 30, resolvedCount: 10 }),
        agent({ userId: 'c', name: 'C', weightedResolved: 20, resolvedCount: 10 }),
      ],
      weights,
    );
    expect(board.map((row) => row.name)).toEqual(['B', 'C', 'A']);
    expect(board.map((row) => row.rank)).toEqual([1, 2, 3]);
  });

  it('shares a rank on a tie, then resumes at the right number', () => {
    const board = buildLeaderboard(
      [
        agent({ userId: 'a', name: 'A', weightedResolved: 20, resolvedCount: 10 }),
        agent({ userId: 'b', name: 'B', weightedResolved: 20, resolvedCount: 10 }),
        agent({ userId: 'c', name: 'C', weightedResolved: 10, resolvedCount: 10 }),
      ],
      weights,
    );
    expect(board.map((row) => row.rank)).toEqual([1, 1, 3]);
  });

  it('always returns the component breakdown alongside the total', () => {
    // A score nobody can decompose is a score nobody trusts.
    const board = buildLeaderboard(
      [agent({ csatAverage: 4, csatResponses: 2, reopenedCount: 1 })],
      weights,
    );
    const row = board[0]!;
    expect(Object.keys(row.breakdown).sort()).toEqual([
      'csat',
      'reopen',
      'resolutionSla',
      'resolved',
      'responseSla',
    ]);
    expect(Math.round(totalScore(row.breakdown) * 10) / 10).toBe(row.score);
  });

  it('handles an empty board', () => {
    expect(buildLeaderboard([], weights)).toEqual([]);
  });

  it('puts every unranked agent below every ranked one', () => {
    const board = buildLeaderboard(
      [
        agent({ userId: 'x', name: 'Unranked', weightedResolved: 99, resolvedCount: 1 }),
        agent({ userId: 'y', name: 'Ranked', weightedResolved: 1, resolvedCount: 5 }),
      ],
      weights,
    );
    expect(board[0]!.name).toBe('Ranked');
  });
});

describe('periodBounds', () => {
  const now = new Date('2026-09-11T10:00:00Z'); // a Friday

  it('bounds the ISO week Monday to Sunday', () => {
    const { from, to } = periodBounds('WEEK', now);
    expect(from.toISOString().slice(0, 10)).toBe('2026-09-07'); // Monday
    expect(to.toISOString().slice(0, 10)).toBe('2026-09-13'); // Sunday
  });

  it('bounds the calendar month', () => {
    const { from, to, label } = periodBounds('MONTH', now);
    expect(from.toISOString().slice(0, 10)).toBe('2026-09-01');
    expect(to.toISOString().slice(0, 10)).toBe('2026-09-30');
    expect(label).toBe('September 2026');
  });

  it('bounds the quarter', () => {
    const { from, to, label } = periodBounds('QUARTER', now);
    expect(from.toISOString().slice(0, 10)).toBe('2026-07-01');
    expect(to.toISOString().slice(0, 10)).toBe('2026-09-30');
    expect(label).toBe('Q3 2026');
  });

  it('handles a Sunday without rolling into the next week', () => {
    const sunday = new Date('2026-09-13T10:00:00Z');
    expect(periodBounds('WEEK', sunday).from.toISOString().slice(0, 10)).toBe('2026-09-07');
  });
});
