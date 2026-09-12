# Open questions and recorded decisions

The brief asked me to flag assumptions rather than guess silently. This is that
list. Nothing here blocks Phase 1; most of it blocks **Phase 2**.

---

## Decisions I made (change any of these and I'll refactor)

| #   | Decision                                                                                                                                                               | Why                                                                                                                             | What would change it                                                                                          |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| D1  | **Statuses, priorities and ticket types are tables, not enums** — each mapped to a fixed semantic enum (`StatusCategory`, `TicketTypeKind`) that the code branches on. | §8 requires no-code-change configurability; the code still needs to know that a group's "Awaiting Vendor" behaves as `PENDING`. | If you'd rather have one fixed platform-wide set, the tables collapse to enums and the SLA matrix simplifies. |
| D2  | **Observer visibility is a per-group setting** (`ObserverScope`: `WATCHED_ONLY` default, or `ALL_TICKETS`), plus per-ticket watchers.                                  | §5 says observer visibility is "configurable at group and ticket level" without saying how.                                     | If observers should always be group-wide, the enum goes away.                                                 |
| D3  | **Deactivate, never delete** taxonomy rows.                                                                                                                            | Historical tickets reference them; deleting would orphan or cascade them.                                                       | Nothing — but you may want an archive/merge tool later.                                                       |
| D4  | **Roles are read from the database per request**, not embedded in the JWT; Redis holds a per-user auth epoch for immediate revocation.                                 | A JWT-embedded role survives a demotion until the token expires.                                                                | Nothing; the cost is one indexed query per request.                                                           |
| D5  | **Tenancy enforced in the app layer** (Prisma client extension), with documented gaps, rather than Postgres RLS.                                                       | §8 asked for the query layer; RLS needs a per-transaction `SET LOCAL` and a non-superuser role.                                 | See Q7 — this is the one I'd most like a decision on.                                                         |
| D6  | **Change requests share the group's ticket counter.**                                                                                                                  | One visible numbering space per help desk is easier for agents.                                                                 | Say so and they get their own sequence (e.g. `ITHD-C-000001`).                                                |
| D7  | **Dev credentials login exists**, hard-refused when `NODE_ENV=production` (env validation throws at boot, and the provider is not registered).                         | You approved this to make Phase 1 clickable before Entra is wired up.                                                           | Set `AUTH_DEV_LOGIN=false`; delete the provider block once Entra works.                                       |
| D8  | **Compose credentials are `helpdesk`/`helpdesk`**, not the brief's `user`/`pass`.                                                                                      | Dev-only, but `user`/`pass` has a habit of reaching staging.                                                                    | Nothing.                                                                                                      |
| D9  | **Attachments store a `storageKey`, not bytes.** No upload endpoint yet.                                                                                               | The DB is the wrong place for files; the right place depends on Q6.                                                             | Q6.                                                                                                           |

---

## Questions that block Phase 2

**Q1 — SLA breach escalation.** The brief calls this out explicitly as unspecified. I have modelled `warningThresholdPct` (default 80%) per SLA target and `AfterHoursConfig.escalationDelayMinutes`, but not the escalation _path_. What should happen on breach?

- notify the assignee only, or assignee + HD Admin?
- reassign automatically, or bump priority?
- how often does it re-notify — once, or every N minutes until acknowledged?
- does an unassigned breached ticket escalate differently?

**Q2 — SLA clock semantics.** I've modelled the pieces (`businessHoursOnly`, `pausesSla` per status, `slaPausedMinutes`). Confirm the rules:

- Does the resolution clock pause in `PENDING` (awaiting requester)? I've defaulted the seeded "Awaiting Requester" and "On Hold" statuses to pausing.
- Does the _response_ clock pause too, or only resolution?
- On reopen, does the resolution target reset, resume, or get a fresh shorter target?
- Ticket raised at 02:00 on a Sunday with `businessHoursOnly`: does the clock start at Monday 08:00 (my assumption) or immediately?

**Q3 — Report catalogue.** Also flagged as unspecified in the brief. I've modelled `ReportType` as `TICKET_VOLUME`, `SLA_PERFORMANCE`, `AGENT_PERFORMANCE`, `TICKET_AGEING`, `TREND_ANALYSIS`, `CSAT`, `CHANGE_SUMMARY`. Which ones actually matter, what columns, and what does "agent performance" mean here — tickets closed, SLA attainment, CSAT, or a composite? (Composite scores drive behaviour; worth being deliberate.)

**Q4 — ANSWERED (2026-09-11): Microsoft Graph / Exchange Online.** Implemented
in `src/lib/graph/`. Delta-query polling; webhooks can replace the poller behind
the same interface once there is a public HTTPS endpoint.

