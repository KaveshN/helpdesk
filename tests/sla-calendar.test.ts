import { describe, expect, it } from 'vitest';
import {
  ALWAYS_OPEN,
  addBusinessMinutes,
  buildCalendar,
  businessMinutesBetween,
  isWithinBusinessHours,
  nextOpening,
  type BusinessCalendar,
} from '@/lib/sla/calendar';

/** Mon-Fri 08:00-17:00 (540 working minutes/day) in the given zone. */
function officeHours(timeZone: string, holidays: string[] = [], recurring: string[] = []): BusinessCalendar {
  return {
    timeZone,
    workingHours: Array.from({ length: 7 }, (_, dayOfWeek) => ({
      dayOfWeek,
      isWorkingDay: dayOfWeek >= 1 && dayOfWeek <= 5,
      startMinute: dayOfWeek >= 1 && dayOfWeek <= 5 ? 8 * 60 : 0,
      endMinute: dayOfWeek >= 1 && dayOfWeek <= 5 ? 17 * 60 : 0,
    })),
    holidays: new Set(holidays),
    recurringHolidays: new Set(recurring),
  };
}

const JHB = officeHours('Africa/Johannesburg'); // UTC+2, no DST
const NBO = officeHours('Africa/Nairobi'); // UTC+3, no DST

// 2026-09-14 is a Monday; 2026-09-12/13 are Sat/Sun.
const monday0900JHB = new Date('2026-09-14T07:00:00.000Z'); // 09:00 local
const sunday0200JHB = new Date('2026-09-13T00:00:00.000Z'); // 02:00 local Sunday

describe('isWithinBusinessHours', () => {
  it('is true inside the window on a working day', () => {
    expect(isWithinBusinessHours(monday0900JHB, JHB)).toBe(true);
  });

  it('is false before opening and at/after closing', () => {
    expect(isWithinBusinessHours(new Date('2026-09-14T05:30:00.000Z'), JHB)).toBe(false); // 07:30
    expect(isWithinBusinessHours(new Date('2026-09-14T15:00:00.000Z'), JHB)).toBe(false); // 17:00 exactly
    expect(isWithinBusinessHours(new Date('2026-09-14T14:59:00.000Z'), JHB)).toBe(true); // 16:59
  });

  it('is false at weekends', () => {
    expect(isWithinBusinessHours(sunday0200JHB, JHB)).toBe(false);
    expect(isWithinBusinessHours(new Date('2026-09-12T10:00:00.000Z'), JHB)).toBe(false);
  });

  it('respects the calendar zone, not the server zone', () => {
    // 06:30 UTC is 08:30 in Johannesburg (open) but 09:30 in Nairobi (also open);
    // 05:30 UTC is 07:30 JHB (shut) and 08:30 NBO (open). Same instant, different answers.
    const at = new Date('2026-09-14T05:30:00.000Z');
    expect(isWithinBusinessHours(at, JHB)).toBe(false);
    expect(isWithinBusinessHours(at, NBO)).toBe(true);
  });

  it('treats a fixed holiday as closed', () => {
    const withHoliday = officeHours('Africa/Johannesburg', ['2026-09-14']);
    expect(isWithinBusinessHours(monday0900JHB, withHoliday)).toBe(false);
  });

  it('treats a recurring holiday as closed in any year', () => {
    const withRecurring = officeHours('Africa/Johannesburg', [], ['09-14']);
    expect(isWithinBusinessHours(monday0900JHB, withRecurring)).toBe(false);
    expect(isWithinBusinessHours(new Date('2030-09-16T07:00:00.000Z'), withRecurring)).toBe(true);
  });

  it('is always true for the 24/7 calendar', () => {
    expect(isWithinBusinessHours(sunday0200JHB, ALWAYS_OPEN)).toBe(true);
  });
});

