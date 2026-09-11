import { z } from 'zod';
import { ApprovalDecision, ChangeStatus } from '@/generated/prisma/enums';

const uuid = z.uuid('Expected an id');
const optionalUuid = z
  .string()
  .trim()
  .transform((value) => (value === '' ? undefined : value))
  .optional()
  .pipe(uuid.optional());

/**
 * `datetime-local` inputs post "2026-09-14T08:00" with no zone, so the value is
 * interpreted in the server's zone. Built with a transform rather than
 * `.pipe(z.coerce.date())` because coerced dates accept `unknown` input, which
 * breaks the pipe's type contract.
 */
const optionalDateTime = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value ? new Date(value) : undefined))
  .refine(
    (value) => value === undefined || !Number.isNaN(value.getTime()),
    'Enter a valid date and time',
  );

export const createChangeSchema = z.object({
  title: z.string().trim().min(6, 'Title must be at least 6 characters').max(300),
  description: z.string().trim().min(1, 'Description is required').max(20_000),
  changeTypeId: uuid,
  riskLevelId: uuid,
  changeCategoryId: optionalUuid,
  ownerId: optionalUuid,
  impactAssessment: z.string().trim().max(20_000).optional(),
  implementationPlan: z.string().trim().max(20_000).optional(),
  rollbackPlan: z.string().trim().max(20_000).optional(),
  testPlan: z.string().trim().max(20_000).optional(),
  plannedStartAt: optionalDateTime,
  plannedEndAt: optionalDateTime,
  /** Optional cross-reference to the incident that prompted this change. */
  linkedTicketId: optionalUuid,
});
export type CreateChangeInput = z.infer<typeof createChangeSchema>;

export const updateChangeSchema = createChangeSchema.partial().extend({
  changeRequestId: uuid,
});
export type UpdateChangeInput = z.infer<typeof updateChangeSchema>;

export const submitChangeSchema = z.object({
  changeRequestId: uuid,
  /** Override the CAB the risk level would normally route to. */
  cabId: optionalUuid,
});

export const recordDecisionSchema = z.object({
  changeRequestId: uuid,
  decision: z.enum([
    ApprovalDecision.APPROVED,
    ApprovalDecision.REJECTED,
    ApprovalDecision.ABSTAINED,
  ]),
  comment: z.string().trim().max(4000).optional(),
});
export type RecordDecisionInput = z.infer<typeof recordDecisionSchema>;

/** Statuses an operator can drive directly (the rest are computed by voting). */
export const transitionChangeSchema = z.object({
  changeRequestId: uuid,
  to: z.enum([
    ChangeStatus.SCHEDULED,
    ChangeStatus.IN_PROGRESS,
    ChangeStatus.COMPLETED,
    ChangeStatus.FAILED,
    ChangeStatus.ROLLED_BACK,
    ChangeStatus.CANCELLED,
    ChangeStatus.DRAFT,
  ]),
  outcomeNotes: z.string().trim().max(20_000).optional(),
});
export type TransitionChangeInput = z.infer<typeof transitionChangeSchema>;

export const changeFilterSchema = z.object({
  q: z.string().trim().max(200).optional(),
  status: z.enum(ChangeStatus).optional(),
  riskLevelId: optionalUuid,
  changeTypeId: optionalUuid,
  view: z
    .enum(['all', 'open', 'awaiting_my_approval', 'mine', 'scheduled', 'completed'])
    .default('open'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(5).max(100).default(25),
});
export type ChangeFilter = z.infer<typeof changeFilterSchema>;

// --- CAB configuration ---------------------------------------------------

export const saveCabSchema = z.object({
  id: optionalUuid,
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(1000).optional(),
  approvalMode: z.enum(['ALL_MEMBERS', 'QUORUM', 'ANY_MEMBER', 'CHAIR_ONLY']),
  quorum: z.coerce.number().int().min(1).max(50).default(2),
  rejectionIsFinal: z.stringbool().default(true),
  workflowId: optionalUuid,
  isActive: z.stringbool().default(true),
  /** Risk levels routed to this CAB. */
  riskLevelIds: z.array(uuid).max(50).default([]),
});
export type SaveCabInput = z.infer<typeof saveCabSchema>;

export const saveCabMemberSchema = z.object({
  cabId: uuid,
  userId: uuid,
  isChair: z.stringbool().default(false),
  isVoting: z.stringbool().default(true),
});

export const removeCabMemberSchema = z.object({ cabId: uuid, userId: uuid });

// --- Change taxonomy -----------------------------------------------------

export const saveChangeTypeSchema = z.object({
  id: optionalUuid,
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(1000).optional(),
  isPreApproved: z.stringbool().default(false),
  sortOrder: z.coerce.number().int().min(0).max(100_000).default(0),
  isDefault: z.stringbool().default(false),
  isActive: z.stringbool().default(true),
});

export const saveChangeCategorySchema = z.object({
  id: optionalUuid,
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(1000).optional(),
  sortOrder: z.coerce.number().int().min(0).max(100_000).default(0),
  isActive: z.stringbool().default(true),
});

export const saveRiskLevelSchema = z.object({
  id: optionalUuid,
  name: z.string().trim().min(2).max(120),
  level: z.coerce.number().int().min(1, '1 is the highest risk').max(99),
  description: z.string().trim().max(1000).optional(),
  colour: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex colour like #dc2626')
    .optional(),
  requiresCab: z.stringbool().default(true),
  minimumNoticeHours: z.coerce.number().int().min(0).max(8760).default(0),
  isDefault: z.stringbool().default(false),
  isActive: z.stringbool().default(true),
});
