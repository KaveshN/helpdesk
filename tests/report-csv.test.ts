import { describe, expect, it } from 'vitest';
import { ReportType } from '@/generated/prisma/enums';
import { csvFilename, escapeCsvField, toCsv } from '@/lib/reports/csv';
import type { ReportResult } from '@/lib/reports/types';

const report: ReportResult = {
  type: ReportType.TICKET_VOLUME,
  title: 'Ticket volume',
  description: 'Tickets raised and resolved per day.',
  generatedAt: new Date('2026-09-10T12:00:00.000Z'),
  periodFrom: new Date('2026-08-11T00:00:00.000Z'),
  periodTo: new Date('2026-09-10T00:00:00.000Z'),
  columns: [
    { key: 'day', label: 'Day' },
    { key: 'raised', label: 'Raised', numeric: true },
  ],
  rows: [
    { day: '2026-09-09', raised: 3 },
    { day: '2026-09-10', raised: 0 },
  ],
  totals: { day: 'Total', raised: 3 },
};

describe('escapeCsvField', () => {
  it('leaves plain values alone', () => {
    expect(escapeCsvField('hello')).toBe('hello');
    expect(escapeCsvField(42)).toBe('42');
  });

  it('renders null and undefined as empty', () => {
    expect(escapeCsvField(null)).toBe('');
    expect(escapeCsvField(undefined)).toBe('');
  });

  it('quotes fields containing a comma, quote or newline', () => {
    expect(escapeCsvField('a,b')).toBe('"a,b"');
    expect(escapeCsvField('say "hi"')).toBe('"say ""hi"""');
    expect(escapeCsvField('line1\nline2')).toBe('"line1\nline2"');
  });

  it('neutralises formula injection', () => {
    // A ticket subject of =cmd|... must not execute when opened in Excel.
    expect(escapeCsvField('=1+1')).toBe('\t=1+1');
    expect(escapeCsvField('=HYPERLINK("http://evil","x")')).toBe(
      '"\t=HYPERLINK(""http://evil"",""x"")"',
    );
    expect(escapeCsvField('@SUM(A1)')).toBe('\t@SUM(A1)');
    expect(escapeCsvField('+1234')).toBe('\t+1234');
    expect(escapeCsvField('-1234')).toBe('\t-1234');
  });

  it('does not mangle a value that merely contains a trigger character', () => {
    expect(escapeCsvField('a=b')).toBe('a=b');
  });
});

describe('toCsv', () => {
  const csv = toCsv(report);
  const lines = csv.split('\r\n');

  it('emits a provenance header', () => {
    expect(lines[0]).toBe('# Ticket volume');
    expect(csv).toContain('# Period: 2026-08-11T00:00:00.000Z to 2026-09-10T00:00:00.000Z');
    expect(csv).toContain('# Generated: 2026-09-10T12:00:00.000Z');
  });

  it('writes headers, rows and totals in column order', () => {
    expect(lines[5]).toBe('Day,Raised');
    expect(lines[6]).toBe('2026-09-09,3');
    expect(lines[8]).toBe('Total,3');
  });

  it('uses CRLF line endings and ends with one', () => {
    expect(csv.endsWith('\r\n')).toBe(true);
  });

  it('flattens multi-line notes into the header', () => {
    const withNote = toCsv({ ...report, notes: ['line one\nline two'] });
    expect(withNote).toContain('# Note: line one line two');
  });

  it('emits only the header when there are no rows', () => {
    const empty = toCsv({ ...report, rows: [], totals: undefined });
    expect(empty).toContain('Day,Raised');
    expect(empty.split('\r\n').filter((line) => line && !line.startsWith('#'))).toEqual([
      'Day,Raised',
    ]);
  });

  it('omits a column a row does not define', () => {
    const sparse = toCsv({ ...report, rows: [{ day: '2026-09-09' }], totals: undefined });
    expect(sparse).toContain('2026-09-09,');
  });
});

describe('csvFilename', () => {
  it('slugifies the title with the group and date', () => {
    expect(csvFilename(report, 'ITHD')).toBe('ticket-volume-ithd-2026-09-10.csv');
  });

  it('strips punctuation from the slug', () => {
    expect(csvFilename({ ...report, title: 'SLA performance (live)' }, 'KEN')).toBe(
      'sla-performance-live-ken-2026-09-10.csv',
    );
  });
});
