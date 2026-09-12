import type { ReportCell, ReportResult } from '@/lib/reports/types';

function render(value: ReportCell, percent?: boolean): string {
  // null is "no data", and must never render as 0 or 0% -- that is the
  // difference between "nothing happened" and "everything failed".
  if (value === null || value === undefined) return '—';
  if (typeof value === 'number') {
    return percent ? `${value.toFixed(1)}%` : String(value);
  }
  return value;
}

export function ReportTable({ report }: { report: ReportResult }) {
  return (
    <div className="space-y-3">
      {report.notes?.length ? (
        <ul className="list-inside list-disc rounded-md border bg-muted px-4 py-3 text-xs text-muted-foreground">
          {report.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      ) : null}

      <div className="card overflow-x-auto">
        {report.rows.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">
            No data for this period.
          </p>
        ) : (
          <table className="data-table w-full min-w-[720px] text-sm">
            <thead>
              <tr>
                {report.columns.map((column) => (
                  <th
                    key={column.key}
                    className={`px-4 py-2 ${column.numeric ? 'text-right' : ''}`}
                  >
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {report.rows.map((row, index) => (
                <tr key={index} className="hover:bg-muted">
                  {report.columns.map((column) => (
                    <td
                      key={column.key}
                      className={`px-4 py-2 ${column.numeric ? 'text-right tabular-nums' : ''}`}
                    >
                      {render(row[column.key] ?? null, column.percent)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            {report.totals ? (
              <tfoot className="border-t-2 bg-muted font-medium">
                <tr>
                  {report.columns.map((column) => (
                    <td
                      key={column.key}
                      className={`px-4 py-2 ${column.numeric ? 'text-right tabular-nums' : ''}`}
                    >
                      {render(report.totals![column.key] ?? null, column.percent)}
                    </td>
                  ))}
                </tr>
              </tfoot>
            ) : null}
          </table>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Generated {report.generatedAt.toISOString().slice(0, 16).replace('T', ' ')} · period{' '}
        {report.periodFrom.toISOString().slice(0, 10)} to{' '}
        {report.periodTo.toISOString().slice(0, 10)}
      </p>
    </div>
  );
}
