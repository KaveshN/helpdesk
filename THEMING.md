# Theming

How to rebrand a deployment, adjust a token, or add a new semantic colour
without touching a component. Token values and their meaning are in
`DESIGN_TOKENS.md`.

## The layers, bottom to top

1. **`src/app/globals.css`** defines every token twice: `:root` (light) and
   `:root[data-theme='dark']`. `@theme inline` maps them to Tailwind
   utilities (`bg-card`, `text-muted-foreground`, `border-primary/30`, …).
2. **`src/config/brand.ts`** is the deployment brand: product name, logo,
   and an optional set of token overrides per theme. The root layout renders
   the overrides as a `<style>` after the sheet, so they win by cascade. One
   build serves any brand.
3. **`src/lib/design/tones.ts`** maps meanings to tones and tones to
   classes. Components import from here; nothing else hard-codes a colour.
4. **Components** use semantic utilities only. The lint rule is human for
   now: no `text-slate-*`, no `#fff`, no `style={{ color: … }}` except the
   database-driven `colour` on `Pill`.

## Rebrand a deployment

Edit `src/config/brand.ts`:

```ts
export const brand = brandSchema.parse({
  productName: 'Service Desk',
  tagline: 'Support for every office.',
  logo: { kind: 'image', src: '/brand/logo.svg', alt: 'Service Desk' },
  tokens: {
    light: {
      primary: 'oklch(0.55 0.16 200)',
      'primary-hover': 'oklch(0.48 0.16 200)',
      'primary-subtle': 'oklch(0.95 0.03 200)',
      ring: 'oklch(0.55 0.16 200 / 0.45)',
    },
    dark: {
      primary: 'oklch(0.7 0.14 200)',
      'primary-hover': 'oklch(0.76 0.13 200)',
      'primary-subtle': 'oklch(0.28 0.06 200)',
      ring: 'oklch(0.7 0.14 200 / 0.5)',
    },
  },
});
```

Rules the schema enforces:

- Only `primary`, `primary-hover`, `primary-foreground`, `primary-subtle`
  and `ring` are overridable. The neutrals and the red/amber/green stay
  fixed on purpose: they carry meaning, and a brand that recolours "breached"
  has broken the product.
- Override **both** themes. An accent that reads on white rarely reads on
  near-black; the dark value usually needs L ≈ 0.65–0.72.
- Values must be CSS colour literals (`oklch()`, `hsl()`, hex). The regex
  rejects anything that could close the `<style>` tag.

Then run `npm test`: the contrast test does not read `brand.ts`, so check
your `primary-foreground` on your `primary` yourself with
`contrastRatio()` from `src/lib/design/contrast.ts`, or add the pair to the
test with your values.

The name is a placeholder in the repository (invariant 7). Do not commit a
real organisation's name or colours to `main`; keep them in a deployment
branch or, later, a `BRAND_*` env block.

**Per-help-desk-group branding** is not built. The intended shape is a
nullable `brandAccent` on `HelpDeskGroup` that the app layout turns into the
same `<style>` override scoped to the active group. Flagged as
`TODO(brand-per-group)` in `brand.ts`.

## Adjust a token

Change the value in **both** theme blocks of `globals.css`, run `npm test`,
and read the failure message if any: it names the pair and the ratio.
Nudging L by 0.01–0.02 is usually enough. Do not fix a failure by lowering
the threshold.

## Add a semantic colour

Say you need an `info` tone.

1. Add `--info`, `--info-subtle` (and `--info-foreground` if it will be a
   button background) to both theme blocks, and `--color-info*` lines to
   `@theme inline`.
2. Add `info` to `Tone` and to every map in `tones.ts`; TypeScript will
   list the components that switch on `Tone`.
3. Add the pairs to `TEXT_ON_SURFACE` in `tests/design-tokens.test.ts`.
4. Document it in `DESIGN_TOKENS.md`.

## Add a tinted surface to a component

Do not write `bg-warning-subtle text-warning` in the component. Use the
map: `className={TONE_CALLOUT.warning}` or `<TonePill tone="warning" />`.
When the tone depends on data, compute the tone (`slaCountdown(...).tone`)
and index the map with it.

## Theme and density preferences

- Stored in cookies `hd.theme` (`light | dark | system`) and `hd.density`
  (`comfortable | compact`), one year, `httpOnly`. Written by the server
  actions in `src/server/actions/preferences.ts`; read by the root layout.
- `AppearanceMenu` (`src/components/theme/appearance-menu.tsx`) is the UI.
  It is mounted in the sidebar footer; the shell redesign moves it to the
  top bar.
- `useTheme()` exposes `theme`, `resolvedTheme`, `density` and setters for
  anything that must know (Sonner reads `resolvedTheme`).
- Not synced across devices. `TODO(preferences-db)` in
  `src/lib/preferences/schema.ts` marks where a `UserPreference` row would
  slot in: read it in the layout in place of the cookie, write it in the
  same actions.

## Dark-mode variant

`@custom-variant dark` targets `[data-theme='dark']`, not
`prefers-color-scheme`. That is what lets an explicit "light" choice beat a
dark OS. If you write raw CSS, use `:root[data-theme='dark'] { … }`; never a
media query.
