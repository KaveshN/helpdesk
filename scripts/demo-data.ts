/**
 * Demo data: enough realistic activity to show the help desk working.
 *
 *   npm run db:demo            # after db:deploy + db:seed
 *
 * Everything goes through the real services (createTicket, updateTicket,
 * addComment, createChange, submitChange, recordDecision, transitionChange)
 * as the seeded personas, so references, events, audit rows and capability
 * checks are the genuine article. Timestamps are then backdated so the
 * dashboard, overdue tile, leaderboard and change queue show a spread over
 * the last ~60 days.
 *
 * Runs once: a `demo.load` audit row is the sentinel. To start over:
 *   npm run db:reset && npm run db:seed && npm run db:demo
 *
 * SLA due dates are written directly here because Phase 2 does not populate
 * them yet; they exist so the overdue view and SLA countdown have something
 * to render. Every address is example.com (invariant 7).
 */
import 'dotenv/config';
import { db, disconnectDb } from '../src/lib/db/client';
import type { Actor, GroupContext } from '../src/lib/authz/actor';
import {
  addComment,
  createTicket,
  ticketFormOptions,
  updateTicket,
} from '../src/lib/tickets/service';
import {
  changeFormOptions,
  createChange,
  recordDecision,
  submitChange,
  transitionChange,
} from '../src/lib/changes/service';

// ---------------------------------------------------------------------------
// Deterministic randomness so two people running this see the same data.
// ---------------------------------------------------------------------------
function mulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20260912);
const pick = <T>(items: readonly T[]): T => items[Math.floor(rand() * items.length)]!;
const chance = (p: number) => rand() < p;
const between = (min: number, max: number) => min + rand() * (max - min);

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const now = new Date();
const daysAgo = (days: number) => new Date(now.getTime() - days * DAY);
const plus = (date: Date, hours: number) => new Date(date.getTime() + hours * HOUR);

// ---------------------------------------------------------------------------
// Personas (from prisma/seed.ts)
// ---------------------------------------------------------------------------
async function loadActor(email: string): Promise<Actor> {
  const user = await db().user.findUniqueOrThrow({
    where: { email },
    include: { memberships: { where: { isActive: true }, include: { group: true } } },
  });
  return {
    userId: user.id,
    email: user.email,
    name: user.name,
    platformRole: user.platformRole,
    isSuperAdmin: user.platformRole === 'SUPER_ADMIN',
    memberships: user.memberships.map((membership) => ({
      helpDeskGroupId: membership.helpDeskGroupId,
      groupKey: membership.group.key,
      groupName: membership.group.name,
      role: membership.role,
      observerScope: membership.group.observerScope,
    })),
  };
}

function contextFor(
  actor: Actor,
  group: { id: string; key: string; name: string; observerScope: GroupContext['observerScope'] },
): GroupContext {
  const membership = actor.memberships.find((item) => item.helpDeskGroupId === group.id);
  return {
    helpDeskGroupId: group.id,
    groupKey: group.key,
    groupName: group.name,
    role: membership?.role ?? null,
    observerScope: group.observerScope,
  };
}

// ---------------------------------------------------------------------------
// Ticket catalogue. Type / category / sub-category are matched by name
// against the group's own configuration, so a group with custom taxonomy
// simply falls back to its defaults.
// ---------------------------------------------------------------------------
type Seed = {
  subject: string;
  description: string;
  type: 'Incident' | 'Service Request' | 'Query' | 'Problem';
  priority: 'P1 - Critical' | 'P2 - High' | 'P3 - Medium' | 'P4 - Low';
  category?: string;
  sub?: string;
};

