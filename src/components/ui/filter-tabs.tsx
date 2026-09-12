import Link from 'next/link';
import { cn } from '@/lib/utils';

/** Segmented view switcher. Scrolls horizontally rather than wrapping on mobile. */
export function FilterTabs({
  basePath,
  params,
  paramName,
  current,
  options,
}: {
  basePath: string;
  params: Record<string, string | number | undefined>;
  paramName: string;
  current: string;
  options: Array<{ value: string; label: string }>;
}) {
  const href = (value: string) => {
    const search = new URLSearchParams();
    for (const [key, item] of Object.entries({ ...params, [paramName]: value })) {
      if (item !== undefined && item !== '') search.set(key, String(item));
    }
    const query = search.toString();
    return query ? `${basePath}?${query}` : basePath;
  };

  return (
    <nav className="scrollbar-thin -mx-1 flex gap-1 overflow-x-auto px-1 pb-1" aria-label="Views">
      {options.map((option) => {
        const active = current === option.value;
        return (
          <Link
            key={option.value}
            href={href(option.value)}
            aria-current={active ? 'true' : undefined}
            className={cn(
              'rounded-lg border px-3 py-1.5 text-sm font-medium whitespace-nowrap transition',
              active
                ? 'border-border bg-card text-foreground shadow-[var(--shadow-card)]'
                : 'border-transparent text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            {option.label}
          </Link>
        );
      })}
    </nav>
  );
}
