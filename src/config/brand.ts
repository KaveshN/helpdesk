import { z } from 'zod';

/**
 * Deployment branding. One build, config-driven: nothing in a component
 * knows the product name or the accent hue -- they read `brand` and the
 * CSS variables this file emits.
 *
 * Token overrides are rendered as a <style> after globals.css (see
 * src/app/layout.tsx), so a brand only lists the tokens it changes and the
 * default palette fills the rest. Both themes are overridable independently
 * because an accent that reads on white rarely reads on near-black.
 *
 * Keep the name a placeholder in the repository (invariant 7). A real
 * deployment sets its own values here or, later, from a BRAND_* env block.
 *
 * TODO(brand-per-group): a nullable `HelpDeskGroup.brandAccent` would let
 * one help desk carry its own accent inside the same deployment. Not built.
 */

/** Tokens a brand may override. Deliberately narrow: chrome stays neutral. */
const OVERRIDABLE = [
  'primary',
  'primary-hover',
  'primary-foreground',
  'primary-subtle',
  'ring',
] as const;

/** A CSS colour literal. Broad enough for oklch()/hsl()/hex, narrow enough to keep a config typo out of a <style> tag. */
const cssColour = z.string().regex(/^[a-zA-Z0-9#(),.%/\s-]+$/, 'Unsafe CSS colour value');

const tokenOverrides = z.record(z.enum(OVERRIDABLE), cssColour);

export const brandSchema = z.object({
  productName: z.string().min(1).max(40),
  tagline: z.string().max(120).optional(),
  logo: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('icon') }),
    z.object({ kind: z.literal('image'), src: z.string().min(1), alt: z.string().min(1) }),
  ]),
  tokens: z
    .object({ light: tokenOverrides.optional(), dark: tokenOverrides.optional() })
    .optional(),
});

export type Brand = z.infer<typeof brandSchema>;

export const brand: Brand = brandSchema.parse({
  productName: 'Help Desk',
  tagline: 'One platform, many independent help desks.',
  logo: { kind: 'icon' },
  // Example of an override -- uncomment to see the accent change everywhere:
  // tokens: {
  //   light: { primary: 'oklch(0.55 0.16 200)', 'primary-hover': 'oklch(0.48 0.16 200)' },
  //   dark: { primary: 'oklch(0.7 0.14 200)', 'primary-hover': 'oklch(0.76 0.13 200)' },
  // },
} satisfies Brand);

function declarations(overrides: Record<string, string> | undefined): string {
  if (!overrides) return '';
  return Object.entries(overrides)
    .map(([name, value]) => `--${name}:${value};`)
    .join('');
}

/** CSS text for the brand's token overrides, or null when it has none. */
export function brandStyleSheet(config: Brand = brand): string | null {
  const light = declarations(config.tokens?.light);
  const dark = declarations(config.tokens?.dark);
  if (!light && !dark) return null;
  return [light ? `:root{${light}}` : '', dark ? `:root[data-theme='dark']{${dark}}` : ''].join('');
}