const IT_TICKETS: Seed[] = [
  {
    subject: 'Outlook keeps asking for my password',
    description:
      'Since this morning Outlook prompts for credentials every few minutes. Web mail works fine.',
    type: 'Incident',
    priority: 'P3 - Medium',
    category: 'Email',
    sub: 'Mailbox',
  },
  {
    subject: 'Cannot print to the 4th floor Xerox',
    description:
      'Jobs sit in the queue and never print. Other people on the floor have the same problem.',
    type: 'Incident',
    priority: 'P2 - High',
    category: 'Hardware',
    sub: 'Printer',
  },
  {
    subject: 'Request: Adobe Acrobat Pro licence',
    description: 'I need to redact and combine PDFs for the litigation team. Manager has approved.',
    type: 'Service Request',
    priority: 'P4 - Low',
    category: 'Software',
    sub: 'Licensing',
  },
  {
    subject: 'Wi-Fi drops in the boardroom during video calls',
    description: 'Teams calls freeze for 10-20 seconds every few minutes in Boardroom 2 only.',
    type: 'Incident',
    priority: 'P2 - High',
    category: 'Network & Connectivity',
    sub: 'Wi-Fi',
  },
  {
    subject: 'New starter: laptop and accounts for M. Dlamini',
    description:
      'Starts on Monday in the property team. Standard build, needs access to the DMS and Practice Manager.',
    type: 'Service Request',
    priority: 'P3 - Medium',
    category: 'Access & Accounts',
  },
  {
    subject: 'Shared mailbox for the tenders team',
    description: 'Please create tenders@example.com and give the five team members send-as rights.',
    type: 'Service Request',
    priority: 'P3 - Medium',
    category: 'Email',
    sub: 'Distribution list',
  },
  {
    subject: 'Laptop fan is extremely loud and the machine is hot',
    description:
      'Started last week. Fan runs constantly even when idle. Dell Latitude, about two years old.',
    type: 'Incident',
    priority: 'P3 - Medium',
    category: 'Hardware',
    sub: 'Laptop',
  },
  {
    subject: 'Excel crashes when opening the billing workbook',
    description: "The monthly billing file crashes Excel on open. Works on a colleague's machine.",
    type: 'Incident',
    priority: 'P2 - High',
    category: 'Software',
    sub: 'Microsoft 365',
  },
  {
    subject: 'VPN certificate expired on my home laptop',
    description: 'Getting "certificate not valid" when connecting from home since yesterday.',
    type: 'Incident',
    priority: 'P2 - High',
    category: 'Network & Connectivity',
    sub: 'VPN',
  },
  {
    subject: 'Phishing email received, did not click',
    description:
      'Email pretending to be from the CEO asking for gift cards. Forwarded to security. Reporting for awareness.',
    type: 'Query',
    priority: 'P4 - Low',
    category: 'Email',
    sub: 'Spam',
  },
  {
    subject: 'Practice Manager is very slow after the update',
    description: "Every screen takes 10+ seconds since Tuesday's update. Whole team is affected.",
    type: 'Incident',
    priority: 'P1 - Critical',
    category: 'Software',
    sub: 'Line of business app',
  },
  {
    subject: 'Second monitor not detected after docking',
    description:
      'The left monitor shows no signal after docking. Undocking and redocking sometimes fixes it.',
    type: 'Incident',
    priority: 'P4 - Low',
    category: 'Hardware',
    sub: 'Desktop',
  },
  {
    subject: 'Access to the finance shared drive',
    description: 'I have moved to the finance team and need read/write on the FIN share.',
    type: 'Service Request',
    priority: 'P3 - Medium',
    category: 'Access & Accounts',
  },
  {
    subject: 'Mobile phone not syncing calendar',
    description: 'Calendar stopped syncing to my iPhone. Email still arrives.',
    type: 'Incident',
    priority: 'P4 - Low',
    category: 'Hardware',
    sub: 'Mobile device',
  },
  {
    subject: 'Internet is down in the Cape Town office',
    description:
      'No external connectivity at all in CPT. Internal systems reachable. Started 08:40.',
    type: 'Incident',
    priority: 'P1 - Critical',
    category: 'Network & Connectivity',
    sub: 'Internet',
  },
  {
    subject: 'Recurring: DMS check-in fails on large files',
    description:
      'Files over about 200 MB fail to check in with a timeout. Happens for several users.',
    type: 'Problem',
    priority: 'P2 - High',
    category: 'Software',
    sub: 'Line of business app',
  },
  {
    subject: 'How do I set up an out-of-office in Teams?',
    description: 'Going on leave next week and want Teams status and Outlook to match.',
    type: 'Query',
    priority: 'P4 - Low',
    category: 'Software',
    sub: 'Microsoft 365',
  },
  {
    subject: 'MFA reset after a new phone',
    description: 'New phone, lost the authenticator. Cannot sign in to anything.',
    type: 'Incident',
    priority: 'P2 - High',
    category: 'Access & Accounts',
  },
  {
    subject: 'Request a loan laptop for a court date',
    description: 'Need a loan laptop for two days at the High Court next week.',
    type: 'Service Request',
    priority: 'P3 - Medium',
    category: 'Hardware',
    sub: 'Laptop',
  },
  {
    subject: 'Keyboard keys sticking',
    description: 'The E and R keys stick intermittently on my laptop keyboard.',
    type: 'Incident',
    priority: 'P4 - Low',
    category: 'Hardware',
    sub: 'Laptop',
  },
  {
    subject: 'Distribution list still includes a leaver',
    description: 'The all-partners list still emails a partner who left in July.',
    type: 'Service Request',
    priority: 'P4 - Low',
    category: 'Email',
    sub: 'Distribution list',
  },
  {
    subject: 'Site link between JHB and CPT is flapping',
    description:
      'Monitoring shows the CPT link going down for 30-60 seconds several times an hour.',
    type: 'Problem',
    priority: 'P1 - Critical',
    category: 'Network & Connectivity',
    sub: 'Site link',
  },
  {
    subject: 'Teams call quality poor from home',
    description: 'Choppy audio on all calls from home. Fine in the office.',
    type: 'Query',
    priority: 'P4 - Low',
    category: 'Network & Connectivity',
  },
  {
    subject: 'Printer toner low warning on 2nd floor',
    description: 'The 2nd floor MFD is warning on black toner. Not out yet.',
    type: 'Service Request',
    priority: 'P4 - Low',
    category: 'Hardware',
    sub: 'Printer',
  },
  {
    subject: 'Cannot open encrypted email from a client',
    description: 'Client sent an encrypted message; the "read the message" link just spins.',
    type: 'Incident',
    priority: 'P3 - Medium',
    category: 'Email',
    sub: 'Mailbox',
  },
  {
    subject: 'Leaver: disable accounts for J. Naidu',
    description:
      'Last day Friday. Please disable accounts and forward mail to the team lead for 30 days.',
    type: 'Service Request',
    priority: 'P3 - Medium',
    category: 'Access & Accounts',
  },
  {
    subject: 'OneDrive says it is out of sync',
    description: 'Red X on OneDrive, "files could not be synced". Restarting did not help.',
    type: 'Incident',
    priority: 'P3 - Medium',
    category: 'Software',
    sub: 'Microsoft 365',
  },
  {
    subject: 'Docking station USB ports dead',
    description: 'Neither USB port on the dock works. Laptop ports are fine.',
    type: 'Incident',
    priority: 'P4 - Low',
    category: 'Hardware',
    sub: 'Desktop',
  },
  {
    subject: 'Request for a standing desk converter',
    description: 'Occupational health recommendation attached. Please advise the process.',
    type: 'Query',
    priority: 'P4 - Low',
    category: 'Hardware',
  },
  {
    subject: 'Email bounce-backs to a specific client domain',
    description: 'All email to a client domain bounces with a 550. Started this week.',
    type: 'Incident',
    priority: 'P2 - High',
    category: 'Email',
    sub: 'Mailbox',
  },
];

