import type { GroupRole, ObserverScope, PlatformRole } from '@/generated/prisma/enums';

/** One group the actor belongs to, with the role they hold there. */
export type ActorMembership = {
  helpDeskGroupId: string;
  groupKey: string;
  groupName: string;
  role: GroupRole;
  /** Group-level observer visibility default, copied from HelpDeskGroup. */
  observerScope: ObserverScope;
};

/**
 * Everything the permission layer needs to make a decision, resolved once per
 * request from the session plus a membership lookup. Pure data -- no DB handle,
 * no Prisma types -- so `src/lib/authz/guard.ts` stays unit-testable.
 */
export type Actor = {
  userId: string;
  email: string;
  name: string;
  platformRole: PlatformRole | null;
  isSuperAdmin: boolean;
  memberships: ActorMembership[];
};

/**
 * The group the actor is currently working in. A Super Administrator can hold a
 * group context without a membership row, which is why `role` is nullable.
 */
export type GroupContext = {
  helpDeskGroupId: string;
  groupKey: string;
  groupName: string;
  role: GroupRole | null;
  observerScope: ObserverScope;
};
