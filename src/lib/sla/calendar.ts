import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';

/**
 * Business-hours arithmetic for SLA targets.
 *
 * Pure functions over a plain calendar description -- no Prisma, no database --
 * so the rules are unit-testable and shared by two consumers:
 *   - the reporting module, which computes SLA attainment on the fly;
 *   - Phase 2, which will persist due dates and run breach sweeps on top.
 *
 * WHY WALL-CLOCK MINUTES: working hours are stored as minutes-from-midnight in
 * the calendar's own zone rather than as timestamps. "08:00 in Nairobi" and
 * "08:00 in Johannesburg" are different instants, and a UTC timestamp cannot
 * express "the office opens at 8" without breaking the moment a zone shifts.
 *
 * ASSUMPTION (OPEN-QUESTIONS.md Q2, unanswered): a ticket raised outside
 * working hours has its clock start at the next opening time, not immediately.
 * `businessMinutesBetween` therefore reports 0 for a Saturday-only interval.
 * Change `START_AT_NEXT_OPENING` if the answer comes back differently.
 */

export const START_AT_NEXT_OPENING = true;

/** One weekday's working window. dayOfWeek: 0 = Sunday (matches Date#getDay). */
export type WorkingDay = {
  dayOfWeek: number;
  isWorkingDay: boolean;
  /** Minutes from local midnight, e.g. 480 = 08:00. */
  startMinute: number;
  endMinute: number;
};

export type BusinessCalendar = {
  /** IANA zone, e.g. "Africa/Nairobi". */
  timeZone: string;
  workingHours: WorkingDay[];
  /** Fixed-date holidays as local `yyyy-MM-dd`. */
  holidays: ReadonlySet<string>;
  /** Holidays that recur annually, as local `MM-dd`. */
  recurringHolidays: ReadonlySet<string>;
};

/** A 24/7 calendar: every minute counts. Used when businessHoursOnly is false. */
export const ALWAYS_OPEN: BusinessCalendar = {
  timeZone: 'UTC',
  workingHours: Array.from({ length: 7 }, (_, dayOfWeek) => ({
    dayOfWeek,
    isWorkingDay: true,
    startMinute: 0,
    endMinute: 24 * 60,
  })),
  holidays: new Set(),
  recurringHolidays: new Set(),
};

/**
 * Build a calendar from the shapes Prisma returns.
 *
 * `@db.Date` columns come back as a Date at UTC midnight, so the local date is
 * read with UTC accessors -- using local ones would shift the day for anyone
 * running the app in a negative-offset zone.
 */
