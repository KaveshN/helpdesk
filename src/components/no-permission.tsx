import Link from 'next/link';
import { Lock } from 'lucide-react';

/**
 * Rendered by a page when the actor lacks the capability it needs.
 *
 * Pages *present*; services and server actions *enforce*. A page that throws
 * ForbiddenError produces a raw 500, which reads as a broken app rather than a
 * permissions boundary.
 */
export function NoPermission({
  title = 'You do not have permission to view this',
  detail,
  backHref = '/dashboard',
  backLabel = 'Back to dashboard',
}: {
  title?: string;
  detail?: string;
  backHref?: string;
  backLabel?: string;
}) {
  return (
    <div className="card mx-auto max-w-lg p-6 text-center">
      <span className="mx-auto grid size-10 place-items-center rounded-full bg-muted">
        <Lock className="size-4 text-muted-foreground" aria-hidden />
      </span>
      <h1 className="mt-4 text-lg font-semibold">{title}</h1>
      <p className="mt-2 text-muted-foreground">
        {detail ??
          'Your role in this help desk does not include this action. Ask a help desk administrator if you need it.'}
      </p>
      <Link href={backHref} className="btn-secondary mt-5">
        {backLabel}
      </Link>
    </div>
  );
}
