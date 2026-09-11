/**
 * Seed data.
 *
 * Idempotent: safe to run on every container start (the dev entrypoint does).
 * Users and groups are upserted by their natural keys; sample tickets are only
 * created for a group that has none, so re-seeding never inflates the counts.
 *
 * The point of the two groups is to make the tenancy behaviour obvious the
 * moment you log in: different ticket prefixes, different calendars, different
 * taxonomy, and one person who holds a different role in each.
 */
import 'dotenv/config';
import {
  ApprovalDecision,
  ChangeStatus,
  GroupRole,
  ObserverScope,
  PlatformRole,
  TicketSource,
} from '../src/generated/prisma/enums';
import type { PrismaClient } from '../src/generated/prisma/client';
import { db, disconnectDb } from '../src/lib/db/client';
import { provisionGroupDefaults } from '../src/lib/groups/service';
import { formatTicketReference } from '../src/lib/tickets/reference';
import { formatChangeReference } from '../src/lib/changes/reference';

type Client = PrismaClient;

const SUPER_ADMIN_EMAIL =
  process.env.SUPER_ADMIN_EMAILS?.split(',')[0]?.trim().toLowerCase() || 'superadmin@example.com';

/** South African public holidays, 2026. */
const SA_HOLIDAYS_2026 = [
  ['2026-01-01', "New Year's Day"],
  ['2026-03-21', 'Human Rights Day'],
  ['2026-04-03', 'Good Friday'],
  ['2026-04-06', 'Family Day'],
  ['2026-04-27', 'Freedom Day'],
  ['2026-05-01', "Workers' Day"],
  ['2026-06-16', 'Youth Day'],
  ['2026-08-09', "National Women's Day"],
  ['2026-09-24', 'Heritage Day'],
  ['2026-12-16', 'Day of Reconciliation'],
  ['2026-12-25', 'Christmas Day'],
  ['2026-12-26', 'Day of Goodwill'],
] as const;

/**
 * Kenyan public holidays, 2026.
 * NOTE: Eid al-Fitr and Eid al-Adha are lunar and gazetted each year, so they
 * are deliberately absent -- an administrator adds them via the calendar UI.
 */
const KE_HOLIDAYS_2026 = [
  ['2026-01-01', "New Year's Day"],
  ['2026-04-03', 'Good Friday'],
  ['2026-04-06', 'Easter Monday'],
  ['2026-05-01', 'Labour Day'],
  ['2026-06-01', 'Madaraka Day'],
  ['2026-10-10', 'Utamaduni Day'],
  ['2026-10-20', 'Mashujaa Day'],
  ['2026-12-12', 'Jamhuri Day'],
  ['2026-12-25', 'Christmas Day'],
  ['2026-12-26', 'Utamaduni/Boxing Day'],
] as const;

async function upsertUser(
  client: Client,
  input: { email: string; name: string; jobTitle?: string; platformRole?: PlatformRole },
) {
  const email = input.email.toLowerCase();
  return client.user.upsert({
    where: { email },
    create: {
      email,
      name: input.name,
      jobTitle: input.jobTitle ?? null,
      platformRole: input.platformRole ?? null,
    },
    // Deliberately narrow: re-seeding must not undo a role change made in the UI.
    update: { name: input.name, jobTitle: input.jobTitle ?? null },
  });
}

async function upsertMembership(
  client: Client,
  userId: string,
  helpDeskGroupId: string,
  role: GroupRole,
) {
  return client.helpDeskMembership.upsert({
    where: { userId_helpDeskGroupId: { userId, helpDeskGroupId } },
    create: { userId, helpDeskGroupId, role },
    update: {},
  });
}

async function ensureGroup(
  client: Client,
  input: {
    key: string;
    name: string;
    description: string;
    timeZone: string;
    region: string;
    calendarName: string;
    inboundEmailAddress: string;
    observerScope: ObserverScope;
    holidays: readonly (readonly [string, string])[];
  },
) {
  const existing = await client.helpDeskGroup.findUnique({ where: { key: input.key } });
  if (existing) {
    console.log(`  · ${input.name} already exists (${input.key}) — leaving configuration alone`);
    return existing;
  }

  const group = await client.$transaction(async (tx) => {
    const created = await tx.helpDeskGroup.create({
      data: {
        key: input.key,
        name: input.name,
        description: input.description,
        timeZone: input.timeZone,
        inboundEmailAddress: input.inboundEmailAddress,
        outboundEmailAddress: input.inboundEmailAddress,
        observerScope: input.observerScope,
      },
    });

    await provisionGroupDefaults(tx, created.id, {
      timeZone: input.timeZone,
      includeStarterConfig: true,
      calendarName: input.calendarName,
      region: input.region,
    });

    const calendar = await tx.calendar.findFirstOrThrow({
      where: { helpDeskGroupId: created.id, isDefault: true },
    });

    await tx.holiday.createMany({
      data: input.holidays.map(([date, name]) => ({
        helpDeskGroupId: created.id,
        calendarId: calendar.id,
        name,
        date: new Date(`${date}T00:00:00Z`),
      })),
    });

    await tx.auditLog.create({
      data: {
        action: 'help_desk_group.create',
        entityType: 'HelpDeskGroup',
        entityId: created.id,
        helpDeskGroupId: created.id,
        actorEmail: SUPER_ADMIN_EMAIL,
        after: { name: created.name, key: created.key, source: 'seed' },
      },
    });

    return created;
  });

  console.log(`  · created ${group.name} (${group.key}) — ${input.timeZone}`);
  return group;
}

