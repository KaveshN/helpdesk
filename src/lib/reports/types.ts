import { z } from 'zod';
import { ReportType } from '@/generated/prisma/enums';

/**
 * One uniform result shape for every report, so the on-screen table, the CSV
 * export and the (Phase 2) emailed attachment all consume the same thing. A
 * report that invents its own output shape is a report that renders differently
 * in each of those three places.
 */
export type ReportColumn = {
  key: string;
  label: string;
  /** Right-align and format as a number. */
  numeric?: boolean;
  /** Render as a percentage; null means "no data", never 0%. */
  percent?: boolean;
};

export type ReportCell = string | number | null;

export type ReportResult = {
  type: ReportType;
  title: string;
  description: string;
  generatedAt: Date;
  periodFrom: Date;
  periodTo: Date;
  columns: ReportColumn[];
  rows: Array<Record<string, ReportCell>>;
  /** Optional footer row. */
  totals?: Record<string, ReportCell>;
  /** Caveats shown above the table and included in the CSV header. */
  notes?: string[];
};

export const reportParamsSchema = z.object({
  type: z.enum(ReportType),
  /** Rolling window in days, used when explicit dates are absent. */
  days: z.coerce.number().int().min(1).max(730).default(30),
  from: z
    .string()
    .trim()
    .optional()
    .transform((value) => (value ? new Date(value) : undefined))
    .refine((value) => value === undefined || !Number.isNaN(value.getTime()), 'Invalid from date'),
  to: z
    .string()
    .trim()
    .optional()
    .transform((value) => (value ? new Date(value) : undefined))
    .refine((value) => value === undefined || !Number.isNaN(value.getTime()), 'Invalid to date'),
  /** Optional narrowing. */
  categoryId: z.string().trim().optional(),
  priorityId: z.string().trim().optional(),
  assigneeId: z.string().trim().optional(),
});
export type ReportParams = z.infer<typeof reportParamsSchema>;

/** Resolve the reporting window: explicit dates win, else a rolling window. */
export function resolvePeriod(params: ReportParams, now = new Date()): { from: Date; to: Date } {
  const to = params.to ?? now;
  const from = params.from ?? new Date(to.getTime() - params.days * 24 * 60 * 60 * 1000);
  return { from, to };
}

export const REPORT_CATALOGUE: Array<{
  type: ReportType;
  title: string;
  description: string;
  /** Which capability is needed beyond `report:view`. */
  requires?: 'change:read';
}> = [
  {
    type: ReportType.TICKET_VOLUME,
    title: 'Ticket volume',
    description: 'Tickets raised and resolved per day, with the running open backlog.',
  },
  {
    type: ReportType.SLA_PERFORMANCE,
    title: 'SLA performance',
    description:
      'First-response and resolution attainment by priority, measured in business hours against each ticket’s matched SLA policy.',
  },
  {
    type: ReportType.AGENT_PERFORMANCE,
    title: 'Agent performance',
    description:
      'Per-agent component metrics: resolved, attainment, reopen rate and mean handling time. Deliberately not combined into a single score.',
  },
  {
    type: ReportType.TICKET_AGEING,
    title: 'Ticket ageing',
    description: 'Open tickets bucketed by age, by priority, to surface a stagnating backlog.',
  },
  {
    type: ReportType.TREND_ANALYSIS,
    title: 'Trend analysis',
    description: 'Week-on-week volume, resolution rate and mean time to resolve.',
  },
  {
    type: ReportType.CHANGE_SUMMARY,
    title: 'Change summary',
    description:
      'Change requests by status, risk and type, with CAB approval turnaround and implementation success rate.',
    requires: 'change:read',
  },
  {
    type: ReportType.CSAT,
    title: 'Customer satisfaction',
    description: 'CSAT responses by period and agent. Requires the Phase 7 survey to be enabled.',
  },
];
