'use client';

import { createContext, useCallback, useContext, useEffect, useState, useTransition } from 'react';
import { setSidebarAction } from '@/server/actions/preferences';

type ShellContextValue = {
  /** Desktop rail collapsed to icons. Persisted in the hd.sidebar cookie. */
  collapsed: boolean;
  setCollapsed: (collapsed: boolean) => void;
  /** Mobile drawer. Ephemeral. */
  mobileOpen: boolean;
  setMobileOpen: (open: boolean) => void;
  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
};

const ShellContext = createContext<ShellContextValue | null>(null);

/**
 * Shell-wide UI state. The collapsed flag is mirrored onto <html> as
 * `data-sidebar`, which is what the CSS reads to swap `--sidebar-width`, so
 * the content column moves with the rail and the server-rendered first paint
 * already has the right width.
 */
export function ShellProvider({
  initialCollapsed,
  children,
}: {
  initialCollapsed: boolean;
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsedState] = useState(initialCollapsed);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [, startTransition] = useTransition();

  useEffect(() => {
    document.documentElement.dataset.sidebar = collapsed ? 'collapsed' : 'expanded';
  }, [collapsed]);

  // Global ⌘K / Ctrl+K. Registered once; the handler only toggles state.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const setCollapsed = useCallback((next: boolean) => {
    setCollapsedState(next);
    startTransition(async () => {
      await setSidebarAction(next ? 'collapsed' : 'expanded');
    });
  }, []);

  return (
    <ShellContext.Provider
      value={{ collapsed, setCollapsed, mobileOpen, setMobileOpen, paletteOpen, setPaletteOpen }}
    >
      {children}
    </ShellContext.Provider>
  );
}

export function useShell(): ShellContextValue {
  const value = useContext(ShellContext);
  if (!value) throw new Error('useShell must be used inside <ShellProvider>');
  return value;
}