/** A handful of tickets so the dashboards and lists are not empty. */
async function seedSampleTickets(
  client: Client,
  group: { id: string; key: string },
  actors: { requester: string; agents: string[]; creator: string },
) {
  const existing = await client.ticket.count({ where: { helpDeskGroupId: group.id } });
  if (existing > 0) {
    console.log(`  · ${group.key} already has ${existing} ticket(s) — skipping samples`);
    return;
  }

  const [statuses, priorities, types, categories] = await Promise.all([
    client.ticketStatus.findMany({
      where: { helpDeskGroupId: group.id },
      orderBy: { sortOrder: 'asc' },
    }),
    client.priority.findMany({ where: { helpDeskGroupId: group.id }, orderBy: { level: 'asc' } }),
    client.ticketType.findMany({
      where: { helpDeskGroupId: group.id },
      orderBy: { sortOrder: 'asc' },
    }),
    client.category.findMany({
      where: { helpDeskGroupId: group.id },
      include: { subCategories: true },
      orderBy: { sortOrder: 'asc' },
    }),
  ]);

  const samples = [
    {
      subject: 'Laptop will not power on after the weekend',
      description:
        'User reports the laptop shows no lights when connected to the dock. Tried a different charger with no change.',
      statusIndex: 0,
      priorityIndex: 1,
      typeIndex: 0,
      categoryIndex: 0,
      assign: true,
    },
    {
      subject: 'New starter access request for finance team',
      description: 'Access to the finance shared drive, expense system and a Teams licence.',
      statusIndex: 1,
      priorityIndex: 2,
      typeIndex: 1,
      categoryIndex: 3,
      assign: true,
    },
    {
      subject: 'VPN drops every few minutes from the branch office',
      description:
        'Tunnel re-establishes itself but sessions are lost. Started after the ISP router firmware update.',
      statusIndex: 1,
      priorityIndex: 0,
      typeIndex: 0,
      categoryIndex: 2,
      assign: true,
    },
    {
      subject: 'Request for a second monitor',
      description: 'Standing request from the reception desk.',
      statusIndex: 0,
      priorityIndex: 3,
      typeIndex: 1,
      categoryIndex: 0,
      assign: false,
    },
  ];

  for (const [index, sample] of samples.entries()) {
    const status = statuses[sample.statusIndex] ?? statuses[0]!;
    const priority = priorities[sample.priorityIndex] ?? priorities[0]!;
    const type = types[sample.typeIndex] ?? types[0]!;
    const category = categories[sample.categoryIndex];
    const assignee = sample.assign ? actors.agents[index % actors.agents.length] : null;

    await client.$transaction(async (tx) => {
      // Same atomic counter the application uses, so seeded references are
      // indistinguishable from real ones.
      const rows = await tx.$queryRaw<Array<{ ticketSequence: number }>>`
        UPDATE "HelpDeskGroup"
           SET "ticketSequence" = "ticketSequence" + 1
         WHERE "id" = ${group.id}::uuid
        RETURNING "ticketSequence"
      `;
      const sequence = rows[0]!.ticketSequence;

      await tx.ticket.create({
        data: {
          helpDeskGroupId: group.id,
          reference: formatTicketReference(group.key, sequence),
          sequence,
          subject: sample.subject,
          description: sample.description,
          typeId: type.id,
          priorityId: priority.id,
          statusId: status.id,
          categoryId: category?.id ?? null,
          subCategoryId: category?.subCategories[0]?.id ?? null,
          requesterId: actors.requester,
          assigneeId: assignee,
          createdById: actors.creator,
          source: index === 2 ? TicketSource.EMAIL : TicketSource.WEB,
          events: {
            create: { helpDeskGroupId: group.id, actorId: actors.creator, type: 'CREATED' },
          },
          comments: assignee
            ? {
                create: {
                  helpDeskGroupId: group.id,
                  authorId: assignee,
                  body: 'Picked this up — investigating now and will update shortly.',
                  isInternal: false,
                },
              }
            : undefined,
        },
      });
    });
  }

  console.log(`  · seeded ${samples.length} sample tickets in ${group.key}`);
}

