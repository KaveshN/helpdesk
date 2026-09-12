import { describe, expect, it } from 'vitest';
import {
  DENSITY_COOKIE,
  THEME_COOKIE,
  parseDensity,
  parseTheme,
  readPreferences,
} from '@/lib/preferences/schema';

describe('preference parsing', () => {
  it('accepts the known values', () => {
    expect(parseTheme('dark')).toBe('dark');
    expect(parseTheme('light')).toBe('light');
    expect(parseTheme('system')).toBe('system');
    expect(parseDensity('compact')).toBe('compact');
  });

  it('falls back to defaults on missing or tampered cookies', () => {
    expect(parseTheme(undefined)).toBe('system');
    expect(parseTheme('<script>')).toBe('system');
    expect(parseDensity('tiny')).toBe('comfortable');
  });

  it('reads both cookies through a getter', () => {
    const jar: Record<string, string> = { [THEME_COOKIE]: 'dark', [DENSITY_COOKIE]: 'compact' };
    expect(readPreferences((name) => jar[name])).toEqual({ theme: 'dark', density: 'compact' });
    expect(readPreferences(() => undefined)).toEqual({ theme: 'system', density: 'comfortable' });
  });
});
