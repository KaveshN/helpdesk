'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  useTransition,
} from 'react';
import type { Density, Preferences, Theme } from '@/lib/preferences/schema';
import { setDensityAction, setThemeAction } from '@/server/actions/preferences';

type ResolvedTheme = 'light' | 'dark';

type ThemeContextValue = {
  /** The stored preference: light, dark or system. */
  theme: Theme;
  /** What is actually on screen once "system" is resolved. */
  resolvedTheme: ResolvedTheme;
  density: Density;
  setTheme: (theme: Theme) => void;
  setDensity: (density: Density) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

const DARK_QUERY = '(prefers-color-scheme: dark)';

/**
 * The OS preference as an external store: `useSyncExternalStore` is the
 * React-sanctioned way to read something React does not own, and it gives
 * a server snapshot (light) so hydration is deterministic.
 */
function subscribeToSystemTheme(onChange: () => void): () => void {
  const media = window.matchMedia(DARK_QUERY);
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}
const readSystemDark = () => window.matchMedia(DARK_QUERY).matches;
const serverSystemDark = () => false;

/**
 * Pattern: optimistic UI over a server action. State changes immediately,
 * an effect mirrors it onto <html> (the DOM is the external system here),
 * and the cookie is written in a transition so the next server render
 * agrees. No router refresh is needed -- the change is pure CSS.
 */
export function ThemeProvider({
  initial,
  children,
}: {
  initial: Preferences;
  children: React.ReactNode;
}) {
  const [theme, setThemeState] = useState<Theme>(initial.theme);
  const [density, setDensityState] = useState<Density>(initial.density);
  const [, startTransition] = useTransition();

  const systemDark = useSyncExternalStore(subscribeToSystemTheme, readSystemDark, serverSystemDark);
  const resolvedTheme: ResolvedTheme = theme === 'system' ? (systemDark ? 'dark' : 'light') : theme;

  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
  }, [resolvedTheme]);

  useEffect(() => {
    document.documentElement.dataset.density = density;
  }, [density]);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    startTransition(async () => {
      await setThemeAction(next);
    });
  }, []);

  const setDensity = useCallback((next: Density) => {
    setDensityState(next);
    startTransition(async () => {
      await setDensityAction(next);
    });
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, density, setTheme, setDensity }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useTheme must be used inside <ThemeProvider>');
  return value;
}
