import { z } from 'zod';

/**
 * Input validation at the boundary (zod). Every server action parses its raw
 * FormData/JSON through one of these before touching the database.
 */

const uuid = z.uuid('Expected an id');
const optionalUuid = z
  .string()
  .trim()
  .transform((value) => (value === '' ? undefined : value))
  .optional()
  .pipe(uuid.optional());

export const createTicketSchema = z.object({
  subject: z.string().trim().min(4, 'Subject must be at least 4 characters').max(300),
  description: z.string().trim().min(1, 'Description is required').max(20_000),
  typeId: uuid,
  priorityId: uuid,
  categoryId: optionalUuid,
  subCategoryId: optionalUuid,
  /** Omitted means "the person creating it". */
  requesterId: optionalUuid,
  assigneeId: optionalUuid,
  statusId: optionalUuid,
  watcherIds: z.array(uuid).max(50).default([]),
});
export type CreateTicketInput = z.infer<typeof createTicketSchema>;

export const updateTicketSchema = z.object({
  ticketId: uuid,
  subject: z.string().trim().min(4).max(300).optional(),
  description: z.string().trim().min(1).max(20_000).optional(),
  typeId: optionalUuid,
  priorityId: optionalUuid,
  statusId: optionalUuid,
  categoryId: optionalUuid,
  subCategoryId: optionalUuid,
  /** Explicit null unassigns; undefined leaves it alone. */
  assigneeId: z
    .union([uuid, z.literal(''), z.null()])
    .transform((value) => (value === '' ? null : value))
    .optional(),
});
export type UpdateTicketInput = z.infer<typeof updateTicketSchema>;

export const addCommentSchema = z.object({
  ticketId: uuid,
  body: z.string().trim().min(1, 'Comment cannot be empty').max(20_000),
  // NOT z.coerce.boolean(): that parses the string "false" as true, which is
  // exactly how an unchecked "internal note" box leaks a note to a requester.
  isInternal: z.stringbool().default(false),
});
export type AddCommentInput = z.infer<typeof addCommentSchema>;

export const ticketFilterSchema = z.object({
  /** Free text over reference + subject. */
  q: z.string().trim().max(200).optional(),
  statusId: optionalUuid,
  priorityId: optionalUuid,
  categoryId: optionalUuid,
  assigneeId: z.string().trim().max(64).optional(),
  /** Named views used by the dashboard tiles. */
  view: z
    .enum(['all', 'assigned_to_me', 'unassigned', 'open', 'overdue', 'watching'])
    .default('all'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(5).max(100).default(25),
});
export type TicketFilter = z.infer<typeof ticketFilterSchema>;

export const watcherSchema = z.object({
  ticketId: uuid,
  userId: uuid,
});