const KE_TICKETS: Seed[] = [
  {
    subject: 'Nairobi office Wi-Fi password rotation',
    description:
      'The guest Wi-Fi password is due for its quarterly change. Please rotate and circulate.',
    type: 'Service Request',
    priority: 'P4 - Low',
    category: 'Network & Connectivity',
    sub: 'Wi-Fi',
  },
  {
    subject: 'Cannot access the case management system',
    description:
      'Login page loads but credentials are rejected for the whole Nairobi team since 09:00.',
    type: 'Incident',
    priority: 'P1 - Critical',
    category: 'Software',
    sub: 'Line of business app',
  },
  {
    subject: 'New laptop for the Mombasa associate',
    description:
      'Associate joining the Mombasa office on the 1st. Standard build plus M365 licence.',
    type: 'Service Request',
    priority: 'P3 - Medium',
    category: 'Hardware',
    sub: 'Laptop',
  },
  {
    subject: 'Printer jams on every duplex job',
    description: 'Duplex printing jams every time on the ground floor printer. Single-sided works.',
    type: 'Incident',
    priority: 'P3 - Medium',
    category: 'Hardware',
    sub: 'Printer',
  },
  {
    subject: 'M-Pesa statement import failing in finance app',
    description:
      'The monthly statement import errors with "invalid format" since the bank changed the export.',
    type: 'Incident',
    priority: 'P2 - High',
    category: 'Software',
    sub: 'Line of business app',
  },
  {
    subject: 'Request: Teams Phone number for reception',
    description: 'Reception needs a direct Teams Phone number with the Nairobi dialling code.',
    type: 'Service Request',
    priority: 'P3 - Medium',
    category: 'Software',
    sub: 'Microsoft 365',
  },
  {
    subject: 'Power cut corrupted my Outlook profile',
    description:
      'After yesterday\'s outage Outlook will not open: "the set of folders cannot be opened".',
    type: 'Incident',
    priority: 'P2 - High',
    category: 'Email',
    sub: 'Mailbox',
  },
  {
    subject: 'Shared drive quota full',
    description: 'The KE-Legal share reports no free space. Users cannot save.',
    type: 'Incident',
    priority: 'P2 - High',
    category: 'Software',
  },
  {
    subject: 'VPN to Johannesburg very slow in the afternoons',
    description: 'File transfers to JHB crawl after 14:00 most days.',
    type: 'Problem',
    priority: 'P3 - Medium',
    category: 'Network & Connectivity',
    sub: 'VPN',
  },
  {
    subject: 'Question about the public holiday calendar',
    description:
      'Does the SLA clock pause on Madaraka Day? Client is asking about response commitments.',
    type: 'Query',
    priority: 'P4 - Low',
    category: 'Software',
  },
  {
    subject: 'Mobile data bundle for the litigation team',
    description: 'Three lawyers need data bundles for a two-week matter in Kisumu.',
    type: 'Service Request',
    priority: 'P3 - Medium',
    category: 'Hardware',
    sub: 'Mobile device',
  },
  {
    subject: 'Scanner sends blank pages to email',
    description: 'Scan-to-email arrives as blank PDFs from the first floor MFD.',
    type: 'Incident',
    priority: 'P3 - Medium',
    category: 'Hardware',
    sub: 'Printer',
  },
  {
    subject: 'Leaver: revoke access for a paralegal',
    description: 'Last day was Friday. Please disable all accounts and archive the mailbox.',
    type: 'Service Request',
    priority: 'P2 - High',
    category: 'Access & Accounts',
  },
  {
    subject: 'Suspicious login alert on my account',
    description:
      'Received an alert about a sign-in from an unfamiliar location. I have changed my password.',
    type: 'Incident',
    priority: 'P1 - Critical',
    category: 'Access & Accounts',
  },
  {
    subject: 'Cannot join Teams meetings from the boardroom device',
    description:
      'The boardroom Teams Rooms device shows "sign-in required" and nobody knows the account.',
    type: 'Incident',
    priority: 'P2 - High',
    category: 'Hardware',
  },
  {
    subject: 'Excel add-in for the tax team',
    description: 'Please install the KRA iTax add-in on the four tax team machines.',
    type: 'Service Request',
    priority: 'P4 - Low',
    category: 'Software',
    sub: 'Licensing',
  },
  {
    subject: 'Website is unreachable from the office only',
    description: 'Our own site loads on mobile data but not from the office network.',
    type: 'Incident',
    priority: 'P3 - Medium',
    category: 'Network & Connectivity',
    sub: 'Internet',
  },
  {
    subject: 'Laptop battery swells',
    description: 'Battery is visibly bulging on a 3-year-old laptop. Not using it until advised.',
    type: 'Incident',
    priority: 'P1 - Critical',
    category: 'Hardware',
    sub: 'Laptop',
  },
  {
    subject: 'Distribution list for the Mombasa office',
    description: 'Create mombasa-all@example.com with the six Mombasa staff.',
    type: 'Service Request',
    priority: 'P4 - Low',
    category: 'Email',
    sub: 'Distribution list',
  },
  {
    subject: 'How to share a calendar with an external counsel',
    description: 'Need to share availability with external counsel for a two-month matter.',
    type: 'Query',
    priority: 'P4 - Low',
    category: 'Email',
  },
];

const AGENT_REPLIES = [
  'Thanks, I have picked this up. Could you confirm which machine you are on and whether it happens on Wi-Fi and cable?',
  'I have reproduced this. Working on it now and will update you within the hour.',
  'A fix has been applied on our side. Could you try again and let me know?',
  'This needs a part from the supplier; expected in two working days. I will keep the ticket open.',
  'Resolved: the setting had been reset by the last update. It is now corrected and pinned.',
];
const REQUESTER_REPLIES = [
  'Thanks, that seems to have fixed it.',
  'Still happening after the restart, unfortunately.',
  'Confirmed, working now. Appreciate the quick turnaround.',
  'It is on the office network, Wi-Fi mostly.',
];
const INTERNAL_NOTES = [
  'Checked the event log: repeated 1014 errors from the driver. Likely the same root cause as last month.',
  'Escalated to the network vendor, reference VND-4471.',
  'Requester is a partner; keep updates frequent.',
  'Workaround in place; permanent fix depends on the change request.',
];
const CSAT_COMMENTS = [
  'Quick and clear, thank you.',
  'Took a while but sorted in the end.',
  'Great service.',
  'Had to chase twice.',
  null,
  null,
];

