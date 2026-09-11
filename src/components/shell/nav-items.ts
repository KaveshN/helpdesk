/**
 * Navigation model.
 *
 * Plain serialisable data, built on the server from capabilities and handed to
 * the client sidebar — a Server Component cannot pass functions or components
 * across the boundary, so icons travel as a name and are resolved client-side.
 */
export type NavIcon =
  | 'dashboard'
  | 'tickets'
  | 'changes'
  | 'reports'
  | 'overview'
  | 'settings'
  | 'shield'
  | 'groups'
  | 'audit';

export type NavItem = {
  href: string;
  label: string;
  icon: NavIcon;
  /** Rendered as a count pill, e.g. changes awaiting your CAB vote. */
  badge?: number;
};

export type NavSection = {
  /** Omitted for the first group, which needs no heading. */
  title?: string;
  items: NavItem[];
};
