'use client';

import { useEffect } from 'react';
import { TriangleAlert } from 'lucide-react';

/**
 * Route-level error boundary. Server error messages are already sanitised by
 * Next in production; nothing beyond the digest is shown to the user.
 */
export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // console.error is permitted by the lint rule; the pino logger is server-only.
    console.error(error);
  }, [error]);

  return (
    <main className="grid min-h-screen place-items-center p-6">
      <div className="card max-w-md p-8 text-center">
        <TriangleAlert
          className="mx-auto size-7"
          style={{ color: 'var(--warning)' }}
          aria-hidden
          strokeWidth={1.5}
        />
        <h1 className="mt-4 text-base font-semibold">Something went wrong</h1>
        <p className="mt-2 text-muted-foreground">
          The action could not be completed. If this keeps happening, quote reference{' '}
          <code className="font-mono text-xs">{error.digest ?? 'n/a'}</code> to your administrator.
        </p>
        <button type="button" onClick={reset} className="btn-primary mt-6">
          Try again
        </button>
      </div>
    </main>
  );
}
