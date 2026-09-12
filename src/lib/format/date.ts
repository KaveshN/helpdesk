import { differenceInMinutes, formatDistanceStrict } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';
import type { Tone } from '@/lib/design/tones';

/**
 * The one place dates become strings for the UI.
 *
 * Every help desk group has its own IANA zone (`HelpDeskGroup.timeZone`), so
 * callers pass it explicitly; UTC is the fallback, never the browser's zone
 * -- a Server Component has no browser.
 */
export const DEFAULT_TIME_ZONE = 'UTC';

export function formatDate(value: Date, timeZone: string = DEFAULT_TIME_ZONE): string {
  return formatInTimeZone(value, timeZone, 'yyyy-MM-dd');
}

export function formatDateTime(value: Date, timeZone: string = DEFAULT_TIME_ZONE): string {
  return formatInTimeZone(value, timeZone, 'yyyy-MM-dd HH:mm');
}

/** "3 hours ago", "in 2 days". Strict: no "about", no "almost". */
export function formatRelative(value: Date, now: Date = new Date()): string {
  return formatDistanceStrict(value, now, { addSuffix: true });
}

/** Whole minutes to a compact "2d 3h" / "3h 15m" / "15m" / "<1m". */
export function formatDuration(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  if (total < 1) return '<1m';
  const days = Math.floor(total / 1440);
  const hours = Math.floor((total % 1440) / 60);
  const mins = total % 60;
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  return `${mins}m`;
}

export type SlaState = 'none' | 'ok' | 'warning' | 'breached';

export type SlaCountdown = {
  state: SlaState;
  tone: Tone;
  /** Ready to render: "2h 15m left", "40m over", or "—" when there is no target. */
  label: string;
  remainingMinutes: number | null;
};

/**
 * Green -> amber -> red as a due time approaches.
 *
 * `warningMinutes` is absolute rather than a percentage because the list
 * query does not carry the SLA start time; when Phase 2 persists targets,
 * pass `warningThresholdPct` through here instead of changing the callers.
 * A null due date is "no SLA" and must never read as "met" (invariant 9).
 */
export function slaCountdown({
  dueAt,
  now = new Date(),
  warningMinutes = 60,
}: {
  dueAt: Date | null | undefined;
  now?: Date;
  warningMinutes?: number;
}): SlaCountdown {
  if (!dueAt) return { state: 'none', tone: 'neutral', label: '—', remainingMinutes: null };

  const remaining = differenceInMinutes(dueAt, now);
  if (remaining < 0) {
    return {
      state: 'breached',
      tone: 'destructive',
      label: `${formatDuration(-remaining)} over`,
      remainingMinutes: remaining,
    };
  }
  if (remaining <= warningMinutes) {
    return {
      state: 'warning',
      tone: 'warning',
      label: `${formatDuration(remaining)} left`,
      remainingMinutes: remaining,
    };
  }
  return {
    state: 'ok',
    tone: 'success',
    label: `${formatDuration(remaining)} left`,
    remainingMinutes: remaining,
  };
}
