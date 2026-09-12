import type { ChangeStatus } from '@/generated/prisma/enums';
import { TonePill } from '@/components/ui/pill';
import { CHANGE_STATUS_TONE } from '@/lib/design/tones';

/**
 * Change statuses are a fixed lifecycle enum (unlike ticket statuses, which are
 * per-group rows), so their presentation lives in code -- in
 * `src/lib/design/tones.ts`, alongside every other fixed tone mapping.
 */
export function ChangeStatusBadge({ status }: { status: ChangeStatus }) {
  const { label, tone } = CHANGE_STATUS_TONE[status];
  return <TonePill label={label} tone={tone} />;
}

export function changeStatusLabel(status: ChangeStatus): string {
  return CHANGE_STATUS_TONE[status].label;
}