type Outcome =
  'resolved' | 'closed' | 'reopened' | 'in_progress' | 'awaiting' | 'on_hold' | 'new' | 'cancelled';
function outcomeFor(): Outcome {
  const r = rand();
  if (r < 0.36) return 'resolved';
  if (r < 0.52) return 'closed';
  if (r < 0.58) return 'reopened';
  if (r < 0.76) return 'in_progress';
  if (r < 0.84) return 'awaiting';
  if (r < 0.88) return 'on_hold';
  if (r < 0.96) return 'new';
  return 'cancelled';
}

/** Wall-clock SLA targets by priority, hours. Demo only; Phase 2 computes these. */
const SLA_HOURS: Record<Seed['priority'], { response: number; resolution: number }> = {
  'P1 - Critical': { response: 1, resolution: 4 },
  'P2 - High': { response: 4, resolution: 24 },
  'P3 - Medium': { response: 8, resolution: 72 },
  'P4 - Low': { response: 24, resolution: 120 },
};

/** Agent profiles that make the leaderboard tell a story. */
type Profile = {
  share: number;
  responseHours: [number, number];
  resolveHours: [number, number];
  csat: readonly number[];
  reopenChance: number;
};
const PROFILES: Record<string, Profile> = {
  careful: {
    share: 0.3,
    responseHours: [0.3, 2],
    resolveHours: [2, 30],
    csat: [4, 5, 5, 5],
    reopenChance: 0.02,
  },
  volume: {
    share: 0.45,
    responseHours: [1, 12],
    resolveHours: [1, 20],
    csat: [2, 3, 3, 4, 5],
    reopenChance: 0.25,
  },
  steady: {
    share: 0.25,
    responseHours: [0.5, 6],
    resolveHours: [4, 48],
    csat: [3, 4, 4, 5],
    reopenChance: 0.08,
  },
};

/**
 * A requester who is not a member of the group cannot call addComment (no
 * capability); their replies arrive by email. Write the row the way the mail
 * ingester does, with the same service-visible shape.
 */
async function requesterComment(
  author: Actor,
  ctx: GroupContext,
  input: { ticketId: string; body: string; isInternal: boolean },
) {
  await db().ticketComment.create({
    data: {
      helpDeskGroupId: ctx.helpDeskGroupId,
      ticketId: input.ticketId,
      authorId: author.userId,
      body: input.body,
      isInternal: input.isInternal,
      source: 'EMAIL',
    },
  });
  await db().ticketEvent.create({
    data: {
      helpDeskGroupId: ctx.helpDeskGroupId,
      ticketId: input.ticketId,
      actorId: author.userId,
      type: 'COMMENT_ADDED',
    },
  });
}

async function backdateActivity(ticketId: string, since: Date, at: Date) {
  await db().ticketEvent.updateMany({
    where: { ticketId, createdAt: { gte: since } },
    data: { createdAt: at },
  });
  await db().ticketComment.updateMany({
    where: { ticketId, createdAt: { gte: since } },
    data: { createdAt: at, updatedAt: at },
  });
}

