import { CabApprovalMode } from '@/generated/prisma/enums';

/**
 * Starting change-management configuration for a new help desk group.
 *
 * Deliberately separate from `src/lib/groups/defaults.ts` (ticket taxonomy):
 * change management is its own module, and one group may run changes without
 * running a ticket queue, or vice versa. All of it is editable in the admin UI.
 */

export const DEFAULT_CHANGE_TYPES = [
  {
    name: 'Standard',
    description: 'Pre-approved, low-risk, repeatable. Skips the CAB entirely.',
    isPreApproved: true,
    sortOrder: 10,
    isDefault: false,
  },
  {
    name: 'Normal',
    description: 'The default route: assessed, then approved by the CAB if risk requires it.',
    isPreApproved: false,
    sortOrder: 20,
    isDefault: true,
  },
  {
    name: 'Emergency',
    description: 'Needed to restore service. Still recorded and still reviewed after the fact.',
    isPreApproved: false,
    sortOrder: 30,
    isDefault: false,
  },
  {
    name: 'Major',
    description: 'Significant scope or business impact; expect full CAB scrutiny.',
    isPreApproved: false,
    sortOrder: 40,
    isDefault: false,
  },
] as const;

export const DEFAULT_CHANGE_CATEGORIES = [
  { name: 'Infrastructure', sortOrder: 10 },
  { name: 'Network', sortOrder: 20 },
  { name: 'Application', sortOrder: 30 },
  { name: 'Database', sortOrder: 40 },
  { name: 'Security', sortOrder: 50 },
  { name: 'End-user computing', sortOrder: 60 },
] as const;

/**
 * Risk levels. `level` 1 is the highest risk. `requiresCab` is the field that
 * actually gates approval, and `minimumNoticeHours` is the lead time the group
 * expects between submission and the planned start.
 */
export const DEFAULT_CHANGE_RISK_LEVELS = [
  {
    name: 'Critical',
    level: 1,
    colour: '#dc2626',
    requiresCab: true,
    minimumNoticeHours: 120,
    description: 'Business-critical service, no straightforward rollback.',
    isDefault: false,
  },
  {
    name: 'High',
    level: 2,
    colour: '#ea580c',
    requiresCab: true,
    minimumNoticeHours: 72,
    description: 'Production impact likely; rollback tested but disruptive.',
    isDefault: false,
  },
  {
    name: 'Medium',
    level: 3,
    colour: '#ca8a04',
    requiresCab: false,
    minimumNoticeHours: 24,
    description: 'Limited scope, understood rollback.',
    isDefault: true,
  },
  {
    name: 'Low',
    level: 4,
    colour: '#65a30d',
    requiresCab: false,
    minimumNoticeHours: 0,
    description: 'Routine, reversible, no user-visible impact.',
    isDefault: false,
  },
] as const;

/** One CAB, wired to the risk levels that require it. */
export const DEFAULT_CAB = {
  name: 'Change Advisory Board',
  description: 'Reviews changes at High and Critical risk.',
  approvalMode: CabApprovalMode.QUORUM,
  quorum: 2,
  rejectionIsFinal: true,
  /** Matched by name against DEFAULT_CHANGE_RISK_LEVELS. */
  riskLevelNames: ['High', 'Critical'] as readonly string[],
} as const;
