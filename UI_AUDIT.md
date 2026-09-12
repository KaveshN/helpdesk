# UI audit — pre-redesign inventory

Step 0 of the frontend redesign. Nothing in this document changes code; it
records what exists so the redesign can be scoped screen by screen.

Paths assumed (the brief left them blank): routes in `src/app`, components in
`src/components`, styling in `src/app/globals.css`.

## 1. Stack, as found

| Concern                             | Actual                                                                                                    | Brief assumed                |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------- | ---------------------------- |
| Framework                           | Next.js **16.3.4** App Router, React 19.3, TypeScript 6.0.3 (pinned)                                      | Next 15                      |
| Styling                             | Tailwind **4.3.3**, CSS-first config (`@theme inline`), no `tailwind.config`                              | Tailwind + shadcn/ui         |
| Component library                   | **None.** Hand-written `.btn-*`, `.input`, `.card`, `.chip`, `.data-table` classes in `@layer components` | shadcn/ui                    |
| Radix / cmdk / sonner / next-themes | **Not installed**                                                                                         | shadcn primitives            |
| Icons                               | `lucide-react`                                                                                            | —                            |
| Tokens                              | CSS variables in **OKLCH**, shadcn-style _names_ (see §3 for where they diverge)                          | HSL                          |
| Dark mode                           | `prefers-color-scheme` media query only. No toggle, no class strategy                                     | light / dark / system toggle |
| Data                                | Prisma 7 + Postgres; every page is `force-dynamic` Server Component                                       | —                            |
| Session                             | next-auth JWT; active help desk in a server-verified cookie                                               | —                            |
| Tests                               | 12 vitest files, all pure functions, none touch the UI                                                    | —                            |

Pins that must survive the redesign (see `CLAUDE.md`): `typescript@6.0.3`,
`eslint@9.39.5`, `prisma@7.10.0`. The shadcn CLI must not be allowed to bump
them.

## 2. Screens found

Seventeen routes plus two boundaries. No `loading.tsx` anywhere, so every
navigation is a blank wait. No user settings / preferences page exists.

| Route                        | Purpose                                                | Layout today                                                 | Notes for redesign                                                                 |
| ---------------------------- | ------------------------------------------------------ | ------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| `/`                          | Redirect to dashboard or login                         | —                                                            | Untouched                                                                          |
| `/login`                     | Entra sign-in + dev login                              | Two-column brand panel / form                                | Brand panel is where tenant logo/name would surface                                |
| `/dashboard`                 | Tiles, open-ticket table, leaderboard, breakdowns      | 5 `StatTile`s, 2-col grid                                    | No trends; `dashboardSummary` returns counts only, no time series for sparklines   |
| `/tickets`                   | Queue                                                  | `FilterTabs` + GET filter form + `data-table` + `Pagination` | Filters are URL state (keep). No bulk select, no SLA column, no saved views        |
| `/tickets/new`               | Create form                                            | `TicketCreateForm` (client)                                  | Cosmetic only                                                                      |
| `/tickets/[id]`              | Detail                                                 | Header + 2-col: description / conversation / activity, aside | Activity always expanded; composer is two tabs (email vs internal note) — keep     |
| `/changes`                   | Change queue                                           | Same skeleton as tickets                                     | Reuse whatever the ticket list becomes                                             |
| `/changes/new`               | Create draft                                           | `ActionForm`, long form                                      | Cosmetic only                                                                      |
| `/changes/[id]`              | Detail incl. CAB table, vote form, lifecycle actions   | Same 2-col as ticket detail                                  | Reuse ticket-detail shell; lifecycle timeline duplicated logic                     |
| `/reports`                   | Catalogue rail + period form + `ReportTable`           | 2-col, hand-rolled rail                                      | Contains the one raw palette class (`border-slate-900 … text-white`) — breaks dark |
| `/reports/overview`          | Super Admin per-group panels                           | Card grid                                                    | Own `Metric` component duplicates `StatTile`                                       |
| `/admin/configuration`       | Statuses, priorities, types, categories (497 lines)    | Stacked sections, inline `ActionForm`s per row               | Colour is a free-text hex input; needs a swatch picker                             |
| `/admin/change-config`       | Risk levels, CABs, change types/categories (683 lines) | Same pattern                                                 | Same                                                                               |
| `/admin/groups`              | Group table + create form                              | Table + card                                                 | Hand-rolled header, not `PageHeader`                                               |
| `/admin/groups/[id]`         | Members/roles + group settings                         | 2-col grid, header inside the grid (layout bug)              | Hand-rolled breadcrumb                                                             |
| `/admin/audit`               | Audit log table                                        | Table + hand-rolled pagination                               | Does not use `Pagination`; `<details>` for before/after JSON is fine               |
| `error.tsx`, `not-found.tsx` | Boundaries                                             | Centred card                                                 | Cosmetic only                                                                      |

