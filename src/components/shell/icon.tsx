'use client';

import {
  ClipboardList,
  FileBarChart,
  GitPullRequestArrow,
  LayoutDashboard,
  LayoutGrid,
  ScrollText,
  ShieldCheck,
  Sliders,
  Ticket,
} from 'lucide-react';
import type { NavIcon } from '@/components/shell/nav-items';

const ICONS = {
  dashboard: LayoutDashboard,
  tickets: Ticket,
  changes: GitPullRequestArrow,
  reports: FileBarChart,
  overview: LayoutGrid,
  settings: Sliders,
  shield: ShieldCheck,
  groups: ClipboardList,
  audit: ScrollText,
} as const satisfies Record<NavIcon, unknown>;

export function Icon({ name, className }: { name: NavIcon; className?: string }) {
  const Component = ICONS[name];
  return <Component className={className} aria-hidden strokeWidth={1.75} />;
}
