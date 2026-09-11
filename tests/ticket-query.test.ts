import { describe, expect, it } from 'vitest';
import type { Actor, ActorMembership, GroupContext } from '@/lib/authz/actor';
import { buildTicketWhere } from '@/lib/tickets/service';
import { ticketFilterSchema } from '@/lib/tickets/schemas';

const GROUP_ID = '00000000-0000-7000-8000-0000000000aa';

const group: GroupContext = {
  helpDeskGroupId: GROUP_ID,
  groupKey: 'ITHD',
  groupName: 'IT Help Desk',
  role: 'AGENT',
  observerScope: 'WATCHED_ONLY',
};

function actorWith(
  role: ActorMembership['role'],
  observerScope: ActorMembership['observerScope'],
): Actor {
  return {
    userId: 'user-1',
    email: 'a@b.c',
    name: 'A',
    platformRole: null,
    isSuperAdmin: false,
    memberships: [
      {
        helpDeskGroupId: GROUP_ID,
        groupKey: 'ITHD',
        groupName: 'IT Help Desk',
        role,
        observerScope,
      },
    ],
  };
}

const agent = actorWith('AGENT', 'WATCHED_ONLY');
const now = new Date('2026-09-10T10:00:00.000Z');

/** Flatten the AND tree so assertions do not depend on clause ordering. */
function clauses(where: Record<string, unknown>): unknown[] {
  const list = Array.isArray(where.AND) ? where.AND : [];
  return list.filter((clause) => clause && Object.keys(clause as object).length > 0);
}

describe('buildTicketWhere', () => {
  it('always includes the visibility filter', () => {
    const observer = actorWith('OBSERVER', 'WATCHED_ONLY');
    const where = buildTicketWhere(observer, group, ticketFilterSchema.parse({}), now);

    expect(clauses(where)).toContainEqual({ watchers: { some: { userId: 'user-1' } } });
  });

  it('adds no narrowing clauses for an agent on the default view', () => {
    const where = buildTicketWhere(agent, group, ticketFilterSchema.parse({}), now);
    expect(clauses(where)).toEqual([]);
  });

  it('filters the assigned-to-me view by the actor', () => {
    const where = buildTicketWhere(
      agent,
      group,
      ticketFilterSchema.parse({ view: 'assigned_to_me' }),
      now,
    );

    expect(clauses(where)).toContainEqual({
      assigneeId: 'user-1',
      status: { category: { in: ['NEW', 'OPEN', 'PENDING', 'ON_HOLD'] } },
    });
  });

  it('treats overdue as unresolved and past due', () => {
    const where = buildTicketWhere(
      agent,
      group,
      ticketFilterSchema.parse({ view: 'overdue' }),
      now,
    );

    expect(clauses(where)).toContainEqual({
      resolvedAt: null,
      resolutionDueAt: { lt: now },
      status: { category: { in: ['NEW', 'OPEN', 'PENDING', 'ON_HOLD'] } },
    });
  });

  it('searches reference and subject case-insensitively', () => {
    const where = buildTicketWhere(agent, group, ticketFilterSchema.parse({ q: 'vpn' }), now);

    expect(clauses(where)).toContainEqual({
      OR: [
        { reference: { contains: 'vpn', mode: 'insensitive' } },
        { subject: { contains: 'vpn', mode: 'insensitive' } },
      ],
    });
  });

  it('understands the "me" and "none" assignee shorthands', () => {
    expect(
      clauses(buildTicketWhere(agent, group, ticketFilterSchema.parse({ assigneeId: 'me' }), now)),
    ).toContainEqual({ assigneeId: 'user-1' });

    expect(
      clauses(
        buildTicketWhere(agent, group, ticketFilterSchema.parse({ assigneeId: 'none' }), now),
      ),
    ).toContainEqual({ assigneeId: null });
  });

  it('never puts helpDeskGroupId in the where clause itself', () => {
    // Tenancy is the scoped client's job, not this function's. If it started
    // appearing here it would mean the filter had moved somewhere bypassable.
    const where = buildTicketWhere(agent, group, ticketFilterSchema.parse({ view: 'open' }), now);
    expect(JSON.stringify(where)).not.toContain('helpDeskGroupId');
  });
});

describe('ticketFilterSchema', () => {
  it('defaults to the all view with a sane page size', () => {
    expect(ticketFilterSchema.parse({})).toMatchObject({ view: 'all', page: 1, pageSize: 25 });
  });

  it('coerces page numbers from query strings', () => {
    expect(ticketFilterSchema.parse({ page: '3', pageSize: '50' })).toMatchObject({
      page: 3,
      pageSize: 50,
    });
  });

  it('caps the page size so a crafted URL cannot dump the table', () => {
    expect(ticketFilterSchema.safeParse({ pageSize: '100000' }).success).toBe(false);
  });

  it('rejects an unknown view', () => {
    expect(ticketFilterSchema.safeParse({ view: 'everything' }).success).toBe(false);
  });
});
