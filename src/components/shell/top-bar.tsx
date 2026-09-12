'use client';

import { LogOut, Menu, Search } from 'lucide-react';
import { Breadcrumbs } from '@/components/shell/breadcrumbs';
import { useShell } from '@/components/shell/shell-provider';
import { AppearanceMenu } from '@/components/theme/appearance-menu';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/**
 * Sticky top bar: breadcrumbs on the left, search / appearance / account on
 * the right. Chrome stays neutral; the page below owns the title.
 */
export function TopBar({
  user,
  signOut,
}: {
  user: { name: string; email: string; role: string };
  signOut: () => Promise<void>;
}) {
  const { setMobileOpen, setPaletteOpen } = useShell();
  const initials = user.name
    .split(' ')
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();

  return (
    <header className="sticky top-0 z-30 flex h-12 items-center gap-2 border-b bg-background/85 px-3 backdrop-blur sm:px-4 lg:px-6">
      <Button
        variant="ghost"
        size="icon-sm"
        className="lg:hidden"
        onClick={() => setMobileOpen(true)}
        aria-label="Open navigation"
      >
        <Menu />
      </Button>

      <Breadcrumbs className="flex-1" />

      <Button
        variant="outline"
        size="sm"
        onClick={() => setPaletteOpen(true)}
        className="hidden text-muted-foreground sm:inline-flex sm:w-56 sm:justify-start"
      >
        <Search aria-hidden />
        <span className="flex-1 text-left">Search or jump to…</span>
        <kbd className="rounded border bg-muted px-1.5 font-mono text-2xs text-muted-foreground">
          ⌘K
        </kbd>
      </Button>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            className="sm:hidden"
            onClick={() => setPaletteOpen(true)}
            aria-label="Search"
          >
            <Search />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Search (⌘K)</TooltipContent>
      </Tooltip>

      <AppearanceMenu align="end" />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label="Account menu" className="rounded-full">
            <span
              aria-hidden
              className="grid size-7 place-items-center rounded-full bg-muted text-2xs font-semibold text-muted-foreground"
            >
              {initials}
            </span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuLabel className="font-normal">
            <span className="block truncate text-sm font-medium text-foreground">{user.name}</span>
            <span className="block truncate text-xs text-muted-foreground">{user.email}</span>
            <span className="mt-1 block text-2xs tracking-wider text-muted-foreground uppercase">
              {user.role}
            </span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <form action={signOut}>
            <DropdownMenuItem asChild>
              <button type="submit" className="w-full">
                <LogOut aria-hidden />
                Sign out
              </button>
            </DropdownMenuItem>
          </form>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
