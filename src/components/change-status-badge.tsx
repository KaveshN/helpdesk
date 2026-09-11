import type { ChangeStatus } from '@/generated/prisma/enums';

/**
 * Change statuses are a fixed lifecycle enum (unlike ticket statuses, which are
 * per-group rows), so their presentation lives in code rather than config.
 *
 * Only the states that carry consequence get colour — pending, rejected,
 * failed. Routine states stay neutral so the exceptional ones stand out.
 */
const STYLES: Record<ChangeStatus, { label: string; tone: string }> = {
  DRAFT: { label: 'Draft', tone: 'neutral' },
  PENDING_APPROVAL: { label: 'Pending approval', tone: 'warning' },
  APPROVED: { label: 'Approved', tone: 'success' },
  REJECTED: { label: 'Rejected', tone: 'danger' },
  SCHEDULED: { label: 'Scheduled', tone: 'accent' },
  IN_PROGRESS: { label: 'In progress', tone: 'accent' },
  COMPLETED: { label: 'Completed', tone: 'success' },
  FAILED: { label: 'Failed', tone: 'danger' },
  ROLLED_BACK: { label: 'Rolled back', tone: 'warning' },
  CANCELLED: { label: 'Cancelled', tone: 'neutral' },
};

const TONES: Record<string, React.CSSProperties> = {
  neutral: { background: 'var(--subtle)', color: 'var(--muted)', borderColor: 'var(--border)' },
  success: {
    background: 'var(--success-subtle)',
    color: 'var(--success)',
    borderColor: 'transparent',
  },
  warning: {
    background: 'var(--warning-subtle)',
    color: 'var(--warning)',
    borderColor: 'transparent',
  },
  danger: {
    background: 'var(--danger-subtle)',
    color: 'var(--danger)',
    borderColor: 'transparent',
  },
  accent: {
    background: 'var(--accent-subtle)',
    color: 'var(--accent)',
    borderColor: 'transparent',
  },
};

export function ChangeStatusBadge({ status }: { status: ChangeStatus }) {
  const style = STYLES[status];
  return (
    <span className="chip" style={TONES[style.tone]}>
      {style.label}
    </span>
  );
}

export function changeStatusLabel(status: ChangeStatus): string {
  return STYLES[status].label;
}