/**
 * Sample change requests, plus a populated CAB.
 *
 * A CAB with no voting members can never approve anything, so an empty board is
 * worse than no board -- the seed populates it. Changes use their own counter,
 * so these are ITHD-C-000001 onwards, entirely separate from ticket numbers.
 */
async function seedSampleChanges(
  client: Client,
  group: { id: string; key: string },
  people: { requester: string; owner: string; chair: string; member: string },
) {
  const existing = await client.changeRequest.count({ where: { helpDeskGroupId: group.id } });
  if (existing > 0) {
    console.log(`  · ${group.key} already has ${existing} change(s) — skipping samples`);
    return;
  }

  const cab = await client.cab.findFirst({
    where: { helpDeskGroupId: group.id, isDefault: true },
    include: { members: true },
  });
  if (!cab) {
    console.log(`  · ${group.key} has no default CAB — skipping change samples`);
    return;
  }

  if (cab.members.length === 0) {
    await client.cabMember.createMany({
      data: [
        {
          helpDeskGroupId: group.id,
          cabId: cab.id,
          userId: people.chair,
          isChair: true,
          isVoting: true,
        },
        {
          helpDeskGroupId: group.id,
          cabId: cab.id,
          userId: people.member,
          isChair: false,
          isVoting: true,
        },
        {
          helpDeskGroupId: group.id,
          cabId: cab.id,
          userId: people.owner,
          isChair: false,
          isVoting: true,
        },
      ],
      skipDuplicates: true,
    });
    console.log(`  · ${group.key} CAB populated (chair + 2 voting members, quorum ${cab.quorum})`);
  }

  const [types, risks, categories] = await Promise.all([
    client.changeType.findMany({ where: { helpDeskGroupId: group.id } }),
    client.changeRiskLevel.findMany({
      where: { helpDeskGroupId: group.id },
      orderBy: { level: 'asc' },
    }),
    client.changeCategory.findMany({
      where: { helpDeskGroupId: group.id },
      orderBy: { sortOrder: 'asc' },
    }),
  ]);
  const byName = <T extends { name: string }>(rows: T[], name: string) =>
    rows.find((row) => row.name === name) ?? rows[0]!;

  const day = 24 * 60 * 60 * 1000;
  const samples = [
    {
      title: 'Upgrade core switch firmware to close vendor advisory',
      description:
        'Vendor has published a security advisory affecting the firmware on both core switches. ' +
        'Upgrade during the maintenance window, one switch at a time.',
      type: 'Normal',
      risk: 'High',
      category: 'Network',
      status: ChangeStatus.PENDING_APPROVAL,
      implementationPlan:
        '1. Confirm HSRP failover to switch B.\n2. Upgrade switch A, verify.\n3. Fail back and repeat for B.',
      rollbackPlan: 'Re-flash the prior image from the local bootflash copy; both images retained.',
      testPlan: 'Post-upgrade: verify uplinks, HSRP state, and a sample of VLAN reachability.',
      impactAssessment: 'Brief convergence blips during failover. No user-visible outage expected.',
      startInDays: 9,
      durationHours: 4,
      /** Chair has voted; quorum not yet reached, so it sits awaiting a second. */
      votes: [
        {
          who: 'chair',
          decision: ApprovalDecision.APPROVED,
          comment: 'Advisory is credible; plan is sound.',
        },
      ],
    },
    {
      title: 'Quarterly TLS certificate renewal',
      description: 'Routine renewal of the wildcard certificate on the reverse proxies.',
      type: 'Standard',
      risk: 'Low',
      category: 'Security',
      status: ChangeStatus.COMPLETED,
      implementationPlan: 'Install renewed certificate, reload proxy, verify chain.',
      rollbackPlan: 'Reinstate the previous certificate, which remains valid for 14 days.',
      startInDays: -6,
      durationHours: 1,
      outcomeNotes: 'Completed inside the window. Chain verified externally.',
      votes: [],
    },
    {
      title: 'Migrate file shares to the new storage platform',
      description:
        'Move the departmental shares off the ageing array. Phased by department, starting with the smallest.',
      type: 'Major',
      risk: 'Critical',
      category: 'Infrastructure',
      status: ChangeStatus.DRAFT,
      implementationPlan: 'Phase 1: robocopy seed. Phase 2: delta sync. Phase 3: DFS cutover.',
      rollbackPlan: 'DFS target reverts to the old array; source data left intact until sign-off.',
      startInDays: 21,
      durationHours: 12,
      votes: [],
    },
  ] as const;

  for (const sample of samples) {
    await client.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ changeSequence: number }>>`
        UPDATE "HelpDeskGroup"
           SET "changeSequence" = "changeSequence" + 1
         WHERE "id" = ${group.id}::uuid
        RETURNING "changeSequence"
      `;
      const sequence = rows[0]!.changeSequence;
      const submitted =
        sample.status === ChangeStatus.DRAFT ? null : new Date(Date.now() - 2 * day);
      const start = new Date(Date.now() + sample.startInDays * day);

      const created = await tx.changeRequest.create({
        data: {
          helpDeskGroupId: group.id,
          reference: formatChangeReference(group.key, sequence),
          sequence,
          title: sample.title,
          description: sample.description,
          changeTypeId: byName(types, sample.type).id,
          riskLevelId: byName(risks, sample.risk).id,
          changeCategoryId: byName(categories, sample.category).id,
          status: sample.status,
          requesterId: people.requester,
          ownerId: people.owner,
          cabId: sample.status === ChangeStatus.DRAFT ? null : cab.id,
          impactAssessment: 'impactAssessment' in sample ? sample.impactAssessment : null,
          implementationPlan: sample.implementationPlan,
          rollbackPlan: sample.rollbackPlan,
          testPlan: 'testPlan' in sample ? sample.testPlan : null,
          outcomeNotes: 'outcomeNotes' in sample ? sample.outcomeNotes : null,
          plannedStartAt: start,
          plannedEndAt: new Date(start.getTime() + sample.durationHours * 60 * 60 * 1000),
          actualStartAt: sample.status === ChangeStatus.COMPLETED ? start : null,
          actualEndAt:
            sample.status === ChangeStatus.COMPLETED
              ? new Date(start.getTime() + sample.durationHours * 60 * 60 * 1000)
              : null,
          submittedAt: submitted,
          decidedAt: sample.status === ChangeStatus.COMPLETED ? submitted : null,
          events: {
            create: { helpDeskGroupId: group.id, actorId: people.requester, type: 'CREATED' },
          },
        },
      });

      if (sample.status === ChangeStatus.PENDING_APPROVAL) {
        const members = await tx.cabMember.findMany({ where: { cabId: cab.id } });
        await tx.changeApproval.createMany({
          data: members.map((member) => {
            // `as const` narrows `who`, so test with !== rather than an
            // equality against a literal TypeScript knows cannot occur.
            const vote = sample.votes.find((candidate) =>
              member.isChair ? candidate.who === 'chair' : candidate.who !== 'chair',
            );
            return {
              helpDeskGroupId: group.id,
              changeRequestId: created.id,
              approverId: member.userId,
              isVoting: member.isVoting,
              isChair: member.isChair,
              decision: vote?.decision ?? ApprovalDecision.PENDING,
              comment: vote?.comment ?? null,
              decidedAt: vote ? new Date(Date.now() - day) : null,
            };
          }),
          skipDuplicates: true,
        });
      }
    });
  }

  console.log(`  · seeded ${samples.length} sample change requests in ${group.key}`);
}

