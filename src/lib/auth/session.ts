import { cache } from 'react';
import { cookies } from 'next/headers';
import { auth } from '@/lib/auth/config';
import { db } from '@/lib/db/client';
import { currentAuthEpoch } from '@/lib/redis';
import { logger } from '@/lib/logger';
import { UnauthenticatedError, ForbiddenError, NotFoundError } from '@/lib/errors';
import type { Actor, ActorMembership, GroupContext } from '@/lib/authz/actor';
import { membershipFor } from '@/lib/authz/guard';

/** Cookie holding the group the user is currently working in. */
export const ACTIVE_GROUP_COOKIE = 'hd_active_group';

/**
 * Resolve the request's actor: session identity plus current memberships.
 *
 * Wrapped in React's `cache()` so several server components in one render share
 * a single database round trip (per-request memoisation -- the cache is scoped
 * to the request, not shared between users).
 *
 * Roles are read from the database here rather than from the JWT. That costs one
 * indexed query per request and buys immediate effect for role changes.
 */
export const getActor = cache(async (): Promise<Actor | null> => {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return null;

  const user = await db().user.findUnique({
    where: { id: userId },
    include: {
      memberships: {
        where: { isActive: true, group: { isActive: true } },
        include: { group: { select: { id: true, key: true, name: true, observerScope: true } } },
        orderBy: { group: { name: 'asc' } },
      },
    },
  });

  if (!user || !user.isActive) {
    logger.warn({ userId }, 'session for missing or deactivated user');
    return null;
  }

  // Session revocation: a token minted before the user's current auth epoch is
  // no longer valid, even though its signature and expiry still check out.
  const epoch = await currentAuthEpoch(user.id);
  if ((session?.epoch ?? 0) !== epoch) {
    logger.info({ userId, tokenEpoch: session?.epoch ?? 0, epoch }, 'rejected revoked session');
    return null;
  }

  const memberships: ActorMembership[] = user.memberships.map((membership) => ({
    helpDeskGroupId: membership.helpDeskGroupId,
    groupKey: membership.group.key,
    groupName: membership.group.name,
    role: membership.role,
    observerScope: membership.group.observerScope,
  }));

  return {
    userId: user.id,
    email: user.email,
    name: user.name,
    platformRole: user.platformRole,
    isSuperAdmin: user.platformRole === 'SUPER_ADMIN',
    memberships,
  };
});

export async function requireActor(): Promise<Actor> {
  const actor = await getActor();
  if (!actor) throw new UnauthenticatedError();
  return actor;
}

export type GroupSummary = {
  id: string;
  key: string;
  name: string;
  /** NULL for a Super Admin viewing a group they hold no membership in. */
  role: ActorMembership['role'] | null;
};

/**
 * Groups the actor may switch into. A Super Administrator can enter any active
 * group without a membership row; everyone else sees exactly their memberships.
 */
export const getAccessibleGroups = cache(async (): Promise<GroupSummary[]> => {
  const actor = await getActor();
  if (!actor) return [];

  if (actor.isSuperAdmin) {
    const groups = await db().helpDeskGroup.findMany({
      where: { isActive: true },
      select: { id: true, key: true, name: true },
      orderBy: { name: 'asc' },
    });
    return groups.map((group) => ({
      ...group,
      role: membershipFor(actor, group.id)?.role ?? null,
    }));
  }

  return actor.memberships.map((membership) => ({
    id: membership.helpDeskGroupId,
    key: membership.groupKey,
    name: membership.groupName,
    role: membership.role,
  }));
});

/**
 * Which group is this request operating in?
 *
 * Order of precedence: explicit argument (e.g. a group id in the URL), then the
 * active-group cookie, then the actor's first accessible group. The cookie is
 * never trusted on its own -- access is re-checked against memberships every
 * time, so a tampered cookie yields a 403, not another tenant's data.
 */
export async function resolveGroupContext(requestedGroupId?: string): Promise<GroupContext | null> {
  const actor = await getActor();
  if (!actor) return null;

  const accessible = await getAccessibleGroups();
  if (accessible.length === 0) return null;

  const cookieStore = await cookies();
  const candidateId = requestedGroupId ?? cookieStore.get(ACTIVE_GROUP_COOKIE)?.value;

  const chosen =
    (candidateId ? accessible.find((group) => group.id === candidateId) : undefined) ??
    accessible[0]!;

  if (candidateId && chosen.id !== candidateId) {
    logger.warn(
      { userId: actor.userId, requestedGroupId: candidateId },
      'requested help desk group is not accessible; falling back',
    );
    // An explicit argument that is not accessible is an error, not a fallback:
    // silently showing a different group's data is exactly the failure mode the
    // tenancy design exists to prevent.
    if (requestedGroupId) {
      throw new ForbiddenError('You do not have access to this help desk', {
        helpDeskGroupId: requestedGroupId,
      });
    }
  }

  const membership = membershipFor(actor, chosen.id);

  return {
    helpDeskGroupId: chosen.id,
    groupKey: chosen.key,
    groupName: chosen.name,
    role: membership?.role ?? null,
    observerScope: membership?.observerScope ?? 'WATCHED_ONLY',
  };
}

export async function requireGroupContext(requestedGroupId?: string): Promise<GroupContext> {
  const context = await resolveGroupContext(requestedGroupId);
  if (!context) {
    throw new NotFoundError(
      'You are not a member of any help desk group yet. Ask a Super Administrator to add you.',
    );
  }
  return context;
}

/** Actor + active group together, the shape most pages and actions need. */
export async function requireSessionContext(requestedGroupId?: string): Promise<{
  actor: Actor;
  group: GroupContext;
}> {
  const actor = await requireActor();
  const group = await requireGroupContext(requestedGroupId);
  return { actor, group };
}
