import Link from 'next/link';
import { SearchX } from 'lucide-react';

export default function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center p-6">
      <div className="card max-w-md p-8 text-center">
        <SearchX className="mx-auto size-7 text-faint" aria-hidden strokeWidth={1.5} />
        <h1 className="mt-4 text-base font-semibold">Not found</h1>
        <p className="mt-2 text-muted">
          That page or record does not exist &mdash; or it belongs to a help desk you are not a
          member of.
        </p>
        <Link href="/dashboard" className="btn-primary mt-6">
          Back to dashboard
        </Link>
      </div>
    </main>
  );
}
