import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export function Pagination({
  basePath,
  params,
  page,
  pageSize,
  total,
}: {
  basePath: string;
  params: Record<string, string | number | undefined>;
  page: number;
  pageSize: number;
  total: number;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (totalPages <= 1) return null;

  const href = (value: number) => {
    const search = new URLSearchParams();
    const merged: Record<string, string | number | undefined> = { ...params, page: value };
    for (const [key, item] of Object.entries(merged)) {
      if (item !== undefined && item !== '') search.set(key, String(item));
    }
    return `${basePath}?${search.toString()}`;
  };

  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return (
    <nav className="flex flex-wrap items-center justify-between gap-3" aria-label="Pagination">
      <span className="text-[0.8125rem] text-muted">
        <span className="tabular">
          {from}–{to}
        </span>{' '}
        of <span className="tabular">{total}</span>
      </span>
      <div className="flex gap-2">
        {page > 1 ? (
          <Link href={href(page - 1)} className="btn-secondary">
            <ChevronLeft className="size-4" aria-hidden />
            Previous
          </Link>
        ) : null}
        {page < totalPages ? (
          <Link href={href(page + 1)} className="btn-secondary">
            Next
            <ChevronRight className="size-4" aria-hidden />
          </Link>
        ) : null}
      </div>
    </nav>
  );
}
