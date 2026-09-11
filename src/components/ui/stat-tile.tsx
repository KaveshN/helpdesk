import Link from 'next/link';

/**
 * Metric tile. Numbers are the point, so they get the size and tabular figures;
 * the label is quiet above them.
 */
export function StatTile({
  label,
  value,
  href,
  tone = 'neutral',
  hint,
}: {
  label: string;
  value: number | string | null;
  href?: string;
  tone?: 'neutral' | 'warning' | 'danger' | 'good';
  hint?: string;
}) {
  const colour = {
    neutral: 'var(--foreground)',
    warning: 'var(--warning)',
    danger: 'var(--danger)',
    good: 'var(--success)',
  }[tone];

  const body = (
    <>
      <div className="text-[0.6875rem] font-semibold tracking-wider text-muted uppercase">
        {label}
      </div>
      <div className="mt-1.5 text-2xl font-semibold tabular" style={{ color: colour }}>
        {/* null is "no data" and must never render as a confident 0. */}
        {value === null ? <span className="text-faint">—</span> : value}
      </div>
      {hint ? <div className="mt-0.5 text-[0.6875rem] text-faint">{hint}</div> : null}
    </>
  );

  return href ? (
    <Link
      href={href}
      className="card block p-4 transition hover:border-border-strong hover:bg-subtle"
    >
      {body}
    </Link>
  ) : (
    <div className="card p-4">{body}</div>
  );
}
