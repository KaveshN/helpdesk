'use server';

import { cookies } from 'next/headers';
import {
  DENSITY_COOKIE,
  THEME_COOKIE,
  densitySchema,
  themeSchema,
  type Density,
  type Theme,
} from '@/lib/preferences/schema';
import { runAction, type ActionResult } from '@/server/actions/result';
import { ValidationError } from '@/lib/errors';

const ONE_YEAR = 60 * 60 * 24 * 365;

async function setPreferenceCookie(name: string, value: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(name, value, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: ONE_YEAR,
  });
}

/**
 * No sign-in required: a preference is not data, and the login page has a
 * theme toggle too. The value is validated because the cookie is the only
 * thing between the request and the <html> attribute.
 */
export async function setThemeAction(raw: string): Promise<ActionResult<{ theme: Theme }>> {
  return runAction('preferences.setTheme', async () => {
    const parsed = themeSchema.safeParse(raw);
    if (!parsed.success) throw new ValidationError('Unknown theme', { theme: ['Unknown theme'] });
    await setPreferenceCookie(THEME_COOKIE, parsed.data);
    return { theme: parsed.data };
  });
}

export async function setDensityAction(raw: string): Promise<ActionResult<{ density: Density }>> {
  return runAction('preferences.setDensity', async () => {
    const parsed = densitySchema.safeParse(raw);
    if (!parsed.success) {
      throw new ValidationError('Unknown density', { density: ['Unknown density'] });
    }
    await setPreferenceCookie(DENSITY_COOKIE, parsed.data);
    return { density: parsed.data };
  });
}