async function loadTicketsForGroup(input: {
  group: { id: string; key: string; name: string; observerScope: GroupContext['observerScope'] };
  seeds: Seed[];
  admin: Actor;
  agents: Array<{ actor: Actor; profile: Profile }>;
  requesters: Actor[];
  observer: Actor | null;
}) {
  const { group, seeds, admin, agents, requesters, observer } = input;
  const adminCtx = contextFor(admin, group);
  const options = await ticketFormOptions(adminCtx);
  const byName = <T extends { name: string }>(items: T[], name: string | undefined, fallback: T) =>
    items.find((item) => item.name === name) ?? fallback;
  const statusByCategory = (category: string) =>
    options.statuses.find((status) => status.category === category)!;

  const counts = { created: 0, resolved: 0, csat: 0 };

  for (const seed of seeds) {
    const outcome = outcomeFor();
    // Weighted towards the current month so the leaderboard (month-to-date)
    // ranks every agent, with a tail back to ~60 days for the closed ones.
    const createdAt = daysAgo(
      outcome === 'new'
        ? between(0.1, 4)
        : chance(0.6)
          ? between(0.5, 11)
          : between(11, outcome === 'closed' ? 60 : 45),
    );
    const requester = pick(requesters);
    const creator = chance(0.4) ? admin : pick(agents).actor;
    const creatorCtx = contextFor(creator, group);

    const type = byName(options.types, seed.type, options.types[0]!);
    const priority = byName(options.priorities, seed.priority, options.priorities[0]!);
    const category = seed.category
      ? options.categories.find((c) => c.name === seed.category)
      : undefined;
    const sub =
      category && seed.sub ? category.subCategories.find((s) => s.name === seed.sub) : undefined;

    // Pick an agent by profile share.
    const roll = rand();
    let acc = 0;
    let agent = agents[0]!;
    for (const candidate of agents) {
      acc += candidate.profile.share;
      if (roll <= acc) {
        agent = candidate;
        break;
      }
    }
    const agentCtx = contextFor(agent.actor, group);

    let mark = new Date();
    const ticket = await createTicket(creator, creatorCtx, {
      subject: seed.subject,
      description: seed.description,
      typeId: type.id,
      priorityId: priority.id,
      categoryId: category?.id,
      subCategoryId: sub?.id,
      requesterId: requester.userId,
      watcherIds: observer && chance(0.3) ? [observer.userId] : [],
    });
    counts.created += 1;
    await backdateActivity(ticket.id, mark, createdAt);

    const sla = SLA_HOURS[seed.priority];
    const ticketPatch: Record<string, unknown> = {
      createdAt,
      updatedAt: createdAt,
      firstResponseDueAt: plus(createdAt, sla.response),
      resolutionDueAt: plus(createdAt, sla.resolution),
    };

    if (outcome === 'new') {
      await db().ticket.update({ where: { id: ticket.id }, data: ticketPatch });
      continue;
    }

    if (outcome === 'cancelled') {
      mark = new Date();
      await updateTicket(admin, adminCtx, {
        ticketId: ticket.id,
        statusId: statusByCategory('CANCELLED').id,
      });
      const at = plus(createdAt, between(2, 30));
      await backdateActivity(ticket.id, mark, at);
      await db().ticket.update({
        where: { id: ticket.id },
        data: { ...ticketPatch, updatedAt: at, closedAt: at },
      });
      continue;
    }

    // Assignment, then the first public reply (which stops the response clock).
    const assignedAt = plus(createdAt, between(0.2, 6));
    mark = new Date();
    await updateTicket(admin, adminCtx, {
      ticketId: ticket.id,
      assigneeId: agent.actor.userId,
      statusId: statusByCategory('OPEN').id,
    });
    await backdateActivity(ticket.id, mark, assignedAt);

    const respondedAt = plus(assignedAt, between(...agent.profile.responseHours));
    mark = new Date();
    await addComment(agent.actor, agentCtx, {
      ticketId: ticket.id,
      body: pick(AGENT_REPLIES),
      isInternal: false,
    });
    await backdateActivity(ticket.id, mark, respondedAt);
    ticketPatch.firstRespondedAt = respondedAt;

    let lastAt = respondedAt;
    if (chance(0.5)) {
      lastAt = plus(lastAt, between(0.5, 8));
      mark = new Date();
      await addComment(agent.actor, agentCtx, {
        ticketId: ticket.id,
        body: pick(INTERNAL_NOTES),
        isInternal: true,
      });
      await backdateActivity(ticket.id, mark, lastAt);
    }
    if (chance(0.6)) {
      lastAt = plus(lastAt, between(0.5, 12));
      mark = new Date();
      await requesterComment(requester, contextFor(requester, group), {
        ticketId: ticket.id,
        body: pick(REQUESTER_REPLIES),
        isInternal: false,
      });
      await backdateActivity(ticket.id, mark, lastAt);
    }

    if (outcome === 'in_progress') {
      await db().ticket.update({
        where: { id: ticket.id },
        data: { ...ticketPatch, updatedAt: lastAt },
      });
      continue;
    }
    if (outcome === 'awaiting' || outcome === 'on_hold') {
      lastAt = plus(lastAt, between(0.5, 6));
      mark = new Date();
      await updateTicket(agent.actor, agentCtx, {
        ticketId: ticket.id,
        statusId: statusByCategory(outcome === 'awaiting' ? 'PENDING' : 'ON_HOLD').id,
      });
      await backdateActivity(ticket.id, mark, lastAt);
      await db().ticket.update({
        where: { id: ticket.id },
        data: { ...ticketPatch, updatedAt: lastAt },
      });
      continue;
    }

    // Resolved, possibly reopened once, possibly closed.
    let resolvedAt = plus(lastAt, between(...agent.profile.resolveHours));
    mark = new Date();
    await updateTicket(agent.actor, agentCtx, {
      ticketId: ticket.id,
      statusId: statusByCategory('RESOLVED').id,
    });
    await backdateActivity(ticket.id, mark, resolvedAt);

    let reopenCount = 0;
    if (outcome === 'reopened' || chance(agent.profile.reopenChance)) {
      const reopenedAt = plus(resolvedAt, between(4, 48));
      mark = new Date();
      await requesterComment(requester, contextFor(requester, group), {
        ticketId: ticket.id,
        body: 'Still happening after the restart, unfortunately.',
        isInternal: false,
      });
      await updateTicket(admin, adminCtx, {
        ticketId: ticket.id,
        statusId: statusByCategory('OPEN').id,
      });
      await backdateActivity(ticket.id, mark, reopenedAt);
      reopenCount = 1;

      resolvedAt = plus(reopenedAt, between(2, 24));
      mark = new Date();
      await addComment(agent.actor, agentCtx, {
        ticketId: ticket.id,
        body: 'Apologies, the first fix did not hold. Root cause found and corrected this time.',
        isInternal: false,
      });
      await updateTicket(agent.actor, agentCtx, {
        ticketId: ticket.id,
        statusId: statusByCategory('RESOLVED').id,
      });
      await backdateActivity(ticket.id, mark, resolvedAt);
    }
    counts.resolved += 1;

    let closedAt: Date | null = null;
    if (outcome === 'closed' || (resolvedAt.getTime() < now.getTime() - 7 * DAY && chance(0.6))) {
      closedAt = plus(resolvedAt, between(24, 120));
      if (closedAt.getTime() < now.getTime()) {
        mark = new Date();
        await updateTicket(admin, adminCtx, {
          ticketId: ticket.id,
          statusId: statusByCategory('CLOSED').id,
        });
        await backdateActivity(ticket.id, mark, closedAt);
      } else {
        closedAt = null;
      }
    }

    await db().ticket.update({
      where: { id: ticket.id },
      data: {
        ...ticketPatch,
        updatedAt: closedAt ?? resolvedAt,
        resolvedAt,
        closedAt,
        reopenCount,
      },
    });

    if (chance(0.7)) {
      await db().csatResponse.create({
        data: {
          helpDeskGroupId: group.id,
          ticketId: ticket.id,
          rating: pick(agent.profile.csat),
          comment: pick(CSAT_COMMENTS),
          respondentId: requester.userId,
          createdAt: plus(resolvedAt, between(1, 30)),
        },
      });
      counts.csat += 1;
    }
  }

  return counts;
}

