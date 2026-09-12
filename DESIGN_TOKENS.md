# Design tokens

Source of truth: `src/app/globals.css`. Brand overrides: `src/config/brand.ts`.
Contrast is enforced by `tests/design-tokens.test.ts`, which parses the CSS
and checks every text/surface pair below against WCAG 2.1 AA in both themes.
Change a value and the test tells you if it stopped being readable.

Values are OKLCH (`oklch(L C H)`): L is perceived lightness 0–1, C chroma,
H hue in degrees. Two neutrals at the same L look the same weight, which is
why the ramps below are written as L steps.

## Colour

Naming is the shadcn/ui vocabulary so shadcn primitives read the right
variable with no adapter. Tokens marked **ours** are additions.

| Token                         | Light                    | Dark                     | Use                                                                               |
| ----------------------------- | ------------------------ | ------------------------ | --------------------------------------------------------------------------------- |
| `background`                  | `oklch(0.978 0.003 264)` | `oklch(0.165 0.012 265)` | Page canvas                                                                       |
| `foreground`                  | `oklch(0.21 0.02 265)`   | `oklch(0.955 0.005 265)` | Body text                                                                         |
| `card`                        | `oklch(1 0 0)`           | `oklch(0.202 0.013 265)` | Panels, tables, the sidebar                                                       |
| `card-foreground`             | = foreground             | = foreground             |                                                                                   |
| `popover`                     | = card                   | = card                   | Menus, dialogs, command palette                                                   |
| `popover-foreground`          | = foreground             | = foreground             |                                                                                   |
| `muted`                       | `oklch(0.968 0.004 264)` | `oklch(0.238 0.014 265)` | Inset surface: table headers, hover rows, secondary buttons                       |
| `muted-foreground`            | `oklch(0.535 0.018 265)` | `oklch(0.68 0.016 265)`  | Secondary text. 4.5:1 on every surface above                                      |
| `secondary`                   | = muted                  | = muted                  | shadcn `secondary` button/badge                                                   |
| `secondary-foreground`        | = foreground             | = foreground             |                                                                                   |
| `accent`                      | `oklch(0.95 0.005 264)`  | `oklch(0.265 0.015 265)` | Hover/active surface in menus and ghost buttons. **Not** the brand hue            |
| `accent-foreground`           | = foreground             | = foreground             |                                                                                   |
| `faint` **ours**              | `oklch(0.62 0.015 265)`  | `oklch(0.62 0.016 265)`  | Tertiary, decorative only: icons, dividers, placeholders. 3:1, so never body text |
| `border`                      | `oklch(0.918 0.006 265)` | `oklch(0.278 0.015 265)` | Default 1px rule (set on `*` in base)                                             |
| `border-strong` **ours**      | `oklch(0.855 0.008 265)` | `oklch(0.35 0.018 265)`  | Hovered controls, scrollbars                                                      |
| `input`                       | = border                 | = border                 | shadcn input border colour                                                        |
| `primary`                     | `oklch(0.52 0.204 276)`  | `oklch(0.66 0.18 277)`   | The single brand accent: primary buttons, links on hover, active nav              |
| `primary-hover` **ours**      | `oklch(0.46 0.2 276)`    | `oklch(0.72 0.17 277)`   |                                                                                   |
| `primary-foreground`          | `oklch(0.99 0 0)`        | `oklch(0.16 0.02 265)`   | Text on primary                                                                   |
| `primary-subtle` **ours**     | `oklch(0.958 0.024 276)` | `oklch(0.28 0.06 277)`   | Tinted surface: selected row, "you" on the leaderboard                            |
| `ring`                        | primary @ 45%            | primary @ 50%            | Focus ring                                                                        |
| `success` **ours**            | `oklch(0.52 0.13 155)`   | `oklch(0.72 0.15 158)`   | SLA met, resolved, approved                                                       |
| `success-subtle` **ours**     | `oklch(0.955 0.035 155)` | `oklch(0.29 0.06 158)`   |                                                                                   |
| `warning` **ours**            | `oklch(0.535 0.13 72)`   | `oklch(0.78 0.14 78)`    | SLA at risk, pending approval, unassigned                                         |
| `warning-subtle` **ours**     | `oklch(0.962 0.045 82)`  | `oklch(0.31 0.06 78)`    |                                                                                   |
| `destructive`                 | `oklch(0.53 0.2 25)`     | `oklch(0.7 0.18 24)`     | SLA breached, rejected, failed, delete                                            |
| `destructive-foreground`      | `oklch(0.99 0 0)`        | `oklch(0.16 0.02 265)`   | Text on destructive                                                               |
| `destructive-subtle` **ours** | `oklch(0.955 0.03 25)`   | `oklch(0.3 0.08 24)`     |                                                                                   |

