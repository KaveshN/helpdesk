@AGENTS.md

# Multi-tenant help desk platform

Independent help desk groups (ITHD, KEN, …) on one platform. **Centralised
administration, decentralised configuration.** Phase 1 is complete and verified
against a live database; phases 2–7 are modelled in Prisma but not built.

Phases 4 (reporting) and 5 (change management) are also built, ahead of the
original order, at the user's request. Phase 2's SLA **calculator** exists
(`src/lib/sla/`); its persistence, breach sweeps and mail transport do not.

Full detail is in `README.md`. Pending decisions are in `OPEN-QUESTIONS.md` —
Q1 (SLA breach escalation) and Q2 (SLA clock pause semantics) are still
unanswered and block the rest of Phase 2.

## Bring the stack up

```bash
docker compose up -d db redis     # needs `newgrp docker` — see below
                                  # existing cluster: create the runtime roles once, see README
npm run db:deploy && npm run db:seed
npm run db:demo                   # optional: realistic demo data (scripts/demo-data.ts)
npm run dev                       # http://localhost:3001
npm run worker:watch              # mailbox poll + outbound flush (BullMQ)
npm run check                     # typecheck + lint + 86 tests
```

Sign in via **developer login** (no password) as any seeded address:
`superadmin@example.com` (Super Admin), `dual.role@example.com` (Agent in ITHD,
HD Admin in KEN — best demo of the switcher), `it.observer@example.com`
(WATCHED_ONLY observer, correctly sees zero tickets).

## This machine

- **Docker needs `newgrp docker`.** `kavesh` is in the `docker` group, but a
  Claude Code shell inherits stale supplementary groups. Wrap docker calls:
  `newgrp docker <<'EOF' … EOF`. Direct `docker ps` fails with permission denied.
- **`sudo` cannot prompt** through the `!` prefix (no TTY). Ask the user to run
  privileged commands in a real terminal.
- **`db`/`redis` are `restart: unless-stopped`**, but `docker.service` is
  socket-activated here, so after a reboot they return on the first docker
  command rather than at boot. `sudo systemctl enable --now docker.service`
  fixes that if the user wants it.
- **Port 3001, not 3000.** 3000 is taken by another project (`list-app-web-1`);
  8080 GLPI, 8000 rental-billing. The container listens on 3001 too (1:1 map) so
  `AUTH_URL` is correct in every mode and there is one Entra redirect URI.

## Do not "upgrade" these pins

Each was pinned because the newest version is broken with the rest of the stack:

| Pin                   | Why                                                                |
| --------------------- | ------------------------------------------------------------------ |
| `typescript@6.0.3`    | `typescript-eslint` throws on TS 7: "does not support TS 7.0"      |
| `eslint@9.39.5`       | ESLint 10 breaks `eslint-plugin-react` inside `eslint-config-next` |
| `prisma@7.10.0` (CLI) | npm's `latest` tag is an 8.0 **RC**; must match `@prisma/client`   |

Two more traps already paid for:

- **Restart the dev server after `prisma generate`.** `db()` caches the client on
  `globalThis`, and that survives HMR — a new model reads as
  `undefined.findMany`.
- **Server Components cannot pass functions to Client Components.** Props must be
  serialisable; `ActionForm` takes a `redirectTo` template string, not a
  callback.

Tailwind 4: `@apply` accepts **real utilities only** — it cannot apply one of
your own component classes to another. `.btn-primary { @apply btn }` fails the
build. See the note in `src/app/globals.css`.

## Invariants — breaking these is a defect, not a style choice

1. **Tenancy.** Every operational table carries `helpDeskGroupId`. Reads go
   through `scopedDb(groupId)`; group-level write transactions go through
   `scopedTransaction(groupId, fn)`, never `db().$transaction`. Both set
   `SET LOCAL ROLE helpdesk_app` and `app.current_group_id`, so Postgres
   row-level security filters raw SQL and nested writes too. `db()` is the
   platform role and bypasses RLS: use it only for platform tables and Super
   Admin paths. A new Prisma model **must** be classified in
   `src/lib/db/scoped.ts` (strict / global-or-group / unscoped) **and** given
   a policy in a migration, or `tests/scoped-db.test.ts` and
   `tests/rls-migration.test.ts` fail. The app connects as `helpdesk_runtime`
   (`DATABASE_URL`); only the Prisma CLI uses the owner (`DATABASE_ADMIN_URL`).
   `npm run verify:rls` proves isolation against the seeded database.
2. **Capabilities, never roles.** Nothing outside `src/lib/authz/` inspects a
   role. Use `can(actor, capability, groupId)` / `requireCapability`. `can`
   fails closed: a group capability with no group id is "no".
3. **Pages present, services enforce.** A page checks with `can()` and renders
   `<NoPermission>`; `requireCapability` throws inside services and actions. A
   page that throws produces a raw 500, which reads as a broken app.
