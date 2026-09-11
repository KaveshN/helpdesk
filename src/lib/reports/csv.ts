import type { ReportResult } from '@/lib/reports/types';

/**
 * CSV serialisation (RFC 4180): fields containing a comma, quote or newline are
 * quoted, and embedded quotes are doubled.
 *
 * The leading-character guard is deliberate. A value starting with =, +, - or @
 * is executed as a formula when the file is opened in Excel, which turns an
 * exported ticket subject into a code-execution vector on the recipient's
 * machine (CSV injection). Prefixing a tab neutralises it while keeping the
 * text readable.
 */
const FORMULA_TRIGGERS = ['=', '+', '-', '@', '\t', '\r'];

export function escapeCsvField(value: unknown): string {
  if (value === null || value === undefined) return '';

  let text = String(value);
  if (FORMULA_TRIGGERS.some((trigger) => text.startsWith(trigger))) {
    text = `\t${text}`;
  }
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function toCsv(report: ReportResult): string {
  const lines: string[] = [];

  // Provenance header: a CSV that outlives its context is worse than no CSV.
  lines.push(`# ${report.title}`);
  lines.push(`# ${report.description}`);
  lines.push(`# Period: ${report.periodFrom.toISOString()} to ${report.periodTo.toISOString()}`);
  lines.push(`# Generated: ${report.generatedAt.toISOString()}`);
  for (const note of report.notes ?? []) {
    lines.push(`# Note: ${note.replace(/[\r\n]+/g, ' ')}`);
  }
  lines.push('');

  lines.push(report.columns.map((column) => escapeCsvField(column.label)).join(','));

  for (const row of report.rows) {
    lines.push(report.columns.map((column) => escapeCsvField(row[column.key])).join(','));
  }

  if (report.totals) {
    lines.push(
      report.columns.map((column) => escapeCsvField(report.totals![column.key])).join(','),
    );
  }

  return `${lines.join('\r\n')}\r\n`;
}

/** `sla-performance-ithd-2026-09-10.csv` */
export function csvFilename(report: ReportResult, groupKey: string): string {
  const slug = report.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  const stamp = report.generatedAt.toISOString().slice(0, 10);
  return `${slug}-${groupKey.toLowerCase()}-${stamp}.csv`;
}
