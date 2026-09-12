import type { ApprovalDecision, ChangeStatus } from '@/generated/prisma/enums';

/**
 * The only place that maps a semantic tone to colour classes.
 *
 * Ticket status, priority and risk colours are ROWS (per-group config,
 * invariant 4), so they never appear here -- `Pill` renders those as a dot
 * from the database value. What lives here is the fixed vocabulary the code
 * itself branches on: change lifecycle states, approval decisions, SLA
 * states, and the five tones every tinted component understands.
 */
export type Tone = 'neutral' | 'primary' | 'success' | 'warning' | 'destructive';

/** Fully tinted chip. Use sparingly -- a wall of tinted chips is noise. */
export const TONE_CHIP: Record<Tone, string> = {
  neutral: 'border-border bg-muted text-muted-foreground',
  primary: 'border-transparent bg-primary-subtle text-primary',
  success: 'border-transparent bg-success-subtle text-success',
  warning: 'border-transparent bg-warning-subtle text-warning',
  destructive: 'border-transparent bg-destructive-subtle text-destructive',
};

/** Coloured text on a neutral surface: metric values, inline status words. */
export const TONE_TEXT: Record<Tone, string> = {
  neutral: 'text-foreground',
  primary: 'text-primary',
  success: 'text-success',
  warning: 'text-warning',
  destructive: 'text-destructive',
};

/** Banner / callout surfaces: warnings above forms, "n changes await you". */
export const TONE_CALLOUT: Record<Tone, string> = {
  neutral: 'border-border bg-muted text-muted-foreground',
  primary: 'border-primary/30 bg-primary-subtle text-primary',
  success: 'border-success/30 bg-success-subtle text-success',
  warning: 'border-warning/30 bg-warning-subtle text-warning',
  destructive: 'border-destructive/30 bg-destructive-subtle text-destructive',
};

/** The dot in a neutral `Pill` when the row carries no colour of its own. */
export const TONE_DOT: Record<Tone, string> = {
  neutral: 'bg-faint',
  primary: 'bg-primary',
  success: 'bg-success',
  warning: 'bg-warning',
  destructive: 'bg-destructive',
};

/**
 * Change lifecycle. Only the states that carry consequence get colour --
 * pending, rejected, failed. Routine states stay neutral so the exceptional
 * ones stand out.
 */
export const CHANGE_STATUS_TONE: Record<ChangeStatus, { label: string; tone: Tone }> = {
  DRAFT: { label: 'Draft', tone: 'neutral' },
  PENDING_APPROVAL: { label: 'Pending approval', tone: 'warning' },
  APPROVED: { label: 'Approved', tone: 'success' },
  REJECTED: { label: 'Rejected', tone: 'destructive' },
  SCHEDULED: { label: 'Scheduled', tone: 'primary' },
  IN_PROGRESS: { label: 'In progress', tone: 'primary' },
  COMPLETED: { label: 'Completed', tone: 'success' },
  FAILED: { label: 'Failed', tone: 'destructive' },
  ROLLED_BACK: { label: 'Rolled back', tone: 'warning' },
  CANCELLED: { label: 'Cancelled', tone: 'neutral' },
};

export const APPROVAL_DECISION_TONE: Record<ApprovalDecision, { label: string; tone: Tone }> = {
  PENDING: { label: 'Awaiting', tone: 'neutral' },
  APPROVED: { label: 'Approved', tone: 'success' },
  REJECTED: { label: 'Rejected', tone: 'destructive' },
  ABSTAINED: { label: 'Abstained', tone: 'neutral' },
};
