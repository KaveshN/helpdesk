import { Inbox } from 'lucide-react';

export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      <Inbox className="size-7 text-faint" aria-hidden strokeWidth={1.5} />
      <p className="mt-3 font-medium">{title}</p>
      {hint ? <p className="mt-1 max-w-sm text-muted">{hint}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