## 3. Reusable components found

**Shell** (`src/components/shell/`)

- `Sidebar` — fixed rail at `lg`, drawer below. Client component. Active-item
  indicator uses `absolute` inside a `Link` that is not `relative`, so it
  positions against the `<aside>`, not the row (visual bug).
- `GroupSwitcher` — custom listbox with a click-away button. No arrow-key
  navigation, no typeahead, no focus return on close.
- `Icon` + `nav-items.ts` — icons travel as names across the server/client
  boundary. Keep this pattern.

**Primitives** (`src/components/ui/`)

- `PageHeader` (title / description / actions / breadcrumb slot) — used by 8 of
  15 pages; the admin and detail pages hand-roll their own.
- `FilterTabs`, `Pagination` — URL-driven, server-rendered. Keep.
- `Pill` (neutral chip + coloured dot) and `TonePill` (tinted).
- `StatTile`, `EmptyState`, `FormMessage` / `FieldError`.

**Feature** (`src/components/`)

- `ActionForm` — `useActionState` wrapper for admin forms; `redirectTo` is a
  template string because functions cannot cross the RSC boundary. Keep.
- `ConfirmForm` — uses `window.confirm` and `window.alert`.
- `TicketReplyBox` (email vs internal note tabs), `TicketUpdatePanel`,
  `WatcherManager`, `TicketCreateForm`, `ChangeDecisionForm`,
  `ChangeLifecycleActions`, `ChangeStatusBadge`, `LeaderboardPanel`,
  `ReportTable`, `NoPermission`.
- `CommentForm` — **dead code**, zero imports. Superseded by `TicketReplyBox`.

## 4. Styling inconsistencies

1. **Token names collide with shadcn semantics.** The names look like shadcn
   but three mean something different, which matters the moment a shadcn
   component is dropped in:

   | Token here | Means here                | shadcn meaning                                      |
   | ---------- | ------------------------- | --------------------------------------------------- |
   | `--muted`  | secondary **text** colour | secondary **surface**; text is `--muted-foreground` |
   | `--accent` | brand / primary action    | hover surface; brand is `--primary`                 |
   | `--faint`  | tertiary text             | no equivalent                                       |
   | `--subtle` | inset surface             | roughly `--muted`                                   |
   | `--danger` | destructive               | `--destructive`                                     |

   Either rename (mechanical, ~35 files) or alias both sets. Decision needed
   (question 1 below).

2. **Dark mode is media-query only.** A toggle needs a class or attribute
   strategy so `system` can defer to the media query while `light`/`dark`
   override it. `color-scheme` must move with it or native controls (selects,
   scrollbars) will mismatch.

3. **Inline styles: 37 occurrences across 18 files.** All reference tokens
   (`style={{ background: 'var(--warning-subtle)' }}`), never raw colours, so
   they are not a theming break. But the matching utilities already exist
   (`bg-warning-subtle`, `text-accent`) and were simply not used. Two
   legitimate exceptions remain: per-row colours from the database
   (`status.colour`, `priority.colour`, `riskLevel.colour`) and the proportion
   bar width on the dashboard. Those are data, not styling.