~~**Q4 — Email-to-ticket transport.**~~ IMAP polling against a shared mailbox, or Microsoft Graph change notifications / webhooks? You're already on Entra, so Graph with an application permission on a shared mailbox is the better fit — no stored mailbox password, proper least privilege. Confirm and I'll build against Graph instead of the IMAP stub.

**Q5 — ANSWERED (2026-09-11): Graph `sendMail` / `reply` as the shared
mailbox.** Send As, not on-behalf-of, so replies return to the help desk.

~~**Q5 — Outbound email.**~~ SMTP relay, Microsoft Graph `sendMail`, or a provider (SES/SendGrid)? This affects bounce handling and whether replies can thread back into tickets.

**Q6 — Attachment storage.** Azure Blob Storage (fits the Entra estate), S3-compatible, or a mounted volume? Also: max size, allowed types, and whether attachments need AV scanning before an agent can open them.

**Q7 — ANSWERED (2026-09-12): yes, enforce it in the database.** Postgres
row-level security is now on every group-scoped table (migration
`shared_calendars_and_rls`). `scopedDb()` and `scopedTransaction()` run as the
`helpdesk_app` role with `app.current_group_id` set per transaction; the
unscoped client runs as `helpdesk_platform`. The app never connects as the
schema owner. `npm run verify:rls` checks it live. See `DESIGN_REVIEW.md`.

---

## Smaller questions

**Q8 — Kenyan Eid holidays** are lunar and gazetted annually, so the seed deliberately omits them. Should there be a yearly reminder, or is manual calendar entry fine?

**Q9 — Ticket deletion.** Only HD Admin holds `ticket:delete`, and nothing calls it yet. Should tickets be deletable at all, or only cancellable (`CANCELLED` status exists)? Hard deletes and audit trails don't mix well.

**Q10 — ANSWERED (2026-09-11): a separate `Contact` entity.** External senders
are Contacts and can never sign in; staff who email in are matched to their
existing `User` so their history stays in one place.

~~**Q10 — Requester identity.**~~ Right now a requester must be a `User` row. When email-to-ticket lands, mail will arrive from people with no account and no Entra identity. Auto-create a contact-only `User` (my assumption), or add a separate `Contact` entity?

**Q11 — Session length** is 8 hours (a working day). Confirm, or align to your Entra conditional-access policy.

**Q12 — Data retention.** Nothing is purged today. Do closed tickets, audit logs and notification logs have retention periods?

---

## New questions from the Entra / Exchange / leaderboard work

**Q13 — Which mailboxes, and is the application access policy in place?** The
app needs an Entra app registration with `User.Read.All`, `Mail.ReadWrite` and
`Mail.Send` **application** permissions plus admin consent. Until an Exchange
`New-ApplicationAccessPolicy` restricts it, those mail permissions cover every
mailbox in the tenant. I would not grant consent before that policy exists.

**Q14 — ANSWERED (2026-09-12): a worker container.** `src/worker/` runs a
BullMQ queue on the existing Redis with the mailbox poll and outbound flush as
repeatable jobs (`npm run worker`; the `worker` compose service). The admin
action remains for a manual poll. SLA sweeps join the worker after Q1/Q2.

**Q15 — Attachment handling on inbound mail.** `InboundEmail.hasAttachments` is
recorded but attachments are not yet downloaded — that needs Q6 (storage)
answered first.

**Q16 — Leaderboard weights.** The defaults are a considered starting point, not
a recommendation for your team: resolved ×10 (priority-weighted P1=4 … P4=1),
response SLA ×0.4, resolution SLA ×0.6, CSAT ×8 above neutral, reopen −15,
minimum 3 tickets to rank. Worth reviewing with the agents it will rank.

**Q17 — Does the leaderboard go to agents or only managers?** Currently visible
to agents (`LeaderboardConfig.visibleToAgents`). Flip it per group if it turns
out to be demotivating rather than motivating.

## Deferred deliberately

- **Visual workflow builder** — §4 says model it as a rule set for v1. `Workflow` + `WorkflowCondition` + `WorkflowAction` is that rule set; there is no builder UI yet.
- **SAML** — §6 says Entra OIDC only unless a later phase mandates it.
- **Email worker container** — the interface is stubbed (`InboundEmail` table, `IMAP_*` env vars). It becomes a 4th compose service once Q4 is answered.

---

## Raised by the design review (2026-09-12)

**Q18 — Scale.** Rough ticket volume per group per month and concurrent agent
count. Decides whether live report queries stay (current) or reporting moves to
scheduled materialized views.

**Q19 — Data residency.** Any hard requirement to keep the Kenya group's data
in-region, or is one Azure region acceptable for a single organisation? Also
decides retention per data type (see Q12).

**Q20 — Migration of existing history.** Greenfield, or must tickets from the
current tool be imported? An import materially changes scope: reference
mapping, requester matching against Entra, attachment transfer.
