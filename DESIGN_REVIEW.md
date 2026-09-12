# Design review — the "Modern Helpdesk Platform" draft against this repo

Status: reviewed 2026-09-12. Decisions marked **taken** were approved the same
day and are implemented in the commit that added this file.

The draft ("Design Adaptation of the BRS") is a sound target description, but
it is written as if nothing exists. About two-thirds of it is already built or
modelled here; the value is in the places where it disagrees with what was
built. This document is the delta, so that `BUILD_BRIEF.md` describes the
remaining work rather than re-specifying finished work.

## 1. Already matches the code

| Draft section                                   | In the repo                                                                                      |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| §1 workspace tenancy, `group_id` on every table | `helpDeskGroupId` on every operational table; `scopedDb()` rewrites every query (invariant 1)    |
| §2 role on the membership, not the user         | `HelpDeskMembership.role`; capabilities derived per group (invariant 2)                          |
| §3 observer as a lightweight role               | `OBSERVER` role plus per-ticket `TicketWatcher`, with a group-level `observerScope`              |
| §3 group switching as session context           | Server-verified `active group` cookie; forged cookie yields 403                                  |
| §4.1 configurable taxonomy                      | Statuses, priorities, types, categories, SLAs, calendars, templates are rows (invariant 4)       |
| §4.2 business-hour maths as a tested library    | `src/lib/sla/` (48 tests); calendars, holidays, working hours modelled                           |
| §4.3 change management with CAB                 | Built: own counter, taxonomy, lifecycle state machine, CAB with quorum / unanimous / chair modes |
| §4.4 KB tables, org-wide flag                   | `KnowledgeArticle.isGlobal`, versions, ticket links modelled                                     |
| §4.5 separation in reporting                    | Stricter than the draft: per-group panels with **no** platform totals (invariant 9)              |
| §4.6 trigger → condition → action               | `Workflow`, `WorkflowCondition`, `WorkflowAction` modelled with the same trigger list            |
| §4.8 notifications, after-hours                 | `NotificationTemplate`, `NotificationLog`, `AfterHoursConfig` modelled                           |
| §4.9 Graph mail                                 | Built: inbound via Graph delta polling, outbound as the shared mailbox (invariants 12–13)        |
| §4.10 gamification last                         | Already built (quality-weighted leaderboard, invariant 14)                                       |
| §6 audit, Entra-only sign-in                    | `AuditLog` with before/after, IP, user agent; Entra provider plus a prod-refused dev login       |

## 2. Where the draft diverges, and what was decided

### RLS — **taken**

The draft calls database-enforced separation non-negotiable; the repo had
deferred it (OPEN-QUESTIONS Q7). Implemented as:

- Two NOLOGIN roles created by the migration: `helpdesk_platform` (sees every
  row; the runtime login is a member) and `helpdesk_app` (policy-filtered by
  the transaction-local `app.current_group_id`).
- `scopedDb()` wraps every operation and raw query in a transaction that
  starts with `SET LOCAL ROLE helpdesk_app` and `set_config(...)`.
  `scopedTransaction()` does the same for the service-layer write
  transactions, which were switched over. Raw SQL and nested writes in a
  scoped path are now filtered by Postgres.
- The app never connects as the schema owner (owners bypass RLS). The Prisma
  CLI uses `DATABASE_ADMIN_URL`; the app uses `DATABASE_URL` as
  `helpdesk_runtime`. `src/instrumentation.ts` refuses to start in production
  if the runtime role is a superuser or lacks the memberships.
- `npm run verify:rls` proves it against the seeded database.
- `tests/rls-migration.test.ts` fails if a scoped model has no policy.

### JSON config per group — **rejected**

Tables are the better choice here: tickets foreign-key to a status row,
reports group by it, and validation is structural rather than at write time.
Adding a category is already a form submission.

### Change management on the shared workflow engine — **rejected**

The change lifecycle stays a dedicated, tested state machine (invariant 8).
The workflow engine subscribes to change events (`CHANGE_SUBMITTED`,
`CHANGE_APPROVED`, ...). A generic approval primitive is worth building only
when a second object type needs one.

### Shared calendars — **taken**

`Calendar.helpDeskGroupId` (and `WorkingHours`, `Holiday`) is now nullable. A
NULL group is a platform calendar readable from every group and editable only
by a Super Admin, so one "South Africa business hours" calendar can serve
several groups. `scopedDb` classifies them as global-or-group.

### Worker container — **taken**

BullMQ on the existing Redis, one `worker` process (compose service and
Dockerfile target). First jobs: the mailbox poll and outbound mail flush,
replacing the manual admin action as the production path (Q14). SLA sweeps
join it once Q1 and Q2 are answered.

### Materialized views for reporting — **deferred**

Live queries until the draft's own scale question is answered.

### Email routes table and Graph webhooks — **rejected for now**

One mailbox per group on `HelpDeskGroup` is enough unless a group needs
aliases. Delta polling stays: subscriptions need a public HTTPS endpoint and a
renewal loop for no gain at this scale.

### `sla_clocks` table — **rejected**

The due/paused columns live on `Ticket`; `TicketEvent` already records history.

### Organisation row — **rejected**

Single deployment, single organisation. Keep the organisation's name out of
the repository (invariant 7).

## 3. Phasing, reconciled with reality

The draft's phases 3 (governance) and 4 (reporting) are done, and gamification
is built. Remaining, in order:

1. RLS, shared calendars, worker (this commit).
2. SLA persistence and sweeps — blocked on Q1 / Q2.
3. Notification transport (templates → Graph mail) and after-hours routing.
4. Workflow runner.
5. Email-to-ticket completion: attachments (Q6 / Q15), acknowledgement flow.
6. Knowledge base UI.
7. UI redesign steps 1–8 (see `UI_AUDIT.md`), which proceed in parallel.

## 4. New questions the draft raised

Added to `OPEN-QUESTIONS.md` as Q18–Q20: expected ticket volume and agent
count; data residency for the Kenya group; and whether existing ticket history
must be imported. The import question is the one that materially changes
scope. The draft's gamification question is moot (built); Q16 and Q17 on
leaderboard weights and visibility still stand.
