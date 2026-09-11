import {
  ROLE_CAPABILITIES,
  SUPER_ADMIN_CAPABILITIES,
  isPlatformCapability,
  type Capability,
} from '@/lib/authz/capabilities';
import type { Actor, ActorMembership } from '@/lib/authz/actor';
import { ForbiddenError } from '@/lib/errors';

/**
 * Pure permission decisions. Every route handler, server action and server
 * component asks these functions -- none of them inspect roles directly.
 */

export function membershipFor(actor: Actor, helpDeskGroupId: string): ActorMembership | undefined {
  return actor.memberships.find((m) => m.helpDeskGroupId === helpDeskGroupId);
}

export function isMemberOf(actor: Actor, helpDeskGroupId: string): boolean {
  return actor.isSuperAdmin || membershipFor(actor, helpDeskGroupId) !== undefined;
}

/** The full capability set an actor holds inside one group. */
export function capabilitiesFor(actor: Actor, helpDeskGroupId?: string): ReadonlySet<Capability> {
  if (actor.isSuperAdmin) return SUPER_ADMIN_CAPABILITIES;
  if (!helpDeskGroupId) return new Set();

  const membership = membershipFor(actor, helpDeskGroupId);
  if (!membership) return new Set();
  return ROLE_CAPABILITIES[membership.role];
}

/**
 * Can `actor` perform `capability`?
 *
 * `platform:*` capabilities ignore `helpDeskGroupId` and are Super Admin only.
 * Every other capability REQUIRES a group id -- omitting it is treated as "no",
 * never as "yes everywhere", so a forgotten argument fails closed.
 */
export function can(actor: Actor, capability: Capability, helpDeskGroupId?: string): boolean {
  if (isPlatformCapability(capability)) return actor.isSuperAdmin;
  if (!helpDeskGroupId) return false;
  return capabilitiesFor(actor, helpDeskGroupId).has(capability);
}

/** Throwing variant, for use at the top of a mutating action. */
export function requireCapability(
  actor: Actor,
  capability: Capability,
  helpDeskGroupId?: string,
): void {
  if (!can(actor, capability, helpDeskGroupId)) {
    throw new ForbiddenError(`Missing capability: ${capability}`, {
      capability,
      helpDeskGroupId: helpDeskGroupId ?? null,
      userId: actor.userId,
    });
  }
}

export function requireAnyCapability(
  actor: Actor,
  capabilities: readonly Capability[],
  helpDeskGroupId?: string,
): void {
  if (!capabilities.some((capability) => can(actor, capability, helpDeskGroupId))) {
    throw new ForbiddenError(`Missing all of: ${capabilities.join(', ')}`, {
      capabilities,
      helpDeskGroupId: helpDeskGroupId ?? null,
      userId: actor.userId,
    });
  }
}

export function requireGroupMembership(actor: Actor, helpDeskGroupId: string): void {
  if (!isMemberOf(actor, helpDeskGroupId)) {
    throw new ForbiddenError('You are not a member of this help desk', {
      helpDeskGroupId,
      userId: actor.userId,
    });
  }
}

/**
 * Extra `where` narrowing for ticket queries, on top of the group scope.
 *
 * Observers are read-only by role; this decides *which* tickets they can read.
 * WATCHED_ONLY (the default) limits them to tickets they are a watcher on --
 * see ObserverScope in schema.prisma. Agents and admins see the whole group.
 */
export function ticketVisibilityFilter(
  actor: Actor,
  helpDeskGroupId: string,
): { watchers?: { some: { userId: string } } } {
  if (actor.isSuperAdmin) return {};

  const membership = membershipFor(actor, helpDeskGroupId);
  if (!membership) {
    // Caller should have run requireGroupMembership first; narrow to nothing
    // rather than returning an unfiltered query.
    return { watchers: { some: { userId: '__no_access__' } } };
  }

  if (membership.role === 'OBSERVER' && membership.observerScope === 'WATCHED_ONLY') {
    return { watchers: { some: { userId: actor.userId } } };
  }

  return {};
}

/** Internal notes are hidden from anyone who cannot author them. */
export function canSeeInternalNotes(actor: Actor, helpDeskGroupId: string): boolean {
  return can(actor, 'ticket:comment_internal', helpDeskGroupId);
}
