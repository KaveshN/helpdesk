/** Consistent page title block: title, supporting line, and right-aligned actions. */
export function PageHeader({
  title,
  description,
  actions,
  breadcrumb,
}: {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  breadcrumb?: React.ReactNode;
}) {
  return (
    <header className="mb-6 space-y-3">
      {breadcrumb ? <nav className="text-[0.8125rem] text-muted">{breadcrumb}</nav> : null}
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold tracking-tight sm:text-xl">{title}</h1>
          {description ? <p className="mt-1 text-muted">{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}
