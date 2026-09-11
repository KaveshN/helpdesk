import { AlertCircle } from 'lucide-react';
import type { ActionResult } from '@/server/actions/result';

export function FormMessage({ result }: { result?: ActionResult<unknown> }) {
  if (!result || result.ok) return null;
  return (
    <p
      role="alert"
      className="flex items-start gap-2 rounded-lg border px-3 py-2.5 text-[0.8125rem]"
      style={{
        background: 'var(--danger-subtle)',
        color: 'var(--danger)',
        borderColor: 'color-mix(in oklch, var(--danger) 30%, transparent)',
      }}
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
