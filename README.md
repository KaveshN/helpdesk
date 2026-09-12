# Multi-Tenant Help Desk Platform

Several independent help desk groups ("IT Help Desk", "Kenya Help Desk", …) on one
platform. Each group owns its queues, taxonomy, SLAs, calendars, CABs and
reporting; a Super Administrator manages the environment centrally.

**Design tension held throughout: centralised administration, decentralised
configuration.** Almost every configurable entity is scoped to a help desk
group, not global.

Phase 1 (foundation) is implemented. Phases 2–7 are modelled in the database but
not yet built — see [Roadmap](#roadmap).

---

## Stack

| Concern          | Choice                                        | Notes                                                        |
| ---------------- | --------------------------------------------- | ------------------------------------------------------------ |
| App              | Next.js 16 (App Router), React 19, TypeScript | Server Components + Server Actions; no separate API tier     |
| Database         | PostgreSQL 16                                 |                                                              |
| ORM              | Prisma 7                                      | Driver adapter (`@prisma/adapter-pg`) — no Rust query engine |
| Cache / sessions | Redis 7                                       | Session revocation today; job locks in Phase 2+              |
| Auth             | Auth.js (next-auth v5)                        | Microsoft Entra ID OIDC, plus a prod-guarded dev login       |
| Styling          | Tailwind CSS 4                                |                                                              |
| Tests            | Vitest                                        |                                                              |
| Lint / format    | ESLint 9 + Prettier                           |                                                              |

---

## Quick start

```bash
cp .env.example .env          # then generate a secret:
openssl rand -base64 32       # paste into AUTH_SECRET

docker compose up --build     # app on http://localhost:3001
```

The dev container applies migrations and runs the (idempotent) seed on start.
With `AUTH_DEV_LOGIN=true` you can sign in immediately as any seeded persona:

| Email                               | Access                                                      |
| ----------------------------------- | ----------------------------------------------------------- |
| the address in `SUPER_ADMIN_EMAILS` | Super Administrator — sees both help desks                  |
| `it.admin@example.com`              | HD Admin, IT Help Desk                                      |
| `it.agent1@example.com`             | Agent, IT Help Desk                                         |
| `it.observer@example.com`           | Observer, watched tickets only                              |
| `ke.admin@example.com`              | HD Admin, Kenya Help Desk                                   |
| `dual.role@example.com`             | **Agent in ITHD, HD Admin in KEN** — try the group switcher |

`dual.role@example.com` is the one to log in as first: it demonstrates the whole
point of `HelpDeskMembership`, and the switcher changes both the visible data and
the available navigation.

### Running on the host instead

```bash
docker compose up -d db redis
npm install
npm run db:deploy && npm run db:seed
npm run dev
```

### Keeping it running across reboots

`db` and `redis` are `restart: unless-stopped` — they come back after a daemon
restart or a crash, but respect a deliberate `docker stop` (which `always` would
not).

One caveat on a socket-activated Docker install (`docker.service` disabled,
`docker.socket` enabled — the Arch default): a restart policy is applied _by the
daemon_, and the daemon does not run until something touches the socket. So after
a reboot the containers come back on the **first docker command**, not at boot.
If you want them up before you touch anything:

```bash
sudo systemctl enable --now docker.service
```

The app itself is not in the restart set: in dev it runs on the host
(`npm run dev`), so it is a foreground process that ends with your shell.

### Commands

**After changing `prisma/schema.prisma`, restart the dev server.** `db()` caches
the client on `globalThis` so hot reload does not leak connections — but that
cached instance survives HMR, so a freshly generated client is ignored and you
get `Cannot read properties of undefined (reading 'findMany')` on the new model.

```bash
npm run check        # typecheck + lint + tests
npm run db:migrate   # create a migration from schema changes
npm run db:reset     # drop, re-migrate, re-seed
npm run db:studio    # Prisma Studio
```

---

## Wiring up Entra ID

1. Entra admin centre → **App registrations** → New registration.
2. Redirect URI (Web): `http://localhost:3001/api/auth/callback/microsoft-entra-id`
   (add the production URL alongside it later).
3. **Certificates & secrets** → new client secret.
4. **API permissions** → Microsoft Graph → delegated `openid`, `profile`,
   `email`, `User.Read` → grant admin consent.
5. Put the Application (client) ID, secret value and Directory (tenant) ID into
   `.env` as `AZURE_AD_CLIENT_ID` / `_SECRET` / `_TENANT_ID`.
6. Set `AUTH_DEV_LOGIN=false`.

Group memberships and roles are assigned **inside this app**, not read from Entra
security groups. Only Super Administrator is bootstrapped from the environment
(`SUPER_ADMIN_EMAILS`), so a fresh deployment has someone who can log in and
configure the rest. Promotion from that list is one-way: removing an address
never silently strips a role an administrator granted deliberately.

**The `oid` claim is the identity**, not the email address — an email can be
reassigned, `oid` cannot. A user invited by email is a placeholder row until
their first sign-in links the two.

---

## Architecture

### Tenancy — how group isolation is enforced

Every operational table carries `helpDeskGroupId`, nullable only on
platform-global entities. `scopedDb(groupId)` (`src/lib/db/scoped.ts`) returns a
Prisma client extension that rewrites every query against a tenant table:

- reads get the tenant filter ANDed onto `where`;
- `findUnique` becomes `findFirst` so the filter can be applied at all;
- creates have `helpDeskGroupId` forced on, and a row naming a _different_ group
  throws `TenancyViolationError`;
- single-row writes (`update` / `delete` / `upsert`) run an ownership pre-check.

**Known gaps, documented rather than hidden** (full detail in the module header):

1. `$queryRaw` / `$executeRaw` bypass extensions entirely.
2. Nested writes (`data: { comments: { create: … } }`) are not rewritten — the
   extension only sees the top-level model. The columns are `NOT NULL`, so the
   failure is loud rather than silent, and the ticket service sets them by hand.
3. The ownership pre-check reads outside a caller's interactive transaction.

The durable fix for 1 and 2 is Postgres row-level security with a
per-transaction `SET LOCAL app.current_group_id`, which no application bug can
bypass. That is worth doing **before** this platform holds data for groups that
must not see each other for legal or regulatory reasons. It is deliberately out
of scope for Phase 1.

A test reads `schema.prisma` and fails if any model is not explicitly classified
as strictly scoped, global-or-group, or unscoped — so adding a table without
deciding how it is tenanted breaks CI instead of leaking quietly.

### Permissions

Roles never appear in route handlers or components — **capabilities** do
(`src/lib/authz/`). `ROLE_CAPABILITIES` is the single table mapping
`HD_ADMIN` / `AGENT` / `OBSERVER` to capabilities; Super Administrator holds
every capability, derived from the list rather than hand-maintained.

`can(actor, capability, groupId)` **fails closed**: a group capability with no
group id is "no", never "yes everywhere". Roles are re-read from the database on
each request rather than trusted from the JWT, so a revoked role takes effect
immediately.

### Configurability

Anything an admin must change without a deploy is a **table, not an enum**:
statuses, priorities, ticket types, categories, SLA policies, calendars,
notification templates. Enums are reserved for semantics the code branches on —
`StatusCategory` is what tells the dashboard that a group's custom "Awaiting
Vendor" status counts as `PENDING`, and `pausesSla` is what tells the (Phase 2)
SLA engine to stop the clock.

Creating a group provisions a full working configuration in one transaction: a
half-provisioned group would look fine in the list and fail on first ticket.

### Ticket numbering

Per-group prefixed sequence: `ITHD-000123`, `KEN-000045`. The counter is claimed
with `UPDATE … RETURNING` inside the ticket-creation transaction, which takes a
row lock so concurrent creations serialise. A Postgres sequence would not race
either, but sequences are not transactional — the reference a user was shown
would sometimes not exist.

### Change management is a separate module

Not a ticket type. Change requests have their own numbering series
(`ITHD-C-000042`, from a `changeSequence` column independent of tickets), their
own taxonomy (`ChangeType`, `ChangeCategory`, `ChangeRiskLevel` — none shared
with the ticket tables), their own lifecycle enum, their own approval records
and their own timeline (`ChangeEvent`). The default ticket types no longer
include "Change"; that conflation was removed in the
`change_management_module` migration.

The one thread back to tickets is `Ticket.changeRequestId` — an **optional
citation** so an incident can record the change that fixes it. It is nullable,
not unique, and confers no ownership: each side keeps its own lifecycle.

**Risk levels are per-group rows, not an enum** (brief §7 asks for "risk levels
per group"). `ChangeRiskLevel.requiresCab` is what actually gates approval, and
`CabRiskLevel` routes each risk band to a board. A change at a risk level with
no active CAB cannot be submitted — it fails loudly rather than skipping
governance.

**Lifecycle and CAB voting are pure functions** (`src/lib/changes/lifecycle.ts`,
28 tests). The state machine refuses illegal moves (you cannot cancel a change
that is mid-implementation — you fail it, then roll back). The vote evaluator
handles four approval modes, treats abstention as shrinking the pool rather than
blocking, and rejects rather than hanging when everyone has voted but the bar
was not met.

Two details that matter for governance:

- **Voting rights are snapshotted** onto `ChangeApproval` at submission. A later
  CAB membership change cannot retroactively alter whether a vote already cast
  counted towards quorum.
- **A submitted change cannot be edited.** The CAB votes on what it read;
  returning it to draft clears the stale votes and starts a fresh round.

### Reporting is a separate module

Seven reports (`src/lib/reports/`), one uniform `ReportResult` shape so the
on-screen table, the CSV export and the future emailed attachment cannot drift
apart. Reports run through the group-scoped client, so an export is not an
exemption from tenancy.

**SLA performance is computed, not stored.** `src/lib/sla/` is a pure
business-hours calculator — working days, holidays, per-calendar time zones —
and reporting derives attainment from current policy configuration. Phase 2
will persist due dates and add breach sweeps _using the same functions_, not a
second implementation.

Three reporting decisions worth knowing:

- **Undecided is not "met".** An open ticket still inside target has no verdict;
  it is reported as undecided. Counting it as met flatters the figures.
- **Null is not 0%.** An empty period renders `—`, never `0%` — "nothing
  happened" and "everything failed" must not look the same.
- **Agent performance is component metrics, not a score.** Resolved, attainment,
  reopen rate and mean handling time are reported separately. Composite scores
  get optimised for and hide which input moved.
- **The multi-help-desk view never merges groups.** Each is its own panel with
  no platform-wide total: adding one group's SLA attainment to another's
  produces a figure that describes neither, since each has its own calendar,
  priorities and targets.

### Interface

An application shell, not a document: a persistent sidebar on `lg` and up that
collapses to a drawer below it, and a content column that fills the viewport
(capped at 120rem so a 4K monitor does not stretch a table to 3800px).

Design tokens live in `src/app/globals.css`, using the shadcn/ui vocabulary
(`background/foreground/card/muted/primary/accent/destructive/border/ring`)
and written in OKLCH so the neutral ramp is perceptually even and the dark
theme is a second considered palette rather than an inversion. Light / dark /
system and comfortable / compact density are per-user preferences held in
cookies, stamped onto `<html>` by the server so there is no flash. Tokens are
documented in `DESIGN_TOKENS.md`, rebranding in `THEMING.md`, and
`tests/design-tokens.test.ts` enforces WCAG AA contrast for both palettes.

**Colour carries meaning, not decoration.** The chrome is near-monochrome with a
single accent. Red, amber and green are reserved for SLA breach, risk level and
lifecycle state — if every panel is coloured, a P1 breach stops reading as
urgent. `Pill` therefore renders a neutral chip with a coloured dot; only
statuses with real consequence (pending approval, rejected, failed) take a
tinted `TonePill`.

Tables adapt rather than merely scrolling: low-priority columns drop out at each
breakpoint (`hidden md:table-cell`), and on a phone the status and priority
chips fold underneath the subject so the row stays useful.

### Identity, mail and the leaderboard

**Every person who signs in is an Entra identity.** `User.entraObjectId` is the
durable key — a UPN can be reassigned to a different person, an `oid` cannot.
The directory is searched on demand through Microsoft Graph rather than synced,
so there is no mirrored copy to go stale, and a `User` row is only persisted
once someone is actually given a role.

**External correspondents are `Contact` rows, not users.** Someone who emails
the mailbox from outside the tenant can be a ticket requester but can never
authenticate. Keeping them out of `User` means "list all users" still means
"list all staff", which is what makes an access review meaningful. A CHECK
constraint enforces that a ticket has exactly one of `requesterId` or
`contactId`, and that `requesterKind` agrees with whichever is set.

**Mail runs through Exchange Online** (`src/lib/graph/`), app-only client
credentials because the poller has no signed-in user. Threading precedence is
bracketed reference, then Graph `conversationId`, then a new ticket; delivery
uses Graph's delta query so each poll asks only for what changed. Replies leave
**as the shared mailbox**, so the requester's answer comes back to the help desk
rather than an agent's personal inbox, and are committed as a `TicketComment`
plus a QUEUED `OutboundEmail` in one transaction — if Exchange is down the
agent's words are not lost.

> **Scope the mail permissions.** `Mail.ReadWrite` as an application permission
> grants access to _every_ mailbox in the tenant. Restrict it with an Exchange
> `New-ApplicationAccessPolicy` to the help desk mailboxes, or this app becomes
> a tenant-wide mail reader. The command is in `src/lib/graph/client.ts`.

Auto-replies, bounces and mail from the mailbox to itself are dropped before
they can raise a ticket — an out-of-office answering our acknowledgement, which
we then acknowledge, fills a queue in minutes.

**The leaderboard is quality-weighted on purpose.** A leaderboard tells agents
what the organisation values, and they optimise for exactly what it measures.
Ranking on volume produces cherry-picking and premature closure, so the default
scoring blends priority-weighted resolutions, SLA attainment and CSAT, with
reopened tickets subtracting more than the resolution earned. Agents below a
minimum ticket count are listed but unranked, so one lucky five-star ticket
cannot top the board. Every component is shown next to the rank — a score nobody
can decompose is a score nobody trusts. Weights are per-group configuration.

### Audit

Every administrative change writes an `AuditLog` row with before/after diffs,
`sanitiseForAudit` stripping secret-bearing fields. When the change is
transactional the audit row **joins that transaction** — a trail that can
disagree with the data is worse than none.

---

## Roadmap

| Phase                                                           | Status                                                                                                    |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| 1 — Auth, groups, memberships, ticket CRUD, switcher, dashboard | **Done**                                                                                                  |
| 2 — SLA policies, notifications, after-hours                    | **Calculator done** (`src/lib/sla/`, 48 tests); persistence, breach sweeps and mail transport outstanding |
| 3 — Knowledge base (Tiptap, versioning, publish)                | Modelled                                                                                                  |
| 4 — Reporting, scheduled reports, multi-group dashboard         | Modelled                                                                                                  |
| 5 — Change management + CAB                                     | Modelled                                                                                                  |
| 6 — Workflow rules, email-to-ticket                             | Modelled                                                                                                  |
| 7 — Gamification / CSAT                                         | Modelled, lowest priority                                                                                 |

"Modelled" means the tables, enums and relations exist and are migrated, so
later phases add behaviour without destructive migrations.

See [`OPEN-QUESTIONS.md`](./OPEN-QUESTIONS.md) for the decisions that need your
input before Phase 2.

---

## Project layout

```
prisma/
  schema.prisma            all entities, all phases
  migrations/              init + hand-written integrity constraints
  seed.ts                  idempotent; 2 groups, 8 personas, sample tickets
src/
  app/
    (app)/                 authenticated shell (auth + tenant resolution)
    login/                 sign-in
    api/auth/[...nextauth] Auth.js handler
  components/              client components (forms, switcher)
  lib/
    auth/                  Auth.js config, provisioning, session + group context
    authz/                 capability matrix and guards
    db/                    Prisma client + tenancy extension
    groups/                group CRUD, membership, default provisioning
    taxonomy/              admin-configurable ticket taxonomy
    tickets/               ticket service, reference numbering, schemas
    audit.ts env.ts errors.ts logger.ts redis.ts
  server/actions/          server actions (thin: parse, delegate, revalidate)
tests/                     unit tests (no database required)
```
