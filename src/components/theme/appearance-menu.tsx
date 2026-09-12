'use client';

import { Monitor, Moon, Rows3, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useTheme } from '@/components/theme/theme-provider';
import { densitySchema, themeSchema } from '@/lib/preferences/schema';

/**
 * Theme (light / dark / system) and density (comfortable / compact) in one
 * menu. Radix handles roving focus, Escape and typeahead; the trigger is a
 * real button so it sits in the tab order.
 *
 * The sun/moon swap is the shadcn "mode toggle" animation: both icons are
 * always rendered and the `dark:` variant rotates one out and the other in,
 * so it needs no JS and respects prefers-reduced-motion via the global rule.
 */
export function AppearanceMenu({ align = 'end' }: { align?: 'start' | 'end' }) {
  const { theme, density, setTheme, setDensity } = useTheme();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Appearance settings" title="Appearance">
          <Sun
            aria-hidden
            className="size-4 rotate-0 scale-100 transition-transform duration-300 dark:-rotate-90 dark:scale-0"
          />
          <Moon
            aria-hidden
            className="absolute size-4 rotate-90 scale-0 transition-transform duration-300 dark:rotate-0 dark:scale-100"
          />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="w-48">
        <DropdownMenuLabel>Theme</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={theme}
          onValueChange={(value) => setTheme(themeSchema.parse(value))}
        >
          <DropdownMenuRadioItem value="light">
            <Sun aria-hidden /> Light
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">
            <Moon aria-hidden /> Dark
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system">
            <Monitor aria-hidden /> System
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Density</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={density}
          onValueChange={(value) => setDensity(densitySchema.parse(value))}
        >
          <DropdownMenuRadioItem value="comfortable">
            <Rows3 aria-hidden /> Comfortable
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="compact">
            <Rows3 aria-hidden className="scale-y-75" /> Compact
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
