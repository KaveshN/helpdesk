import { GroupRole } from '@/generated/prisma/enums';

/**
 * PERMISSION MODEL (brief §5).
 *
 * Roles do not appear in route handlers or components -- capabilities do. A new
 * role, or a change to what an existing role may do, is a change to the tables
 * below and nowhere else. That is the whole point of this file: `if (role ===
 * 'HD_ADMIN')` scattered across 40 routes is how permission bugs happen.
 *
 * Capability names are `<domain>:<action>`. `platform:*` capabilities are only
 * ever held by a Super Administrator and are not group-scoped.
 */
export const CAPABILITIES = [
  // --- Platform-wide (Super Administrator only) ---
  'platform:manage_groups',
  'platform:manage_users',
  'platform:assign_roles',
  'platform:view_audit',
  'platform:manage_global_settings',
  'platform:manage_global_kb',
  /// The only cross-group view in the product: per-group panels, never merged.
  'platform:view_all_dashboards',

  // --- Group configuration (Help Desk Administrator/Manager) ---
  'group:view_settings',
  'group:manage_settings',
  'group:manage_members',
  'group:manage_taxonomy', // categories, subcategories, types, priorities, statuses
  'group:manage_sla',
  'group:manage_calendar',
  'group:manage_after_hours',
  'group:manage_workflows',
  'group:manage_notifications',
  'group:manage_cab',
  'group:manage_change_config', // change types, categories, risk levels
  'group:view_audit',

  // --- Tickets ---
  'ticket:read',
  'ticket:create',
  'ticket:update',
  'ticket:assign',
  'ticket:comment',
  'ticket:comment_internal',
  'ticket:attach',
  'ticket:manage_watchers',
  'ticket:resolve',
  'ticket:close',
  'ticket:reopen',
  'ticket:delete',

  // --- Change management ---
  'change:read',
  'change:create',
  'change:update',
  'change:approve',
  'change:schedule',
  'change:implement',
  'change:cancel',

  // --- Knowledge base ---
  'kb:read',
  'kb:create',
  'kb:update',
  'kb:publish',
  'kb:delete',

  // --- Reporting / dashboards ---
  'dashboard:view_own',
  'dashboard:view_group',
  'report:view',
  'report:manage',
] as const;

export type Capability = (typeof CAPABILITIES)[number];

const OBSERVER_CAPABILITIES: readonly Capability[] = [
  'ticket:read',
  'kb:read',
  'dashboard:view_own',
];

const AGENT_CAPABILITIES: readonly Capability[] = [
  ...OBSERVER_CAPABILITIES,
  'group:view_settings',
  'ticket:create',
  'ticket:update',
  'ticket:assign',
  'ticket:comment',
  'ticket:comment_internal',
  'ticket:attach',
  'ticket:manage_watchers',
  'ticket:resolve',
  'ticket:close',
  'ticket:reopen',
  'change:read',
  'change:create',
  'change:update',
  'change:schedule',
  'change:implement',
  'kb:create',
  'kb:update',
  'dashboard:view_group',
  'report:view',
];

const HD_ADMIN_CAPABILITIES: readonly Capability[] = [
  ...AGENT_CAPABILITIES,
  'group:manage_settings',
  'group:manage_members',
  'group:manage_taxonomy',
  'group:manage_sla',
  'group:manage_calendar',
  'group:manage_after_hours',
  'group:manage_workflows',
  'group:manage_notifications',
  'group:manage_cab',
  'group:manage_change_config', // change types, categories, risk levels
  'group:view_audit',
  'ticket:delete',
  'change:approve',
  'change:cancel',
  'kb:publish',
  'kb:delete',
  'report:manage',
];

/** Capabilities granted by a per-group membership role. */
export const ROLE_CAPABILITIES: Readonly<Record<GroupRole, ReadonlySet<Capability>>> = {
  [GroupRole.OBSERVER]: new Set(OBSERVER_CAPABILITIES),
  [GroupRole.AGENT]: new Set(AGENT_CAPABILITIES),
  [GroupRole.HD_ADMIN]: new Set(HD_ADMIN_CAPABILITIES),
};

/**
 * A Super Administrator holds every capability. Deliberately derived from
 * CAPABILITIES rather than hand-listed, so a new capability is never
 * accidentally withheld from the one role that must always be able to fix
 * things.
 */
export const SUPER_ADMIN_CAPABILITIES: ReadonlySet<Capability> = new Set(CAPABILITIES);

/** Capabilities that are meaningless without a group context. */
export function isPlatformCapability(capability: Capability): boolean {
  return capability.startsWith('platform:');
}
