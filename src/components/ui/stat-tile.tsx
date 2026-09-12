import Link from 'next/link';
import { cn } from '@/lib/utils';
import { TONE_TEXT, type Tone } from '@/lib/design/tones';

/**
 * Metric tile. Numbers are the point, so they get the size and tabular figures;
 * the label is quiet above them. `trend` is a slot for a sparkline (dashboard
 * redesign); it renders nothing until a caller provides one.
 */
export function StatTile({
  label,
  value,
  href,
  tone = 'neutral',
  hint,
  trend,
}: {
  label: string;
  value: number | string | null;
  href?: string;
  tone?: Tone;
  hint?: string;
  trend?: React.ReactNode;
}) {
  const body = (
    <>
      <div className="text-2xs font-semibold tracking-wider text-muted-foreground uppercase">
        {label}
      </div>
      <div className="mt-1.5 flex items-end justify-between gap-3">
        <div className={cn('text-2xl font-semibold tabular', TONE_TEXT[tone])}>
          {/* null is "no data" and must never render as a confident 0. */}
          {value === null ? <span className="text-faint">—</span> : value}
        </div>
        {trend ? <div className="shrink-0">{trend}</div> : null}
      </div>
      {hint ? <div className="mt-0.5 text-2xs text-muted-foreground">{hint}</div> : null}
    </>
  );

  return href ? (
    <Link
      href={href}
      className="card block p-4 transition hover:border-border-strong hover:bg-muted"
    >
      {body}
    </Link>
  ) : (
    <div className="card p-4">{body}</div>
  );
}