// ---------------------------------------------------------------------------
// Change requests
// ---------------------------------------------------------------------------
async function loadChangesForGroup(input: {
  group: { id: string; key: string; name: string; observerScope: GroupContext['observerScope'] };
  admin: Actor;
  owner: Actor;
  actorsByUserId: Map<string, Actor>;
  linkTicketSubject: string;
}) {
  const { group, admin, owner, actorsByUserId } = input;
  const adminCtx = contextFor(admin, group);
  const ownerCtx = contextFor(owner, group);
  const options = await changeFormOptions(adminCtx);
  const risk = (name: string) =>
    options.riskLevels.find((r) => r.name === name) ?? options.riskLevels[0]!;
  const type = (name: string) => options.types.find((t) => t.name === name) ?? options.types[0]!;
  const category = (name: string) =>
    options.categories?.find((c: { name: string }) => c.name === name)?.id;

  const cab = await db().cab.findFirst({
    where: { helpDeskGroupId: group.id, isActive: true },
    include: { members: true },
  });
  const voters = cab
    ? cab.members
        .filter((m) => m.isVoting)
        .map((m) => actorsByUserId.get(m.userId))
        .filter((a): a is Actor => Boolean(a))
    : [];

  const linked = await db().ticket.findFirst({
    where: { helpDeskGroupId: group.id, subject: input.linkTicketSubject },
    select: { id: true },
  });

  const plans = {
    implementationPlan:
      '1. Announce the window.\n2. Snapshot the current state.\n3. Apply the change.\n4. Verify with the test plan.\n5. Close the window.',
    rollbackPlan:
      'Restore the snapshot taken in step 2 and re-run the verification. Expected rollback time: 30 minutes.',
    testPlan: 'Smoke test sign-in, ticket creation and one report from two workstations.',
    impactAssessment:
      'Brief interruption to the affected service during the window; no data change.',
  };
  const noticeStart = (hours: number) => new Date(now.getTime() + (hours + 48) * HOUR);
  let created = 0;

  async function backdateChange(
    id: string,
    since: Date,
    at: Date,
    patch: Record<string, unknown> = {},
  ) {
    await db().changeEvent.updateMany({
      where: { changeRequestId: id, createdAt: { gte: since } },
      data: { createdAt: at },
    });
    await db().changeRequest.update({ where: { id }, data: { updatedAt: at, ...patch } });
  }

  /** Vote in turn; stop as soon as the board has decided (quorum may be < members). */
  async function voteUntilDecided(changeId: string, from: Date, startHours: number) {
    let hours = startHours;
    for (const voter of voters) {
      const current = await db().changeRequest.findUniqueOrThrow({
        where: { id: changeId },
        select: { status: true },
      });
      if (current.status !== 'PENDING_APPROVAL') break;
      const mark = new Date();
      await recordDecision(voter, contextFor(voter, group), {
        changeRequestId: changeId,
        decision: 'APPROVED',
        comment: chance(0.5) ? 'Approved.' : undefined,
      });
      await backdateChange(changeId, mark, plus(from, hours));
      hours += 8;
    }
    return hours;
  }

  // 1. Completed, low risk, no CAB.
  {
    const r = risk('Low');
    let mark = new Date();
    const change = await createChange(owner, ownerCtx, {
      title: 'Rotate the guest Wi-Fi pre-shared key',
      description: 'Quarterly rotation of the guest network key, as per the wireless policy.',
      changeTypeId: type('Standard').id,
      riskLevelId: r.id,
      changeCategoryId: category('Network'),
      ownerId: owner.userId,
      plannedStartAt: noticeStart(r.minimumNoticeHours),
      plannedEndAt: new Date(noticeStart(r.minimumNoticeHours).getTime() + HOUR),
      ...plans,
    });
    created += 1;
    const t0 = daysAgo(20);
    await backdateChange(change.id, mark, t0, { createdAt: t0 });
    mark = new Date();
    await submitChange(owner, ownerCtx, { changeRequestId: change.id });
    await backdateChange(change.id, mark, plus(t0, 2), { submittedAt: plus(t0, 2) });
    for (const [to, hours] of [
      ['SCHEDULED', 6],
      ['IN_PROGRESS', 72],
      ['COMPLETED', 73],
    ] as const) {
      mark = new Date();
      await transitionChange(owner, ownerCtx, {
        changeRequestId: change.id,
        to,
        outcomeNotes:
          to === 'COMPLETED' ? 'Key rotated and circulated to reception. No issues.' : undefined,
      });
      await backdateChange(change.id, mark, plus(t0, hours));
    }
    await db().changeRequest.update({
      where: { id: change.id },
      data: {
        plannedStartAt: plus(t0, 72),
        plannedEndAt: plus(t0, 73),
        actualStartAt: plus(t0, 72),
        actualEndAt: plus(t0, 73),
      },
    });
  }

  // 2. Pending approval, high risk: one vote in, the board's decision outstanding.
  if (voters.length > 0) {
    const r = risk('High');
    let mark = new Date();
    const change = await createChange(owner, ownerCtx, {
      title: 'Upgrade the document management server to the 2026 release',
      description:
        'Vendor-supported upgrade of the DMS application tier. Required before the vendor drops support for the current release.',
      changeTypeId: type('Normal').id,
      riskLevelId: r.id,
      changeCategoryId: category('Application'),
      ownerId: owner.userId,
      plannedStartAt: noticeStart(r.minimumNoticeHours),
      plannedEndAt: new Date(noticeStart(r.minimumNoticeHours).getTime() + 4 * HOUR),
      linkedTicketId: linked?.id,
      ...plans,
    });
    created += 1;
    const t0 = daysAgo(3);
    await backdateChange(change.id, mark, t0, { createdAt: t0 });
    mark = new Date();
    await submitChange(owner, ownerCtx, { changeRequestId: change.id, cabId: cab?.id });
    await backdateChange(change.id, mark, plus(t0, 4), { submittedAt: plus(t0, 4) });
    const first = voters[0]!;
    mark = new Date();
    await recordDecision(first, contextFor(first, group), {
      changeRequestId: change.id,
      decision: 'APPROVED',
      comment: 'Plan looks solid. Confirm the vendor engineer is on the call.',
    });
    await backdateChange(change.id, mark, plus(t0, 20));
  }

  // 3. Approved and scheduled, high risk: full board approval.
  if (voters.length > 0) {
    const r = risk('High');
    let mark = new Date();
    const change = await createChange(admin, adminCtx, {
      title: 'Replace the core switch in the Johannesburg server room',
      description:
        'End-of-life core switch replacement. Cut-over during the Saturday maintenance window.',
      changeTypeId: type('Normal').id,
      riskLevelId: r.id,
      changeCategoryId: category('Infrastructure'),
      ownerId: admin.userId,
      plannedStartAt: noticeStart(r.minimumNoticeHours + 96),
      plannedEndAt: new Date(noticeStart(r.minimumNoticeHours + 96).getTime() + 6 * HOUR),
      ...plans,
    });
    created += 1;
    const t0 = daysAgo(9);
    await backdateChange(change.id, mark, t0, { createdAt: t0 });
    mark = new Date();
    await submitChange(admin, adminCtx, { changeRequestId: change.id, cabId: cab?.id });
    await backdateChange(change.id, mark, plus(t0, 3), { submittedAt: plus(t0, 3) });
    const hours = await voteUntilDecided(change.id, t0, 10);
    const current = await db().changeRequest.findUniqueOrThrow({
      where: { id: change.id },
      select: { status: true },
    });
    if (current.status === 'APPROVED') {
      mark = new Date();
      await transitionChange(admin, adminCtx, { changeRequestId: change.id, to: 'SCHEDULED' });
      await backdateChange(change.id, mark, plus(t0, hours), { decidedAt: plus(t0, hours - 8) });
    }
  }

  // 4. Rejected, critical risk.
  if (voters.length > 0) {
    const r = risk('Critical');
    let mark = new Date();
    const change = await createChange(owner, ownerCtx, {
      title: 'Disable MFA for the finance team during month-end',
      description:
        'Finance has asked for MFA prompts to be suppressed for the last three days of the month.',
      changeTypeId: type('Normal').id,
      riskLevelId: r.id,
      changeCategoryId: category('Security'),
      ownerId: owner.userId,
      plannedStartAt: noticeStart(r.minimumNoticeHours),
      plannedEndAt: new Date(noticeStart(r.minimumNoticeHours).getTime() + 72 * HOUR),
      ...plans,
      impactAssessment:
        'Removes a security control for a privileged team. Increases account-takeover risk during the period.',
    });
    created += 1;
    const t0 = daysAgo(15);
    await backdateChange(change.id, mark, t0, { createdAt: t0 });
    mark = new Date();
    await submitChange(owner, ownerCtx, { changeRequestId: change.id, cabId: cab?.id });
    await backdateChange(change.id, mark, plus(t0, 1), { submittedAt: plus(t0, 1) });
    const chair =
      voters.find((v) => cab!.members.some((m) => m.userId === v.userId && m.isChair)) ??
      voters[0]!;
    mark = new Date();
    await recordDecision(chair, contextFor(chair, group), {
      changeRequestId: change.id,
      decision: 'REJECTED',
      comment: 'Not acceptable. Raise a request for number-matching exceptions per user instead.',
    });
    await backdateChange(change.id, mark, plus(t0, 26), { decidedAt: plus(t0, 26) });
  }

  // 5. Failed and rolled back, medium risk.
  {
    const r = risk('Medium');
    let mark = new Date();
    const change = await createChange(owner, ownerCtx, {
      title: 'Apply the September firewall firmware update',
      description: 'Vendor firmware update addressing two published CVEs.',
      changeTypeId: type('Normal').id,
      riskLevelId: r.id,
      changeCategoryId: category('Security'),
      ownerId: owner.userId,
      plannedStartAt: noticeStart(r.minimumNoticeHours),
      plannedEndAt: new Date(noticeStart(r.minimumNoticeHours).getTime() + 2 * HOUR),
      ...plans,
    });
    created += 1;
    const t0 = daysAgo(11);
    await backdateChange(change.id, mark, t0, { createdAt: t0 });
    mark = new Date();
    await submitChange(owner, ownerCtx, { changeRequestId: change.id, cabId: cab?.id });
    await backdateChange(change.id, mark, plus(t0, 2), { submittedAt: plus(t0, 2) });
    const status = await db().changeRequest.findUniqueOrThrow({
      where: { id: change.id },
      select: { status: true },
    });
    if (status.status === 'PENDING_APPROVAL') await voteUntilDecided(change.id, t0, 6);
    for (const [to, hours, notes] of [
      ['SCHEDULED', 14, undefined],
      ['IN_PROGRESS', 96, undefined],
      ['FAILED', 97, 'Firmware caused the HA pair to split-brain during the window.'],
      [
        'ROLLED_BACK',
        98,
        'Firmware caused the HA pair to split-brain. Rolled back to the previous image; vendor case opened.',
      ],
    ] as const) {
      mark = new Date();
      await transitionChange(owner, ownerCtx, {
        changeRequestId: change.id,
        to,
        outcomeNotes: notes,
      });
      await backdateChange(change.id, mark, plus(t0, hours));
    }
    await db().changeRequest.update({
      where: { id: change.id },
      data: {
        plannedStartAt: plus(t0, 96),
        plannedEndAt: plus(t0, 98),
        actualStartAt: plus(t0, 96),
        actualEndAt: plus(t0, 98),
      },
    });
  }

  // 6. Draft, linked to an incident.
  {
    const r = risk('Medium');
    const mark = new Date();
    const change = await createChange(owner, ownerCtx, {
      title: 'Increase DMS check-in timeout for large files',
      description:
        'Raise the application-tier upload timeout from 120 s to 600 s to stop large check-ins failing.',
      changeTypeId: type('Normal').id,
      riskLevelId: r.id,
      changeCategoryId: category('Application'),
      ownerId: owner.userId,
      linkedTicketId: linked?.id,
      plannedStartAt: undefined,
      plannedEndAt: undefined,
      implementationPlan: plans.implementationPlan,
    });
    created += 1;
    await backdateChange(change.id, mark, daysAgo(1), { createdAt: daysAgo(1) });
  }

  return created;
}