describe('nextOpening', () => {
  it('returns the instant itself when already open', () => {
    expect(nextOpening(monday0900JHB, JHB)?.toISOString()).toBe(monday0900JHB.toISOString());
  });

  it('rolls a Sunday 02:00 ticket forward to Monday 08:00 local', () => {
    // The Q2 assumption, pinned: out-of-hours work starts at the next opening.
    const opening = nextOpening(sunday0200JHB, JHB);
    expect(opening?.toISOString()).toBe('2026-09-14T06:00:00.000Z'); // 08:00 SAST
  });

  it('rolls past a holiday to the next working day', () => {
    const withHoliday = officeHours('Africa/Johannesburg', ['2026-09-14']);
    expect(nextOpening(sunday0200JHB, withHoliday)?.toISOString()).toBe('2026-09-15T06:00:00.000Z');
  });

  it('returns null when the calendar never opens', () => {
    const never: BusinessCalendar = {
      ...JHB,
      workingHours: JHB.workingHours.map((day) => ({ ...day, isWorkingDay: false })),
    };
    expect(nextOpening(monday0900JHB, never)).toBeNull();
  });
});

describe('addBusinessMinutes', () => {
  it('stays inside the same day when there is room', () => {
    // Monday 09:00 + 120 working minutes = Monday 11:00 local (09:00 UTC).
    expect(addBusinessMinutes(monday0900JHB, 120, JHB)?.toISOString()).toBe(
      '2026-09-14T09:00:00.000Z',
    );
  });

  it('lands exactly on closing time without spilling', () => {
    // 09:00 + 480 = 17:00 local, which is the close boundary.
    expect(addBusinessMinutes(monday0900JHB, 480, JHB)?.toISOString()).toBe(
      '2026-09-14T15:00:00.000Z',
    );
  });

  it('spills into the next working day', () => {
    // 09:00 Mon + 481 minutes: 480 fills Monday, 1 lands Tuesday 08:01.
    expect(addBusinessMinutes(monday0900JHB, 481, JHB)?.toISOString()).toBe(
      '2026-09-15T06:01:00.000Z',
    );
  });

  it('skips the weekend', () => {
    // Friday 16:00 local + 120 minutes: 60 on Friday, 60 on Monday -> Mon 09:00.
    const friday1600 = new Date('2026-09-18T14:00:00.000Z');
    expect(addBusinessMinutes(friday1600, 120, JHB)?.toISOString()).toBe(
      '2026-09-21T07:00:00.000Z',
    );
  });

  it('starts an out-of-hours ticket at the next opening', () => {
    // Sunday 02:00 + 60 -> Monday 09:00 local, NOT Sunday 03:00.
    expect(addBusinessMinutes(sunday0200JHB, 60, JHB)?.toISOString()).toBe(
      '2026-09-14T07:00:00.000Z',
    );
  });

  it('skips a public holiday', () => {
    // 2026-04-27 is Freedom Day (Mon) in the SA seed calendar.
    const withHoliday = officeHours('Africa/Johannesburg', ['2026-04-27']);
    const friday24th1600 = new Date('2026-04-24T14:00:00.000Z'); // Fri 16:00 local
    // 60 mins Friday, then Monday is a holiday, so the rest lands Tuesday 08:00.
    expect(addBusinessMinutes(friday24th1600, 60, withHoliday)?.toISOString()).toBe(
      '2026-04-24T15:00:00.000Z',
    );
    expect(addBusinessMinutes(friday24th1600, 61, withHoliday)?.toISOString()).toBe(
      '2026-04-28T06:01:00.000Z',
    );
  });

  it('gives South Africa and Kenya different answers for the same input', () => {
    // The regional difference the brief calls out: identical policy, identical
    // instant, two-hour-apart offsets -> different due timestamps.
    const jhbDue = addBusinessMinutes(sunday0200JHB, 60, JHB);
    const nboDue = addBusinessMinutes(sunday0200JHB, 60, NBO);
    expect(jhbDue?.toISOString()).toBe('2026-09-14T07:00:00.000Z'); // 09:00 SAST
    expect(nboDue?.toISOString()).toBe('2026-09-14T06:00:00.000Z'); // 09:00 EAT
    expect(jhbDue).not.toEqual(nboDue);
  });

  it('is linear for the 24/7 calendar', () => {
    expect(addBusinessMinutes(sunday0200JHB, 90, ALWAYS_OPEN)?.toISOString()).toBe(
      '2026-09-13T01:30:00.000Z',
    );
  });

  it('returns null for an unreachable calendar', () => {
    const never: BusinessCalendar = {
      ...JHB,
      workingHours: JHB.workingHours.map((day) => ({ ...day, isWorkingDay: false })),
    };
    expect(addBusinessMinutes(monday0900JHB, 60, never)).toBeNull();
  });
});

