import { z } from 'zod';

/**
 * Per-user presentation preferences.
 *
 * Stored in cookies rather than localStorage because every page is a Server
 * Component: the server reads the cookie and stamps `data-theme` /
 * `data-density` on <html>, so the first paint is already right and there is
 * no flash or layout shift. A JWT session would also work, but preferences
 * are not identity and should not force a token refresh.
 *
 * TODO(preferences-db): a `UserPreference` row would sync across devices.
 * Deliberately not built yet -- the cookie is enough for one browser.
 */
export const themeSchema = z.enum(['light', 'dark', 'system']);
export type Theme = z.infer<typeof themeSchema>;

export const densitySchema = z.enum(['comfortable', 'compact']);
export type Density = z.infer<typeof densitySchema>;

export type Preferences = { theme: Theme; density: Density };

export const THEME_COOKIE = 'hd.theme';
export const DENSITY_COOKIE = 'hd.density';

export const DEFAULT_PREFERENCES: Preferences = { theme: 'system', density: 'comfortable' };

/** Tolerant: an unknown or tampered value falls back to the default. */
export function parseTheme(raw: string | undefined): Theme {
  const parsed = themeSchema.safeParse(raw);
  return parsed.success ? parsed.data : DEFAULT_PREFERENCES.theme;
}

export function parseDensity(raw: string | undefined): Density {
  const parsed = densitySchema.safeParse(raw);
  return parsed.success ? parsed.data : DEFAULT_PREFERENCES.density;
}

/** Takes a getter so it works with Next's cookie store and in tests alike. */
export function readPreferences(get: (name: string) => string | undefined): Preferences {
  return { theme: parseTheme(get(THEME_COOKIE)), density: parseDensity(get(DENSITY_COOKIE)) };
}
