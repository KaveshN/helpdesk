import { Award, Medal, Trophy } from 'lucide-react';
import type { LeaderboardView } from '@/lib/leaderboard/service';

/**
 * Agent leaderboard.
 *
 * The components are shown next to the rank on purpose: a score you cannot
 * decompose is a score people argue with. Showing that the leader got there on
 * CSAT and SLA rather than raw volume is what stops the board being read as
 * "close the most tickets".
 */
function RankBadge({ rank }: { rank: number | null }) {
  if (rank === null) {
    return <span className="text-xs text-faint">—</span>;
  }
  if (rank <= 3) {
    const Icon = rank === 1 ? Trophy : rank === 2 ? Medal : Award;
    const colour = rank === 1 ? 'text-warning' : rank === 2 ? 'text-muted-foreground' : 'text-faint';
    return (
      <span
        className={`inline-flex items-center gap-1.5 font-semibold tabular ${colour}`}
      >
        <Icon className="size-4" aria-hidden />
        {rank}
      </span>
    );
  }
  return <span className="tabular text-muted-foreground">{rank}</span>;
}

function Metric({ label, value, suffix }: { label: string; value: string; suffix?: string }) {
  return (
    <div>
      <div className="text-2xs tracking-wider text-faint uppercase">{label}</div>
      <div className="tabular">
        {value}
        {suffix}
      </div>
    </div>
  );
}

export function LeaderboardPanel({ view }: { view: LeaderboardView }) {
  const ranked = view.rows.filter((row) => row.ranked);
  const unranked = view.rows.filter((row) => !row.ranked && row.resolvedCount > 0);

  return (
    <section className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
        <h2 className="panel-title">Agent leaderboard</h2>
        <span className="text-xs text-muted-foreground">{view.periodLabel}</span>
      </div>

      {ranked.length === 0 ? (
        <p className="px-4 py-8 text-center text-muted-foreground">
          No agent has resolved {view.weights.minimumTicketsToRank} tickets this period yet.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {ranked.map((row) => {
            const isMe = view.me?.userId === row.userId;
            return (
              <li
                key={row.userId}
                className={isMe ? 'bg-primary-subtle px-4 py-3' : 'px-4 py-3'}
              >
                <div className="flex items-center gap-3">
                  <span className="w-8 shrink-0">
                    <RankBadge rank={row.rank} />
                  </span>
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {row.name}
                    {isMe ? <span className="ml-2 text-xs text-muted-foreground">you</span> : null}
                  </span>
                  <span className="shrink-0 text-base font-semibold tabular">{row.score}</span>
                </div>

                {/* The components behind the number. */}
                <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 pl-11 text-xs sm:grid-cols-5">
                  <Metric label="Resolved" value={String(row.resolvedCount)} />
                  <Metric
                    label="Response SLA"
                    value={
                      row.responseAttainmentPct === null
                        ? '—'
                        : String(Math.round(row.responseAttainmentPct))
                    }
                    suffix={row.responseAttainmentPct === null ? '' : '%'}
                  />
                  <Metric
                    label="Resolution SLA"
                    value={
                      row.resolutionAttainmentPct === null
                        ? '—'
                        : String(Math.round(row.resolutionAttainmentPct))
                    }
                    suffix={row.resolutionAttainmentPct === null ? '' : '%'}
                  />
                  <Metric
                    label="CSAT"
                    value={row.csatAverage === null ? '—' : row.csatAverage.toFixed(1)}
                  />
                  <Metric label="Reopened" value={String(row.reopenedCount)} />
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {unranked.length > 0 ? (
        <div className="border-t px-4 py-2.5 text-xs text-muted-foreground">
          Below the {view.weights.minimumTicketsToRank}-ticket threshold:{' '}
          {unranked.map((row) => row.name).join(', ')}
        </div>
      ) : null}

      <p className="border-t px-4 py-2.5 text-xs text-muted-foreground">
        Scored on priority-weighted resolutions, SLA attainment and CSAT, with reopened tickets
        subtracting. Closing easy tickets quickly does not win.
      </p>
    </section>
  );
}