// ---------------------------------------------------------------------------
type Snapshot = Record<string, { ticketSequence: number; changeSequence: number }>;

/** Per-group counters before loading: anything numbered above them is demo data. */
async function snapshotSequences(): Promise<Snapshot> {
  const groups = await db().helpDeskGroup.findMany({
    select: { id: true, ticketSequence: true, changeSequence: true },
  });
  return Object.fromEntries(
    groups.map((g) => [
      g.id,
      { ticketSequence: g.ticketSequence, changeSequence: g.changeSequence },
    ]),
  );
}

/** Remove everything numbered after the snapshot. Counters are never rewound (invariant 6). */
async function removeDemoData(snapshot: Snapshot) {
  let tickets = 0;
  let changes = 0;
  for (const [helpDeskGroupId, before] of Object.entries(snapshot)) {
    const ticketIds = (
      await db().ticket.findMany({
        where: { helpDeskGroupId, sequence: { gt: before.ticketSequence } },
        select: { id: true },
      })
    ).map((t) => t.id);
    if (ticketIds.length > 0) {
      await db().csatResponse.deleteMany({ where: { ticketId: { in: ticketIds } } });
      await db().ticketComment.deleteMany({ where: { ticketId: { in: ticketIds } } });
      await db().ticketEvent.deleteMany({ where: { ticketId: { in: ticketIds } } });
      await db().ticketWatcher.deleteMany({ where: { ticketId: { in: ticketIds } } });
      await db().outboundEmail.deleteMany({ where: { ticketId: { in: ticketIds } } });
      await db().ticket.deleteMany({ where: { id: { in: ticketIds } } });
      tickets += ticketIds.length;
    }
    const changeIds = (
      await db().changeRequest.findMany({
        where: { helpDeskGroupId, sequence: { gt: before.changeSequence } },
        select: { id: true },
      })
    ).map((c) => c.id);
    if (changeIds.length > 0) {
      await db().changeApproval.deleteMany({ where: { changeRequestId: { in: changeIds } } });
      await db().changeEvent.deleteMany({ where: { changeRequestId: { in: changeIds } } });
      await db().ticket.updateMany({
        where: { changeRequestId: { in: changeIds } },
        data: { changeRequestId: null },
      });
      await db().changeRequest.deleteMany({ where: { id: { in: changeIds } } });
      changes += changeIds.length;
    }
  }
  await db().auditLog.deleteMany({ where: { action: { in: ['demo.start', 'demo.load'] } } });
  console.log(`Removed ${tickets} demo tickets and ${changes} demo changes.`);
}

