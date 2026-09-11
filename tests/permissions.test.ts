import { describe, expect, it } from 'vitest';
import type { Actor, ActorMembership } from '@/lib/authz/actor';
import {
  can,
  canSeeInternalNotes,
  capabilitiesFor,
  isMemberOf,
  requireCapability,
  requireGroupMembership,
  ticketVisibilityFilter,
} from '@/lib/authz/guard';
import {
  CAPABILITIES,
  ROLE_CAPABILITIES,
  SUPER_ADMIN_CAPABILITIES,
} from '@/lib/authz/capabilities';
import { ForbiddenError } from '@/lib/errors';

const IT = '00000000-0000-7000-8000-0000000000aa';
const KENYA = '00000000-0000-7000-8000-0000000000bb';

function membership(
  overrides: Partial<ActorMembership> & Pick<ActorMembership, 'role'>,
): ActorMembership {
  return {
    helpDeskGroupId: IT,
    groupKey: 'ITHD',
    groupName: 'IT Help Desk',
    observerScope: 'WATCHED_ONLY',
    ...overrides,
  };
}

function actor(overrides: Partial<Actor> = {}): Actor {
  return {
    userId: 'user-1',
    email: 'agent@example.com',
    name: 'Agent',
    platformRole: null,
    isSuperAdmin: false,
    memberships: [],
    ...overrides,
  };
}

describe('capability matrix', () => {
  it('gives a Super Administrator every capability', () => {
    expect(SUPER_ADMIN_CAPABILITIES.size).toBe(CAPABILITIES.length);
  });

  it('escalates strictly: observer ⊂ agent ⊂ hd_admin', () => {
    const observer = ROLE_CAPABILITIES.OBSERVER;
    const agent = ROLE_CAPABILITIES.AGENT;
    const admin = ROLE_CAPABILITIES.HD_ADMIN;

    for (const capability of observer) expect(agent.has(capability)).toBe(true);
    for (const capability of agent) expect(admin.has(capability)).toBe(true);
    expect(admin.size).toBeGreaterThan(agent.size);
    expect(agent.size).toBeGreaterThan(observer.size);
  });

  it('never grants a platform capability to a group role', () => {
    for (const role of ['OBSERVER', 'AGENT', 'HD_ADMIN'] as const) {
      for (const capability of ROLE_CAPABILITIES[role]) {
        expect(capability.startsWith('platform:')).toBe(false);
      }
    }
  });

  it('grants every non-platform capability to at least one group role', () => {
    // Catches an orphaned capability: one that route handlers check for but no
    // role can ever hold, which reads in the UI as a silently missing feature.
    const granted = new Set<string>();
    for (const role of ['OBSERVER', 'AGENT', 'HD_ADMIN'] as const) {
      for (const capability of ROLE_CAPABILITIES[role]) granted.add(capability);
    }

    const orphaned = CAPABILITIES.filter(
      (capability) => !capability.startsWith('platform:') && !granted.has(capability),
    );
    expect(orphaned).toEqual([]);
  });

  it('grants every platform capability to the Super Administrator only', () => {
    const platformCapabilities = CAPABILITIES.filter((capability) =>
      capability.startsWith('platform:'),
    );
    expect(platformCapabilities.length).toBeGreaterThan(0);
    for (const capability of platformCapabilities) {
      expect(SUPER_ADMIN_CAPABILITIES.has(capability)).toBe(true);
    }
  });

  it('keeps observers read-only', () => {
    const observer = ROLE_CAPABILITIES.OBSERVER;
    for (const capability of observer) {
      expect(['ticket:read', 'kb:read', 'dashboard:view_own']).toContain(capability);
    }
  });
});