4. **Configurable = table, not enum.** Statuses, priorities, types, categories,
   SLAs, calendars, templates are rows. Enums are only for semantics the code
   branches on (`StatusCategory`, `pausesSla`).
5. **Audit joins the transaction.** Pass `tx` to `recordAudit` so the trail
   cannot disagree with the data. Use `auditDiff` for changed fields only.
6. **Ticket references** are per-group sequences claimed with
   `UPDATE … RETURNING` inside the creation transaction. Never rewind a counter;
   a gap beats reusing a reference someone has seen.
7. **No real identifiers.** Use `example.com` addresses in code, seeds and docs.
8. **Change management is NOT a ticket type.** Own counter (`changeSequence`),
   own taxonomy, own lifecycle, own timeline. `Ticket.changeRequestId` is an
   optional citation only — never make it required or unique again.
9. **Reports never merge groups.** Per-group panels, no platform-wide totals.
   Undecided SLA outcomes are not "met"; a null metric renders `—`, not `0%`.
10. **One SLA implementation.** `src/lib/sla/` is the only business-hours
    arithmetic. Phase 2 persists what it computes; it does not reimplement it.

## Design system

Tokens in `src/app/globals.css` (exact shadcn/ui names, OKLCH values, dark mode
via `data-theme` on `<html>` from the `hd.theme` cookie — never a media query).
Documented in `DESIGN_TOKENS.md`; rebranding in `THEMING.md`. Use the semantic
utilities — `bg-card`, `text-muted-foreground`, `text-faint`, `border`,
`text-destructive` — never raw Tailwind palette classes like `text-slate-600`,
and never `style={{ color: … }}`; the one sanctioned inline style is the
database-driven `colour` on `Pill`. `tests/design-tokens.test.ts` fails if a
token drops below WCAG AA in either theme.

- shadcn/ui primitives live in `src/components/ui/` (`Button`, `Badge`,
  `Dialog`, `AlertDialog`, `DropdownMenu`, `Tabs`, `Command`, `Sheet`, `Sonner`,
  `Tooltip`, `Skeleton`, `Separator`). The `.btn-*` and `.input` CSS classes
  predate them and go away page by page; do not add new uses.
- Every semantic colour mapping is in `src/lib/design/tones.ts`. Never write
  `bg-warning-subtle text-warning` in a component; index `TONE_CHIP` /
  `TONE_TEXT` / `TONE_CALLOUT` by a `Tone`.
- Success feedback is a Sonner toast; errors stay inline (`FormMessage`).
  Destructive confirmations use `ConfirmForm` (AlertDialog), never
  `window.confirm`.
- Type scale: `text-2xs` 11 / `xs` 12 / `sm` 13 / `base` 14 / `lg` 16 / `xl`
  20 / `2xl` 24. No `text-[…rem]`.
- Density: rows and controls use `py-row` / `py-control`, which read the
  `--density` multiplier, not fixed `py-*`.
- Dates go through `src/lib/format/date.ts` with the group time zone;
  `slaCountdown()` there is the only green→amber→red SLA logic.

- Layout is an app shell: `Sidebar` + `lg:pl-[var(--sidebar-width)]` content column. Pages
  render their own `PageHeader`; they do not re-centre themselves in a narrow
  column.
- Colour is signal. Chrome stays neutral; red/amber/green mean SLA, risk or
  lifecycle. `Pill` = neutral chip + coloured dot; `TonePill` = fully tinted,
  used sparingly.
- Tables use `.data-table` and drop low-priority columns at breakpoints rather
  than only scrolling.
- Shared pieces already exist: `PageHeader`, `FilterTabs`, `Pagination`,
  `StatTile`, `EmptyState`, `NoPermission`, `ActionForm`.

## Identity, mail and leaderboard invariants

11. **Every sign-in is an Entra identity.** `entraObjectId` is the key, not
    email or UPN. External correspondents are `Contact` rows and can never
    authenticate. A ticket has exactly one of `requesterId`/`contactId` — a
    CHECK constraint enforces it; resolve them via
    `resolveRequester()` in `src/lib/tickets/requester.ts`, never by hand.
12. **Mail leaves as the shared mailbox**, never as the agent, so replies come
    back to the help desk. Replies commit as comment + QUEUED OutboundEmail in
    one transaction, then deliver; never send inside the transaction.
13. **Graph mail permissions are tenant-wide** until an Exchange application
    access policy scopes them. Say so whenever the topic comes up.
14. **The leaderboard is quality-weighted deliberately.** Do not "simplify" it
    to tickets-closed — `tests/leaderboard.test.ts` asserts that a high-volume
    agent with reopens and poor CSAT loses to a careful one. That test is the
    specification, not an implementation detail.

## House style

Types always; `zod` at every boundary; `pino` via `src/lib/logger.ts` (ESLint
bans `console`); errors from `src/lib/errors.ts`; a `vitest` test per non-trivial
pure function. Tests must not need a database — that is why the permission,
tenancy and SLA-shaped logic lives in pure functions.
