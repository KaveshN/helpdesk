import { z } from 'zod';
import { GroupRole, ObserverScope } from '@/generated/prisma/enums';

/** Ticket-reference prefix: short, uppercase, unambiguous over the phone. */
export const groupKeySchema = z
  .string()
  .trim()
  .toUpperCase()
  .min(2, 'Key must be at least 2 characters')
  .max(10, 'Key must be at most 10 characters')
  .regex(/^[A-Z0-9]+$/, 'Key may contain only letters and digits');

export const createGroupSchema = z.object({
  name: z.string().trim().min(3, 'Name must be at least 3 characters').max(120),
  key: groupKeySchema,
  description: z.string().trim().max(1000).optional(),
  timeZone: z.string().trim().min(1).default('Africa/Johannesburg'),
  inboundEmailAddress: z
    .string()
    .trim()
    .toLowerCase()
    .transform((value) => (value === '' ? undefined : value))
    .optional()
    .pipe(z.email('Enter a valid email address').optional()),
  outboundEmailAddress: z
    .string()
    .trim()
    .toLowerCase()
    .transform((value) => (value === '' ? undefined : value))
    .optional()
    .pipe(z.email('Enter a valid email address').optional()),
  observerScope: z.enum(ObserverScope).default(ObserverScope.WATCHED_ONLY),
  /** Seed the group with starter categories and a default SLA policy. */
  includeStarterConfig: z.stringbool().default(true),
});
export type CreateGroupInput = z.infer<typeof createGroupSchema>;

export const updateGroupSchema = z.object({
  helpDeskGroupId: z.uuid(),
  name: z.string().trim().min(3).max(120).optional(),
  description: z.string().trim().max(1000).optional(),
  timeZone: z.string().trim().min(1).optional(),
  inboundEmailAddress: z
    .string()
    .trim()
    .toLowerCase()
    .transform((value) => (value === '' ? null : value))
    .nullable()
    .optional(),
  outboundEmailAddress: z
    .string()
    .trim()
    .toLowerCase()
    .transform((value) => (value === '' ? null : value))
    .nullable()
    .optional(),
  observerScope: z.enum(ObserverScope).optional(),
  isActive: z.stringbool().optional(),
});
export type UpdateGroupInput = z.infer<typeof updateGroupSchema>;

export const upsertMembershipSchema = z.object({
  helpDeskGroupId: z.uuid(),
  /** Either an existing user id, or an email address to invite by. */
  userId: z.uuid().optional(),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .transform((value) => (value === '' ? undefined : value))
    .optional()
    .pipe(z.email('Enter a valid email address').optional()),
  name: z.string().trim().max(200).optional(),
  role: z.enum(GroupRole),
});
export type UpsertMembershipInput = z.infer<typeof upsertMembershipSchema>;

export const removeMembershipSchema = z.object({
  helpDeskGroupId: z.uuid(),
  userId: z.uuid(),
});
