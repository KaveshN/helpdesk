import { z } from 'zod';
import { StatusCategory, TicketTypeKind } from '@/generated/prisma/enums';

const name = z.string().trim().min(2, 'Name must be at least 2 characters').max(120);
const sortOrder = z.coerce.number().int().min(0).max(100_000).default(0);

export const categoryInputSchema = z.object({
  id: z.uuid().optional(),
  name,
  description: z.string().trim().max(500).optional(),
  sortOrder,
  isActive: z.stringbool().default(true),
});

export const subCategoryInputSchema = z.object({
  id: z.uuid().optional(),
  categoryId: z.uuid(),
  name,
  description: z.string().trim().max(500).optional(),
  sortOrder,
  isActive: z.stringbool().default(true),
});

export const statusInputSchema = z.object({
  id: z.uuid().optional(),
  name,
  /** Fixed semantics the dashboards and SLA engine branch on. */
  category: z.enum(StatusCategory),
  pausesSla: z.stringbool().default(false),
  colour: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex colour like #2563eb')
    .optional(),
  sortOrder,
  isDefault: z.stringbool().default(false),
  isActive: z.stringbool().default(true),
});

export const priorityInputSchema = z.object({
  id: z.uuid().optional(),
  name,
  level: z.coerce.number().int().min(1, '1 is the most urgent').max(99),
  colour: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex colour like #dc2626')
    .optional(),
  isDefault: z.stringbool().default(false),
  isActive: z.stringbool().default(true),
});

export const ticketTypeInputSchema = z.object({
  id: z.uuid().optional(),
  name,
  kind: z.enum(TicketTypeKind),
  description: z.string().trim().max(500).optional(),
  sortOrder,
  isDefault: z.stringbool().default(false),
  isActive: z.stringbool().default(true),
});

export type CategoryInput = z.infer<typeof categoryInputSchema>;
export type SubCategoryInput = z.infer<typeof subCategoryInputSchema>;
export type StatusInput = z.infer<typeof statusInputSchema>;
export type PriorityInput = z.infer<typeof priorityInputSchema>;
export type TicketTypeInput = z.infer<typeof ticketTypeInputSchema>;
