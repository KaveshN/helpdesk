import { AlertCircle } from 'lucide-react';
import type { ActionResult } from '@/server/actions/result';
import { TONE_CALLOUT } from '@/lib/design/tones';
import { cn } from '@/lib/utils';

export function FormMessage({ result }: { result?: ActionResult<unknown> }) {
  if (!result || result.ok) return null;
  return (
    <p
      role="alert"
      className={cn(
        'flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm',
        TONE_CALLOUT.destructive,
      )}
    >
      <AlertCircle className="mt-px size-4 shrink-0" aria-hidden />
      {result.error}
    </p>
  );
}

export function FieldError({ result, field }: { result?: ActionResult<unknown>; field: string }) {
  if (!result || result.ok) return null;
  const messages = result.fieldErrors?.[field];
  if (!messages?.length) return null;
  return <p className="field-error">{messages.join(' ')}</p>;
}