async function main() {
  const client = db();
  console.log('Seeding help desk platform…');

  // --- People -------------------------------------------------------------
  const superAdmin = await upsertUser(client, {
    email: SUPER_ADMIN_EMAIL,
    name: 'Platform Super Administrator',
    jobTitle: 'Platform owner',
    platformRole: PlatformRole.SUPER_ADMIN,
  });

  // Promote on every run: this is the account that unblocks a stuck deployment.
  await client.user.update({
    where: { id: superAdmin.id },
    data: { platformRole: PlatformRole.SUPER_ADMIN },
  });
  console.log(`  · super admin: ${superAdmin.email}`);

  const [itAdmin, itAgentOne, itAgentTwo, itObserver, keAdmin, keAgent, dualRole, requester] =
    await Promise.all([
      upsertUser(client, {
        email: 'it.admin@example.com',
        name: 'Thandi Mokoena',
        jobTitle: 'IT Service Manager',
      }),
      upsertUser(client, {
        email: 'it.agent1@example.com',
        name: 'Sipho Dlamini',
        jobTitle: 'Service Desk Analyst',
      }),
      upsertUser(client, {
        email: 'it.agent2@example.com',
        name: 'Anita Pillay',
        jobTitle: 'Service Desk Analyst',
      }),
      upsertUser(client, {
        email: 'it.observer@example.com',
        name: 'Johan van Wyk',
        jobTitle: 'Head of Operations',
      }),
      upsertUser(client, {
        email: 'ke.admin@example.com',
        name: 'Wanjiku Kamau',
        jobTitle: 'Regional IT Manager',
      }),
      upsertUser(client, {
        email: 'ke.agent@example.com',
        name: 'Otieno Ochieng',
        jobTitle: 'IT Support Officer',
      }),
      upsertUser(client, {
        email: 'dual.role@example.com',
        name: 'Fatima Adams',
        jobTitle: 'Group IT Lead',
      }),
      upsertUser(client, {
        email: 'requester@example.com',
        name: 'Lerato Ndlovu',
        jobTitle: 'Paralegal',
      }),
    ]);

  // --- Groups -------------------------------------------------------------
  const itGroup = await ensureGroup(client, {
    key: 'ITHD',
    name: 'IT Help Desk',
    description: 'Central IT service desk for the South African offices.',
    timeZone: 'Africa/Johannesburg',
    region: 'South Africa',
    calendarName: 'South Africa business hours',
    inboundEmailAddress: 'it-helpdesk@example.com',
    observerScope: ObserverScope.WATCHED_ONLY,
    holidays: SA_HOLIDAYS_2026,
  });

  const kenyaGroup = await ensureGroup(client, {
    key: 'KEN',
    name: 'Kenya Help Desk',
    description: 'Local support for the Nairobi office, on Kenyan hours and holidays.',
    timeZone: 'Africa/Nairobi',
    region: 'Kenya',
    calendarName: 'Kenya business hours',
    inboundEmailAddress: 'kenya-helpdesk@example.com',
    // Contrast with ITHD, so the group-level observer setting is visibly per-group.
    observerScope: ObserverScope.ALL_TICKETS,
    holidays: KE_HOLIDAYS_2026,
  });

  // --- Memberships --------------------------------------------------------
  await Promise.all([
    upsertMembership(client, itAdmin.id, itGroup.id, GroupRole.HD_ADMIN),
    upsertMembership(client, itAgentOne.id, itGroup.id, GroupRole.AGENT),
    upsertMembership(client, itAgentTwo.id, itGroup.id, GroupRole.AGENT),
    upsertMembership(client, itObserver.id, itGroup.id, GroupRole.OBSERVER),
    upsertMembership(client, requester.id, itGroup.id, GroupRole.OBSERVER),

    upsertMembership(client, keAdmin.id, kenyaGroup.id, GroupRole.HD_ADMIN),
    upsertMembership(client, keAgent.id, kenyaGroup.id, GroupRole.AGENT),

    // The whole reason HelpDeskMembership exists: one person, two roles.
    upsertMembership(client, dualRole.id, itGroup.id, GroupRole.AGENT),
    upsertMembership(client, dualRole.id, kenyaGroup.id, GroupRole.HD_ADMIN),
  ]);
  console.log('  · memberships assigned (dual.role@example.com is AGENT in ITHD, HD_ADMIN in KEN)');

  // --- Sample tickets ----------------------------------------------------
  await seedSampleTickets(client, itGroup, {
    requester: requester.id,
    agents: [itAgentOne.id, itAgentTwo.id, dualRole.id],
    creator: itAdmin.id,
  });

  await seedSampleTickets(client, kenyaGroup, {
    requester: keAdmin.id,
    agents: [keAgent.id, dualRole.id],
    creator: keAdmin.id,
  });

  await seedSampleChanges(client, itGroup, {
    requester: itAdmin.id,
    owner: itAgentOne.id,
    chair: itAdmin.id,
    member: itAgentTwo.id,
  });

  await seedSampleChanges(client, kenyaGroup, {
    requester: keAdmin.id,
    owner: keAgent.id,
    chair: keAdmin.id,
    member: dualRole.id,
  });

  console.log('\nDone. Sign in with developer login as any of:');
  console.log(`  ${superAdmin.email}       (Super Administrator — sees both help desks)`);
  console.log('  it.admin@example.com      (HD Admin, IT Help Desk)');
  console.log('  it.agent1@example.com     (Agent, IT Help Desk)');
  console.log('  it.observer@example.com   (Observer, watched tickets only)');
  console.log('  ke.admin@example.com      (HD Admin, Kenya Help Desk)');
  console.log('  dual.role@example.com     (Agent in ITHD, HD Admin in KEN — try the switcher)');
}

main()
  .catch((error) => {
    console.error('Seed failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectDb();
  });
