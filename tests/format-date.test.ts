import { describe, expect, it } from 'vitest';
import {
  formatDate,
  formatDateTime,
  formatDuration,
  formatRelative,
  slaCountdown,
} from '@/lib/format/date';

const instant = new Date('2026-09-12T08:30:00Z');

describe('date formatting', () => {
  it('renders in the given zone, not the process zone', () => {
    expect(formatDateTime(instant, 'Africa/Johannesburg')).toBe('2026-09-12 10:30');
    expect(formatDateTime(instant, 'UTC')).toBe('2026-09-12 08:30');
    expect(formatDateTime(instant)).toBe('2026-09-12 08:30');
  });

  it('crosses midnight when the zone says so', () => {
    expect(formatDate(new Date('2026-09-12T23:30:00Z'), 'Africa/Nairobi')).toBe('2026-09-13');
  });

  it('gives strict relative phrasing', () => {
    expect(formatRelative(new Date('2026-09-12T05:30:00Z'), instant)).toBe('3 hours ago');
    expect(formatRelative(new Date('2026-09-14T08:30:00Z'), instant)).toBe('in 2 days');
  });
});

describe('formatDuration', () => {
  it.each([
    [0, '<1m'],
    [15, '15m'],
    [60, '1h'],
    [195, '3h 15m'],
    [1440, '1d'],
    [1620, '1d 3h'],
    [-5, '<1m'],
  ])('%s minutes -> %s', (minutes, expected) => {
    expect(formatDuration(minutes)).toBe(expected);
  });
});

describe('slaCountdown', () => {
  it('has no opinion when there is no target', () => {
    expect(slaCountdown({ dueAt: null, now: instant })).toMatchObject({
      state: 'none',
      tone: 'neutral',
      label: '—',
      remainingMinutes: null,
    });
  });

  it('is green with plenty of time', () => {
    const due = new Date(instant.getTime() + 5 * 60 * 60 * 1000);
    expect(slaCountdown({ dueAt: due, now: instant })).toMatchObject({
      state: 'ok',
      tone: 'success',
      label: '5h left',
    });
  });

  it('turns amber inside the warning window and red once breached', () => {
    const soon = new Date(instant.getTime() + 40 * 60 * 1000);
    expect(slaCountdown({ dueAt: soon, now: instant })).toMatchObject({
      state: 'warning',
      tone: 'warning',
      label: '40m left',
    });

    const late = new Date(instant.getTime() - 135 * 60 * 1000);
    expect(slaCountdown({ dueAt: late, now: instant })).toMatchObject({
      state: 'breached',
      tone: 'destructive',
      label: '2h 15m over',
      remainingMinutes: -135,
    });
  });

  it('honours a custom warning window', () => {
    const due = new Date(instant.getTime() + 3 * 60 * 60 * 1000);
    expect(slaCountdown({ dueAt: due, now: instant, warningMinutes: 240 }).state).toBe('warning');
  });
});