**Colour policy.** Chrome is neutral and carries one accent (`primary`).
Red, amber and green are reserved for meaning: SLA, risk, lifecycle. If the
furniture is colourful, a P1 breach stops reading as urgent.

**Where semantic mappings live.** `src/lib/design/tones.ts` is the only file
that maps a _meaning_ (change status, approval decision, SLA state) to a
tone, and a tone to classes (`TONE_CHIP`, `TONE_TEXT`, `TONE_CALLOUT`,
`TONE_DOT`). Ticket statuses, priorities and risk levels are per-group rows
with their own `colour` column; `Pill` renders that value as a dot. They are
data, not tokens, and the inline `style` that carries them is the one
sanctioned inline style in the codebase.

## Surfaces and elevation

| Token         | Light                                   | Dark                              |
| ------------- | --------------------------------------- | --------------------------------- |
| `shadow-card` | `0 1px 2px oklch(0.21 0.02 265 / 0.05)` | `0 1px 2px oklch(0 0 0 / 0.4)`    |
| `shadow-pop`  | `0 8px 24px oklch(0.21 0.02 265 / 0.1)` | `0 12px 32px oklch(0 0 0 / 0.55)` |
| `radius`      | `0.5rem`                                | same                              |

shadcn's `rounded-sm/md/lg/xl` derive from `--radius` (−4px, −2px, =, +4px).

## Type scale

A dense product, so `base` is 14px, not Tailwind's 16px. This is the one
place the Tailwind names mean something different from the docs.

| Class       | Size | Line height | Use                                       |
| ----------- | ---- | ----------- | ----------------------------------------- |
| `text-2xs`  | 11px | 16px        | Section labels, uppercase eyebrows, hints |
| `text-xs`   | 12px | 16px        | Chips, timestamps, helper text            |
| `text-sm`   | 13px | 20px        | Table cells, buttons, inputs, nav         |
| `text-base` | 14px | 22px        | Body                                      |
| `text-lg`   | 16px | 24px        | Panel titles, dialog titles               |
| `text-xl`   | 20px | 28px        | Page titles                               |
| `text-2xl`  | 24px | 32px        | Stat tile values                          |
| `text-3xl`  | 30px | 36px        | Reserved                                  |

Arbitrary `text-[…rem]` values are not used; add a step here instead.

## Spacing and density

Spacing is Tailwind's 4px grid. Rows and controls read a multiplier:

| Token / utility | Value                             | Set by                                                   |
| --------------- | --------------------------------- | -------------------------------------------------------- |
| `--density`     | `1` comfortable, `0.7` compact    | `data-density` on `<html>`, from the `hd.density` cookie |
| `py-row`        | `calc(0.625rem * var(--density))` | Table cells (`.data-table`)                              |
| `py-control`    | `calc(0.5rem * var(--density))`   | Buttons, inputs                                          |
| `.meta-row`     | `calc(0.375rem * var(--density))` | Key/value rows in detail asides                          |

Use `py-row` / `py-control` instead of fixed `py-*` on anything that repeats
down a list, or the compact preference will not tighten it.

## Layout

| Token                       | Value                                                           |
| --------------------------- | --------------------------------------------------------------- |
| `--sidebar-width`           | `15.5rem`                                                       |
| `--sidebar-width-collapsed` | `3.5rem`                                                        |
| `.page-max`                 | `120rem` cap so a 4K monitor does not stretch a table to 3800px |

## Theme switching

- `<html data-theme="light|dark">` selects the palette. The `dark:` Tailwind
  variant keys off the same attribute (`@custom-variant dark`), so shadcn's
  `dark:` utilities and these tokens always agree.
- The server stamps the attribute from the `hd.theme` cookie when the user
  chose explicitly. With `system` it leaves the attribute off and a blocking
  inline script (`src/components/theme/theme-script.tsx`) resolves
  `prefers-color-scheme` before first paint. No flash either way.
- `color-scheme` moves with the attribute so native controls match.
- With JavaScript disabled and no explicit choice, the page is light.

## Contrast results

`tests/design-tokens.test.ts` asserts, in both palettes:

- `foreground` and `muted-foreground` ≥ 4.5:1 on `background`, `card`, `muted` (and `accent` for `foreground`)
- `primary-foreground` ≥ 4.5:1 on `primary` and `primary-hover`
- `destructive-foreground` ≥ 4.5:1 on `destructive`
- `primary`, `success`, `warning`, `destructive` ≥ 4.5:1 on `card` and on their own `-subtle` surface
- `faint` ≥ 3:1 on `background` and `card` (UI-component tier only)

Not asserted, by design: `border` on `background` (subtle dividers are
meant to be ~1.2:1) and anything with alpha (`ring`).
