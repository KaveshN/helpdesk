/**
 * Status / priority chip.
 *
 * The chip itself stays neutral and a coloured dot carries the meaning. A wall
 * of saturated badges is how a P1 stops looking different from a P4 — colour is
 * reserved for signal, not decoration.
 */
export function Pill({
  label,
  colour,
  title,
}: {
  label: string;
  colour?: string | null;
  title?: string;
}) {
  return (
    <span className="chip" title={title}>
      <span
        aria-hidden
        className="size-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: colour ?? 'var(--faint)' }}
      />
      {label}
    </span>
  );
}

/** Chip that takes its whole colour from a semantic tone. Use sparingly. */
export function TonePill({
  label,
  tone,
}: {
  label: string;
  tone: 'neutral' | 'success' | 'warning' | 'danger' | 'accent';
}) {
  const tones = {
    neutral: { background: 'var(--subtle)', color: 'var(--muted)', borderColor: 'var(--border)' },
    success: {
      background: 'var(--success-subtle)',
      color: 'var(--success)',
      borderColor: 'transparent',
    },
    warning: {
      background: 'var(--warning-subtle)',
      color: 'var(--warning)',
      borderColor: 'transparent',
    },
    danger: {
      background: 'var(--danger-subtle)',
      color: 'var(--danger)',
      borderColor: 'transparent',
    },
    accent: {
      background: 'var(--accent-subtle)',
      color: 'var(--accent)',
      borderColor: 'transparent',
    },
  } as const;

  return (
    <span className="chip" style={tones[tone]}>
      {label}
    </span>
  );
}