export function buildCalendar(input: {
  timeZone: string;
  workingHours: Array<{
    dayOfWeek: number;
    isWorkingDay: boolean;
    startMinute: number;
    endMinute: number;
  }>;
  holidays: Array<{ date: Date; isRecurring: boolean }>;
}): BusinessCalendar {
  const holidays = new Set<string>();
  const recurringHolidays = new Set<string>();

  for (const holiday of input.holidays) {
    const month = String(holiday.date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(holiday.date.getUTCDate()).padStart(2, '0');
    if (holiday.isRecurring) {
      recurringHolidays.add(`${month}-${day}`);
    } else {
      holidays.add(`${holiday.date.getUTCFullYear()}-${month}-${day}`);
    }
  }

  return {
    timeZone: input.timeZone,
    workingHours: [...input.workingHours],
    holidays,
    recurringHolidays,
  };
}

type LocalDay = { date: string; dayOfWeek: number; minuteOfDay: number };

/** Decompose an instant into the calendar's local date, weekday and minute. */
function localParts(at: Date, calendar: BusinessCalendar): LocalDay {
  const formatted = formatInTimeZone(at, calendar.timeZone, 'yyyy-MM-dd HH:mm i');
  const [date, time, isoWeekday] = formatted.split(' ') as [string, string, string];
  const [hours, minutes] = time.split(':').map(Number) as [number, number];
  // date-fns `i` is ISO weekday 1..7 (Mon..Sun); convert to 0..6 (Sun..Sat).
  const iso = Number(isoWeekday);
  return { date, dayOfWeek: iso === 7 ? 0 : iso, minuteOfDay: hours * 60 + minutes };
}

function isHoliday(date: string, calendar: BusinessCalendar): boolean {
  return calendar.holidays.has(date) || calendar.recurringHolidays.has(date.slice(5));
}

/** The working window for a given local date, or null if it is not a working day. */
function windowFor(
  date: string,
  dayOfWeek: number,
  calendar: BusinessCalendar,
): { startMinute: number; endMinute: number } | null {
  if (isHoliday(date, calendar)) return null;

  const day = calendar.workingHours.find((entry) => entry.dayOfWeek === dayOfWeek);
  if (!day || !day.isWorkingDay) return null;
  if (day.endMinute <= day.startMinute) return null;

  return { startMinute: day.startMinute, endMinute: day.endMinute };
}

/** Convert a local date + minute-of-day back into an instant. */
function instantAt(date: string, minuteOfDay: number, calendar: BusinessCalendar): Date {
  const hours = String(Math.floor(minuteOfDay / 60)).padStart(2, '0');
  const minutes = String(minuteOfDay % 60).padStart(2, '0');
  return fromZonedTime(`${date} ${hours}:${minutes}:00`, calendar.timeZone);
}

function nextDate(date: string): string {
  // Pure date arithmetic in UTC: safe because we only ever move whole days and
  // re-resolve the zone offset when converting back to an instant.
  const next = new Date(`${date}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

/** Guard against a misconfigured calendar (no working days) spinning forever. */
const MAX_DAYS = 400;

export function isWithinBusinessHours(at: Date, calendar: BusinessCalendar): boolean {
  const { date, dayOfWeek, minuteOfDay } = localParts(at, calendar);
  const window = windowFor(date, dayOfWeek, calendar);
  if (!window) return false;
  return minuteOfDay >= window.startMinute && minuteOfDay < window.endMinute;
}

/**
 * The first instant at or after `at` that falls inside working hours.
 * Returns null if the calendar has no working day in the next MAX_DAYS.
 */
export function nextOpening(at: Date, calendar: BusinessCalendar): Date | null {
  let { date, dayOfWeek, minuteOfDay } = localParts(at, calendar);

  for (let index = 0; index < MAX_DAYS; index += 1) {
    const window = windowFor(date, dayOfWeek, calendar);
    if (window) {
      if (minuteOfDay < window.startMinute) return instantAt(date, window.startMinute, calendar);
      if (minuteOfDay < window.endMinute) return at;
    }
    date = nextDate(date);
    dayOfWeek = (dayOfWeek + 1) % 7;
    minuteOfDay = 0;
  }

  return null;
}

/**
 * Add `minutes` of working time to `start`.
 *
 * Returns null only if the calendar defines no reachable working time.
 */
export function addBusinessMinutes(
  start: Date,
  minutes: number,
  calendar: BusinessCalendar,
): Date | null {
  if (minutes <= 0) return START_AT_NEXT_OPENING ? nextOpening(start, calendar) : start;

  const opening = START_AT_NEXT_OPENING ? nextOpening(start, calendar) : start;
  if (!opening) return null;

  let { date, dayOfWeek, minuteOfDay } = localParts(opening, calendar);
  let remaining = minutes;

  for (let index = 0; index < MAX_DAYS; index += 1) {
    const window = windowFor(date, dayOfWeek, calendar);
    if (window) {
      const from = Math.max(minuteOfDay, window.startMinute);
      const available = window.endMinute - from;
      if (available > 0) {
        if (remaining <= available) {
          return instantAt(date, from + remaining, calendar);
        }
        remaining -= available;
      }
    }
    date = nextDate(date);
    dayOfWeek = (dayOfWeek + 1) % 7;
    minuteOfDay = 0;
  }

  return null;
}

/**
 * Working minutes elapsed between two instants. Negative intervals return 0.
 *
 * This is the measure SLA attainment is reported against: a ticket open over a
 * weekend has consumed no SLA budget.
 */
export function businessMinutesBetween(from: Date, to: Date, calendar: BusinessCalendar): number {
  if (to <= from) return 0;

  let cursor = localParts(from, calendar);
  const end = localParts(to, calendar);
  let total = 0;

  for (let index = 0; index < MAX_DAYS; index += 1) {
    const window = windowFor(cursor.date, cursor.dayOfWeek, calendar);

    if (window) {
      const dayStart = Math.max(cursor.minuteOfDay, window.startMinute);
      const dayEnd =
        cursor.date === end.date ? Math.min(end.minuteOfDay, window.endMinute) : window.endMinute;
      if (dayEnd > dayStart) total += dayEnd - dayStart;
    }

    if (cursor.date === end.date) return total;

    cursor = {
      date: nextDate(cursor.date),
      dayOfWeek: (cursor.dayOfWeek + 1) % 7,
      minuteOfDay: 0,
    };
  }

  return total;
}
