import { describe, expect, it } from 'vitest';
import { formatTicketReference, parseTicketReference } from '@/lib/tickets/reference';

describe('formatTicketReference', () => {
  it('zero-pads to six digits', () => {
    expect(formatTicketReference('ITHD', 1)).toBe('ITHD-000001');
    expect(formatTicketReference('KEN', 42)).toBe('KEN-000042');
  });

  it('does not truncate once the sequence outgrows six digits', () => {
    expect(formatTicketReference('ITHD', 1_234_567)).toBe('ITHD-1234567');
  });

  it('keeps each group in its own numbering space', () => {
    // Same sequence number, different groups: the prefix is what disambiguates,
    // which is why references are unique platform-wide.
    expect(formatTicketReference('ITHD', 7)).not.toBe(formatTicketReference('KEN', 7));
  });
});

describe('parseTicketReference', () => {
  it('round-trips a formatted reference', () => {
    expect(parseTicketReference(formatTicketReference('ITHD', 123))).toEqual({
      groupKey: 'ITHD',
      sequence: 123,
    });
  });

  it('accepts lowercase and surrounding whitespace', () => {
    expect(parseTicketReference('  ithd-000123 ')).toEqual({ groupKey: 'ITHD', sequence: 123 });
  });

  it('rejects anything that is not a reference', () => {
    for (const input of ['', 'ITHD', '000123', 'ITHD_000123', 'I-1', 'ITHD-', 'ITHD-abc']) {
      expect(parseTicketReference(input), input).toBeNull();
    }
  });
});
