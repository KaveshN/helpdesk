'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { ActionResult } from '@/server/actions/result';

/**
 * A destructive action behind a confirm dialog. Errors are surfaced via alert
 * rather than inline state because these live inside table rows where there is
 * nowhere sensible to render a message block.
 */
export function ConfirmForm({
  action,
  values,
  label,
  confirmMessage,
}: {
  action: (formData: FormData) => Promise<ActionResult>;
  values: Record<string, string>;
  label: string;
  confirmMessage: string;
}) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <button
      type="button"
      className="text-xs text-danger underline disabled:opacity-50"
      disabled={pending}
      onClick={() => {
        if (!window.confirm(confirmMessage)) return;
        const formData = new FormData();
        for (const [key, value] of Object.entries(values)) formData.set(key, value);
        startTransition(async () => {
          const result = await action(formData);
          if (!result.ok) window.alert(result.error);
          router.refresh();
        });
      }}
    >
      {pending ? 'Working…' : label}
    </button>
  );
}