4. **One raw palette class:** `reports/page.tsx:94` uses
   `border-slate-900 bg-card text-white` for the active catalogue item. White
   text on a white card in dark mode. The only genuine dark-mode break found.

5. **Type scale is arbitrary values, not tokens.** 34 uses of `text-[…rem]`:
   13px ×18, 11px ×12, 12px ×2, 15px ×1, 10px ×1. Body is 14px. The brief's
   12/14/16/20/24 scale needs an 11px and 13px step added deliberately or
   those uses collapsed onto 12/14. Recommend adding named `--text-2xs` (11px)
   and keeping 13px as `text-sm` override rather than fighting the density
   the current UI already has.

6. **Sidebar width is hard-coded twice.** `--sidebar-width: 15.5rem` is
   defined and unused; `lg:pl-[15.5rem]` in the layout and `w-[15.5rem]` in
   the sidebar are literals. A collapsible rail needs the variable.

7. **No density hook.** Every padding is a fixed utility (`px-4 py-2.5`).
   Comfortable/compact needs `.data-table`, `.card`, `.meta-row`, `.btn` and
   `.input` to read a `--density` multiplier.

8. **Four separate tone maps** for the same five tones: `pill.tsx` (TonePill),
   `change-status-badge.tsx` (identical object copied), `stat-tile.tsx`,
   `reports/overview/page.tsx` (`Metric`). One `tones.ts` should own them.
   Ticket status / priority / risk colours are **rows, not code** (free-text
   hex in the DB), so "status colour constants" only apply to the fixed
   `ChangeStatus` enum; everything else stays data-driven by invariant 4.

9. **Date formatting is `toISOString().slice()` in 7 files.** Always UTC, never
   the group's time zone, no relative time. An SLA countdown needs a real
   formatter anyway; centralise it then.

10. **Success feedback is inline text** (`<p>Saved.</p>` in `ActionForm`,
    `TicketUpdatePanel`, `TicketReplyBox`). `ConfirmForm` uses native
    `confirm()` / `alert()` — 3 sites. Toast + Dialog replace both.

11. **Layout drift on admin pages.** `admin/groups/[id]` puts the breadcrumb and
    header _inside_ a 2-column grid; `admin/audit` and `admin/groups` hand-roll
    headers and pagination that `PageHeader` / `Pagination` already provide.

## 5. Accessibility findings

- **Contrast, light theme:** `--faint` (L 0.68) on `--background` (L 0.978) is
  roughly 3.3:1 and is used for 11px text (dates, hints, section headings).
  Fails WCAG AA for body text. `--muted` (L 0.55) is roughly 5.5:1 and passes.
- **Contrast, dark theme:** `--faint` (L 0.55) on `--background` (L 0.165) is
  roughly 4:1, borderline. Needs measurement once the palette is finalised;
  the fix is likely lifting `--faint` one step in both themes and reserving it
  for decorative elements only.
- Focus-visible outline is defined globally (good). Inputs use a ring on
  `:focus`, not `:focus-visible`, so mouse clicks also show the ring (minor).
- `GroupSwitcher` listbox: no keyboard navigation between options, no focus
  return. Replace with a Radix/cmdk-backed popover.
- Mobile drawer: Escape closes it, but focus is not trapped or moved into it.
- Icon-only buttons all carry `aria-label` (good). Tables carry no `<caption>`
  or `aria-label`.

## 6. Features in the brief that need more than presentation

Each of these is either blocked or needs one small backend addition. Listed so
the screen-by-screen plan can say "shell now, data later" honestly.

