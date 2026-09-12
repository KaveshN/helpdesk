'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { GitPullRequestArrow, Plus, Ticket } from 'lucide-react';
import { Icon } from '@/components/shell/icon';
import type { NavSection } from '@/components/shell/nav-items';
import { useShell } from '@/components/shell/shell-provider';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Pill } from '@/components/ui/pill';
import { ChangeStatusBadge } from '@/components/change-status-badge';
import type { ChangeStatus } from '@/generated/prisma/enums';

export type SearchResults = {
  tickets: Array<{
    id: string;
    reference: string;
    subject: string;
    status: string;
    statusColour: string | null;
  }>;
  changes: Array<{ id: string; reference: string; title: string; status: ChangeStatus }>;
};

export type QuickActions = { canCreateTicket: boolean; canCreateChange: boolean };

/**
 * ⌘K palette: jump to a ticket or change by reference or words, or to any
 * page the actor can reach. Records come from /api/search, which runs the
 * same scoped, permission-aware list queries as the pages, so the palette
 * never shows something the list would hide.
 *
 * cmdk's own fuzzy filter is off: server results are already filtered, and
 * navigation items are matched here with a plain substring so "aud" finds
 * "Audit trail" without ranking surprises.
 */
export function CommandPalette({
  sections,
  quickActions,
}: {
  sections: NavSection[];
  quickActions: QuickActions;
}) {
  const { paletteOpen, setPaletteOpen } = useShell();
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResults | null>(null);
  const [searching, setSearching] = useState(false);
  const latest = useRef(0);

  // Debounced search. State is only set from the resolved fetch, never
  // synchronously in the effect body.
  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) return;
    const requestId = ++latest.current;
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(term)}`);
        if (requestId !== latest.current) return;
        setResults(response.ok ? ((await response.json()) as SearchResults) : null);
      } catch {
        if (requestId === latest.current) setResults(null);
      } finally {
        if (requestId === latest.current) setSearching(false);
      }
    }, 180);
    return () => clearTimeout(timer);
  }, [query]);

  function onQueryChange(value: string) {
    setQuery(value);
    if (value.trim().length < 2) {
      latest.current += 1;
      setResults(null);
      setSearching(false);
    }
  }

  function go(href: string) {
    setPaletteOpen(false);
    setQuery('');
    setResults(null);
    router.push(href);
  }

  const term = query.trim().toLowerCase();
  const navItems = sections
    .flatMap((section) => section.items)
    .filter((item) => !term || item.label.toLowerCase().includes(term));
  const hasRecords = Boolean(results && (results.tickets.length || results.changes.length));
  const showActions = !term || 'new ticket'.includes(term) || 'raise a change'.includes(term);

  return (
    <Dialog open={paletteOpen} onOpenChange={setPaletteOpen}>
      <DialogContent
        className="top-[15%] translate-y-0 overflow-hidden p-0 sm:max-w-xl"
        showCloseButton={false}
      >
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <DialogDescription className="sr-only">
          Jump to a ticket, a change request or a page
        </DialogDescription>
        <Command shouldFilter={false} loop className="[&_[cmdk-group-heading]]:text-2xs">
          <CommandInput
            placeholder="Search tickets and changes, or jump to a page…"
            value={query}
            onValueChange={onQueryChange}
          />
          <CommandList className="max-h-[60vh]">
            <CommandEmpty>
              {searching
                ? 'Searching…'
                : term.length >= 2
                  ? 'Nothing matches.'
                  : 'Type a reference or a few words.'}
            </CommandEmpty>

            {results?.tickets.length ? (
              <CommandGroup heading="Tickets">
                {results.tickets.map((ticket) => (
                  <CommandItem
                    key={ticket.id}
                    value={`ticket-${ticket.id}`}
                    onSelect={() => go(`/tickets/${ticket.id}`)}
                  >
                    <Ticket aria-hidden />
                    <span className="font-mono text-xs">{ticket.reference}</span>
                    <span className="min-w-0 flex-1 truncate">{ticket.subject}</span>
                    <Pill label={ticket.status} colour={ticket.statusColour} />
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}

            {results?.changes.length ? (
              <CommandGroup heading="Change requests">
                {results.changes.map((change) => (
                  <CommandItem
                    key={change.id}
                    value={`change-${change.id}`}
                    onSelect={() => go(`/changes/${change.id}`)}
                  >
                    <GitPullRequestArrow aria-hidden />
                    <span className="font-mono text-xs">{change.reference}</span>
                    <span className="min-w-0 flex-1 truncate">{change.title}</span>
                    <ChangeStatusBadge status={change.status} />
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}

            {hasRecords ? <CommandSeparator /> : null}

            {showActions && (quickActions.canCreateTicket || quickActions.canCreateChange) ? (
              <CommandGroup heading="Actions">
                {quickActions.canCreateTicket ? (
                  <CommandItem value="action-new-ticket" onSelect={() => go('/tickets/new')}>
                    <Plus aria-hidden />
                    New ticket
                  </CommandItem>
                ) : null}
                {quickActions.canCreateChange ? (
                  <CommandItem value="action-new-change" onSelect={() => go('/changes/new')}>
                    <Plus aria-hidden />
                    Raise a change
                  </CommandItem>
                ) : null}
              </CommandGroup>
            ) : null}

            {navItems.length ? (
              <CommandGroup heading="Go to">
                {navItems.map((item) => (
                  <CommandItem
                    key={item.href}
                    value={`nav-${item.href}`}
                    onSelect={() => go(item.href)}
                  >
                    <Icon name={item.icon} className="size-4" />
                    {item.label}
                    {item.badge ? (
                      <span className="ml-auto text-xs text-warning">
                        {item.badge} awaiting you
                      </span>
                    ) : null}
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