describe('businessMinutesBetween', () => {
  it('counts minutes inside one day', () => {
    expect(
      businessMinutesBetween(monday0900JHB, new Date('2026-09-14T09:30:00.000Z'), JHB),
    ).toBe(150);
  });

  it('returns 0 for a reversed or empty interval', () => {
    expect(businessMinutesBetween(monday0900JHB, monday0900JHB, JHB)).toBe(0);
    expect(
      businessMinutesBetween(monday0900JHB, new Date('2026-09-13T00:00:00.000Z'), JHB),
    ).toBe(0);
  });

  it('counts a weekend as zero consumed budget', () => {
    // Friday 17:00 local to Monday 08:00 local: no working minutes at all.
    expect(
      businessMinutesBetween(
        new Date('2026-09-18T15:00:00.000Z'),
        new Date('2026-09-21T06:00:00.000Z'),
        JHB,
      ),
    ).toBe(0);
  });

  it('counts a full working day as 540 minutes', () => {
    expect(
      businessMinutesBetween(
        new Date('2026-09-14T06:00:00.000Z'),
        new Date('2026-09-14T15:00:00.000Z'),
        JHB,
      ),
    ).toBe(540);
  });

  it('clips out-of-hours edges', () => {
    // Monday 06:00 local to Monday 20:00 local is still only 540 minutes.
    expect(
      businessMinutesBetween(
        new Date('2026-09-14T04:00:00.000Z'),
        new Date('2026-09-14T18:00:00.000Z'),
        JHB,
      ),
    ).toBe(540);
  });

  it('sums across a week and excludes holidays', () => {
    const withHoliday = officeHours('Africa/Johannesburg', ['2026-09-16']); // Wednesday
    const monOpen = new Date('2026-09-14T06:00:00.000Z');
    const friClose = new Date('2026-09-18T15:00:00.000Z');
    expect(businessMinutesBetween(monOpen, friClose, JHB)).toBe(5 * 540);
    expect(businessMinutesBetween(monOpen, friClose, withHoliday)).toBe(4 * 540);
  });

  it('is the inverse of addBusinessMinutes', () => {
    // Round trip: adding N working minutes then measuring gives N back.
    for (const minutes of [15, 60, 480, 481, 1440, 3000]) {
      const due = addBusinessMinutes(monday0900JHB, minutes, JHB);
      expect(due, `minutes=${minutes}`).not.toBeNull();
      expect(businessMinutesBetween(monday0900JHB, due!, JHB), `minutes=${minutes}`).toBe(minutes);
    }
  });
});

describe('buildCalendar', () => {
  it('reads @db.Date holidays with UTC accessors', () => {
    // Prisma returns a date-only column as UTC midnight. Using local accessors
    // would shift the day for a server in a negative-offset zone.
    const calendar = buildCalendar({
      timeZone: 'Africa/Johannesburg',
      workingHours: JHB.workingHours,
      holidays: [
        { date: new Date('2026-12-25T00:00:00.000Z'), isRecurring: false },
        { date: new Date('2026-01-01T00:00:00.000Z'), isRecurring: true },
      ],
    });

    expect(calendar.holidays.has('2026-12-25')).toBe(true);
    expect(calendar.recurringHolidays.has('01-01')).toBe(true);
    expect(calendar.holidays.has('2026-01-01')).toBe(false);
  });
});
