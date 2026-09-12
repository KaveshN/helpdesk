import { cn } from '@/lib/utils';
import { TONE_CHIP, TONE_DOT, type Tone } from '@/lib/design/tones';

/**
 * Status / priority chip.
 *
 * The chip itself stays neutral and a coloured dot carries the meaning. A wall
 * of saturated badges is how a P1 stops looking different from a P4 -- colour
 * is reserved for signal, not decoration.
 *
 * `colour` is the row's own value from the database (statuses, priorities and
 * risk levels are per-group config), which is the one legitimate inline style
 * in the codebase: it is data, not styling. `tone` is the fallback when a row
 * has no colour or when the meaning is fixed in code (SLA state).
 */
export function Pill({
  label,
  colour,
  tone = 'neutral',
  title,
  className,
}: {
  label: string;
  colour?: string | null;
  tone?: Tone;
  title?: string;
  className?: string;
}) {
  return (
    <span className={cn('chip', className)} title={title}>
      <span
        aria-hidden
        className={cn('size-1.5 shrink-0 rounded-full', colour ? undefined : TONE_DOT[tone])}
        style={colour ? { backgroundColor: colour } : undefined}
      />
      {label}
    </span>
  );
}

/** Chip that takes its whole colour from a semantic tone. Use sparingly. */
export function TonePill({
  label,
  tone,
  className,
}: {
  label: string;
  tone: Tone;
  className?: string;
}) {
  return <span className={cn('chip', TONE_CHIP[tone], className)}>{label}</span>;
}
