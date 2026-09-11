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
npm run db:deploy && npm run db:seed
npm run dev                       # http://localhost:3001
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
   through `scopedDb(groupId)`. A new Prisma model **must** be classified in
   `src/lib/db/scoped.ts` (strict / global-or-group / unscoped) or
   `tests/scoped-db.test.ts` fails — that test reads `schema.prisma` on purpose.
   Known gaps (raw SQL, nested writes) are documented in that module's header;
   the durable fix is Postgres RLS, deliberately out of Phase 1 scope.
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

Tokens in `src/app/globals.css` (shadcn/Radix names, OKLCH values, dark mode via
`prefers-color-scheme`). Use the semantic utilities — `bg-card`, `text-muted`,
`text-faint`, `border`, `text-danger` — never raw Tailwind palette classes like
`text-slate-600`; a bulk migration removed them all and reintroducing one breaks
dark mode.

- Layout is an app shell: `Sidebar` + `lg:pl-[15.5rem]` content column. Pages
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