async function main() {
  const reset = process.argv.includes('--reset');
  const started = await db().auditLog.findFirst({ where: { action: 'demo.start' } });
  const already = await db().auditLog.findFirst({ where: { action: 'demo.load' } });
  if (reset && started) {
    await removeDemoData(started.after as Snapshot);
  } else if (already) {
    console.log(
      `Demo data already loaded on ${already.createdAt.toISOString()}. Use --reset to remove and reload it.`,
    );
    return;
  } else if (started) {
    console.log('A previous demo load did not finish. Run with --reset to clean up and reload.');
    process.exitCode = 1;
    return;
  }
  await db().auditLog.create({
    data: {
      action: 'demo.start',
      entityType: 'DemoData',
      actorEmail: 'demo@example.com',
      after: await snapshotSequences(),
    },
  });

  const groups = await db().helpDeskGroup.findMany({ where: { key: { in: ['ITHD', 'KEN'] } } });
  const ithd = groups.find((g) => g.key === 'ITHD');
  const ken = groups.find((g) => g.key === 'KEN');
  if (!ithd || !ken) throw new Error('Seed first (npm run db:seed): ITHD / KEN not found');

  const [itAdmin, itAgent1, itAgent2, itObserver, keAdmin, keAgent, dual, requester] =
    await Promise.all(
      [
        'it.admin@example.com',
        'it.agent1@example.com',
        'it.agent2@example.com',
        'it.observer@example.com',
        'ke.admin@example.com',
        'ke.agent@example.com',
        'dual.role@example.com',
        'requester@example.com',
      ].map(loadActor),
    );
  const actorsByUserId = new Map(
    [itAdmin, itAgent1, itAgent2, itObserver, keAdmin, keAgent, dual, requester].map((a) => [
      a!.userId,
      a!,
    ]),
  );

  console.log('Loading ITHD tickets…');
  const it = await loadTicketsForGroup({
    group: ithd,
    seeds: IT_TICKETS,
    admin: itAdmin!,
    agents: [
      { actor: itAgent1!, profile: PROFILES.careful! },
      { actor: itAgent2!, profile: PROFILES.volume! },
      { actor: dual!, profile: PROFILES.steady! },
    ],
    requesters: [requester!, requester!, itObserver!, itAgent2!],
    observer: itObserver!,
  });
  console.log(`  ${it.created} tickets, ${it.resolved} resolved, ${it.csat} CSAT responses`);

  console.log('Loading KEN tickets…');
  const ke = await loadTicketsForGroup({
    group: ken,
    seeds: KE_TICKETS,
    admin: keAdmin!,
    agents: [
      { actor: keAgent!, profile: PROFILES.steady! },
      { actor: dual!, profile: PROFILES.careful! },
    ],
    requesters: [requester!, requester!, keAgent!],
    observer: null,
  });
  console.log(`  ${ke.created} tickets, ${ke.resolved} resolved, ${ke.csat} CSAT responses`);

  console.log('Loading change requests…');
  const itChanges = await loadChangesForGroup({
    group: ithd,
    admin: itAdmin!,
    owner: itAgent1!,
    actorsByUserId,
    linkTicketSubject: 'Recurring: DMS check-in fails on large files',
  });
  const keChanges = await loadChangesForGroup({
    group: ken,
    admin: keAdmin!,
    owner: keAgent!,
    actorsByUserId,
    linkTicketSubject: 'VPN to Johannesburg very slow in the afternoons',
  });
  console.log(`  ${itChanges} in ITHD, ${keChanges} in KEN`);

  await db().auditLog.create({
    data: {
      action: 'demo.load',
      entityType: 'DemoData',
      actorEmail: 'demo@example.com',
      after: {
        tickets: it.created + ke.created,
        changes: itChanges + keChanges,
        loadedAt: now.toISOString(),
      },
    },
  });
  console.log('Done.');
}

main()
  .catch((error) => {
    console.error('demo-data failed:', error);
    process.exitCode = 1;
  })
  .finally(() => disconnectDb());
