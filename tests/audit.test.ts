import { describe, expect, it } from 'vitest';
import { auditDiff, sanitiseForAudit } from '@/lib/audit';

describe('sanitiseForAudit', () => {
  it('redacts secret-bearing fields', () => {
    const result = sanitiseForAudit({
      email: 'a@b.c',
      clientSecret: 'super-secret',
      nested: { smtpPassword: 'hunter2', host: 'smtp.example.com' },
    });

    expect(result).toEqual({
      email: 'a@b.c',
      clientSecret: '[redacted]',
      nested: { smtpPassword: '[redacted]', host: 'smtp.example.com' },
    });
  });

  it('serialises dates and bigints so the JSON column accepts them', () => {
    const result = sanitiseForAudit({
      createdAt: new Date('2026-09-10T08:30:00.000Z'),
      count: 10n,
    });

    expect(result).toEqual({ createdAt: '2026-09-10T08:30:00.000Z', count: '10' });
  });

  it('drops functions rather than throwing on them', () => {
    expect(sanitiseForAudit({ keep: 1, drop: () => undefined })).toEqual({ keep: 1 });
  });

  it('walks arrays', () => {
    expect(sanitiseForAudit({ rows: [{ token: 'x' }, { token: 'y' }] })).toEqual({
      rows: [{ token: '[redacted]' }, { token: '[redacted]' }],
    });
  });

  it('returns undefined for nullish input so the column stays NULL', () => {
    expect(sanitiseForAudit(undefined)).toBeUndefined();
    expect(sanitiseForAudit(null)).toBeUndefined();
  });
});

describe('auditDiff', () => {
  it('records only the fields that changed', () => {
    const diff = auditDiff(
      { name: 'IT Help Desk', timeZone: 'Africa/Johannesburg', isActive: true },
      { name: 'IT Service Desk', timeZone: 'Africa/Johannesburg', isActive: true },
    );

    expect(diff).toEqual({
      before: { name: 'IT Help Desk' },
      after: { name: 'IT Service Desk' },
    });
  });

  it('returns undefined when nothing changed, so no audit row is written', () => {
    expect(auditDiff({ name: 'a' }, { name: 'a' })).toBeUndefined();
  });

  it('treats null and undefined as equivalent', () => {
    expect(auditDiff({ description: null }, { description: undefined })).toBeUndefined();
  });

  it('records a creation as an empty before', () => {
    expect(auditDiff(null, { name: 'New group' })).toEqual({
      before: {},
      after: { name: 'New group' },
    });
  });

  it('records a deletion as an empty after', () => {
    expect(auditDiff({ name: 'Old group' }, null)).toEqual({
      before: { name: 'Old group' },
      after: {},
    });
  });

  it('detects a nested object change', () => {
    const diff = auditDiff(
      { filters: { days: 30 } } as Record<string, unknown>,
      { filters: { days: 7 } } as Record<string, unknown>,
    );
    expect(diff?.after).toEqual({ filters: { days: 7 } });
  });
});