| Feature                     | Status                                                                                                                                                                        | Proposed handling                                                                                                                 |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| SLA countdown in the list   | `firstResponseDueAt` / `resolutionDueAt` exist on `Ticket` but are **never populated** (`TODO(phase-2)` in `tickets/service.ts`). Phase 2 is blocked on OPEN-QUESTIONS Q1/Q2. | Build the countdown component against the existing columns; it renders `—` while null. No fake data.                              |
| Sparkline trends            | No time-series query; `dashboardSummary` is counts                                                                                                                            | One new read-only query (created/resolved per day, last 14 days), scoped per group. Small, flag as the one data-shape change.     |
| Bulk select / actions       | No batch server action                                                                                                                                                        | Selection UI now; one `bulkUpdateTicketsAction` that loops `updateTicket` so audit + capability checks are reused. Needs your OK. |
| Avatar stacks               | `User` has no photo; Graph photo not fetched                                                                                                                                  | Initials avatars only. Graph photo is a later, tenant-wide permission question.                                                   |
| Saved views in a left rail  | Views are a constant array                                                                                                                                                    | Rail with the fixed views now; persistence later.                                                                                 |
| Merge, escalate             | No merge action; escalation path is OPEN-QUESTIONS Q1                                                                                                                         | **Skip.** Not presentation.                                                                                                       |
| Command palette jump-to     | Ticket search is server-only                                                                                                                                                  | One small route handler (`/api/search?q=`) that calls the existing scoped `listTickets`.                                          |
| Theme / density persistence | Nothing exists                                                                                                                                                                | See question 3.                                                                                                                   |
| Tenant branding             | `HelpDeskGroup` has no branding columns; no platform config                                                                                                                   | See question 2.                                                                                                                   |

## 7. Proposed migration order

0. **Foundation** — token rename/alias, `next-themes` + toggle, shadcn init
   (Button, Card, Badge, Dialog, DropdownMenu, Tabs, Command, Sheet, Sonner,
   Tooltip, Skeleton), `tones.ts`, `--density`, date formatter, delete
   `CommentForm`. Fix the one raw palette class. `DESIGN_TOKENS.md`.
1. **Shell** — collapsible sidebar (uses `--sidebar-width`), top bar with theme
   toggle and command palette, breadcrumbs component, `loading.tsx` skeletons
   for every route group.
2. **Ticket list** — dense table / card toggle, SLA column, selection + bulk
   bar, saved-view rail.
3. **Ticket detail** — three-pane, sticky action bar, composer, collapsed
   activity.
4. **Dashboard** — KPI tiles with sparklines.
5. **Changes** list + detail — reuse 2 and 3.
6. **Reports** — catalogue rail, table.
7. **Admin** — configuration, change-config, groups, audit; plus a new
   **Preferences** page (theme, density). `THEMING.md`.
8. **Login, error, not-found.**

Each step is one commit and ends with a diff summary, per the brief.

## 8. Decisions needed before step 0

1. **Token naming.** Rename to shadcn semantics now (`--primary`,
   `--muted-foreground`, `--destructive`; ~35 files, mechanical) or keep the
   current names and alias? Recommendation: rename now. Aliasing two vocabularies
   is how the next contributor uses the wrong one.
2. **Branding level.** Platform-wide brand config only (one deployment, one
   logo, one accent), or per help-desk-group accent as well? Recommendation:
   a single `src/config/brand.ts` now, and a nullable `brandAccent` on
   `HelpDeskGroup` later if a group wants its own. Brand name stays a
   placeholder in code (invariant 7: no real identifiers).
3. **Preference persistence.** The brief says localStorage. A cookie is the
   better fit here: pages are Server Components, so a cookie lets the server
   render the right density on first paint with no layout shift, and
   `next-themes` already handles the theme flash. DB column later for
   multi-device sync. Recommendation: cookie for both, flagged as a TODO for
   DB. Confirm?
4. **Backend additions.** Approve the three small ones listed in §6 (sparkline
   query, bulk action, search route handler), or hold the redesign to
   presentation only and ship those panels as shells?
5. **Colour format.** Keep OKLCH rather than the brief's HSL. Tailwind 4 and
   shadcn's own v4 preset are OKLCH now; converting backwards buys nothing.
   Objections?