describe('can', () => {
  const agent = actor({ memberships: [membership({ role: 'AGENT' })] });
  const admin = actor({ memberships: [membership({ role: 'HD_ADMIN' })] });
  const observer = actor({ memberships: [membership({ role: 'OBSERVER' })] });
  const superAdmin = actor({ isSuperAdmin: true, platformRole: 'SUPER_ADMIN' });

  it('permits an agent to work tickets in their group', () => {
    expect(can(agent, 'ticket:update', IT)).toBe(true);
    expect(can(agent, 'ticket:comment_internal', IT)).toBe(true);
  });

  it('refuses an agent group administration', () => {
    expect(can(agent, 'group:manage_members', IT)).toBe(false);
    expect(can(agent, 'group:manage_sla', IT)).toBe(false);
    expect(can(agent, 'ticket:delete', IT)).toBe(false);
  });

  it('permits an HD admin to configure their own group only', () => {
    expect(can(admin, 'group:manage_sla', IT)).toBe(true);
    expect(can(admin, 'group:manage_sla', KENYA)).toBe(false);
  });

  it('refuses an HD admin platform administration', () => {
    expect(can(admin, 'platform:manage_groups')).toBe(false);
    expect(can(admin, 'platform:assign_roles', IT)).toBe(false);
  });

  it('keeps observers read-only in practice', () => {
    expect(can(observer, 'ticket:read', IT)).toBe(true);
    expect(can(observer, 'ticket:comment', IT)).toBe(false);
    expect(can(observer, 'ticket:update', IT)).toBe(false);
    expect(can(observer, 'ticket:comment_internal', IT)).toBe(false);
  });

  it('gives a Super Administrator access without a membership row', () => {
    expect(can(superAdmin, 'ticket:update', KENYA)).toBe(true);
    expect(can(superAdmin, 'platform:manage_groups')).toBe(true);
    expect(isMemberOf(superAdmin, KENYA)).toBe(true);
  });

  it('fails closed when the group id is omitted for a group capability', () => {
    // A forgotten argument must never read as "allowed everywhere".
    expect(can(agent, 'ticket:update')).toBe(false);
    expect(can(admin, 'group:manage_members')).toBe(false);
  });

  it('ignores the group id for platform capabilities', () => {
    expect(can(superAdmin, 'platform:manage_users', KENYA)).toBe(true);
    expect(can(agent, 'platform:manage_users', IT)).toBe(false);
  });

  it('returns nothing for a group the actor does not belong to', () => {
    expect(capabilitiesFor(agent, KENYA).size).toBe(0);
  });

  it('treats an inactive-membership actor as having no capabilities', () => {
    // getActor filters inactive memberships out, so an actor with none is the
    // shape a revoked user arrives in.
    expect(capabilitiesFor(actor(), IT).size).toBe(0);
  });
});

describe('requireCapability', () => {
  const agent = actor({ memberships: [membership({ role: 'AGENT' })] });

  it('passes silently when permitted', () => {
    expect(() => requireCapability(agent, 'ticket:read', IT)).not.toThrow();
  });

  it('throws ForbiddenError naming the capability', () => {
    expect(() => requireCapability(agent, 'group:manage_sla', IT)).toThrow(ForbiddenError);
    expect(() => requireCapability(agent, 'group:manage_sla', IT)).toThrow(/group:manage_sla/);
  });

  it('rejects membership of another group', () => {
    expect(() => requireGroupMembership(agent, KENYA)).toThrow(ForbiddenError);
  });
});

describe('ticketVisibilityFilter', () => {
  it('does not narrow for agents', () => {
    const agent = actor({ memberships: [membership({ role: 'AGENT' })] });
    expect(ticketVisibilityFilter(agent, IT)).toEqual({});
  });

  it('limits a WATCHED_ONLY observer to tickets they watch', () => {
    const observer = actor({
      userId: 'observer-1',
      memberships: [membership({ role: 'OBSERVER', observerScope: 'WATCHED_ONLY' })],
    });
    expect(ticketVisibilityFilter(observer, IT)).toEqual({
      watchers: { some: { userId: 'observer-1' } },
    });
  });

  it('lets an ALL_TICKETS observer see the whole group', () => {
    const observer = actor({
      memberships: [membership({ role: 'OBSERVER', observerScope: 'ALL_TICKETS' })],
    });
    expect(ticketVisibilityFilter(observer, IT)).toEqual({});
  });

  it('narrows to nothing when there is no membership at all', () => {
    // Defence in depth: callers should have checked membership first, but the
    // filter must not degrade into "show everything".
    const filter = ticketVisibilityFilter(actor(), IT);
    expect(filter).toEqual({ watchers: { some: { userId: '__no_access__' } } });
  });

  it('does not narrow for a Super Administrator', () => {
    expect(ticketVisibilityFilter(actor({ isSuperAdmin: true }), KENYA)).toEqual({});
  });
});

describe('canSeeInternalNotes', () => {
  it('hides internal notes from observers, shows them to agents', () => {
    const observer = actor({ memberships: [membership({ role: 'OBSERVER' })] });
    const agent = actor({ memberships: [membership({ role: 'AGENT' })] });

    expect(canSeeInternalNotes(observer, IT)).toBe(false);
    expect(canSeeInternalNotes(agent, IT)).toBe(true);
  });
});
