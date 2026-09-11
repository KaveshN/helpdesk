import { NextResponse } from 'next/server';
import { requireSessionContext } from '@/lib/auth/session';
import { can } from '@/lib/authz/guard';
import { reportParamsSchema } from '@/lib/reports/types';
import { runReport } from '@/lib/reports/runners';
import { csvFilename, toCsv } from '@/lib/reports/csv';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';

/**
 * CSV download. A route handler rather than a server action because a browser
 * download needs real response headers.
 *
 * Reports run through the group-scoped client, so an export cannot reach
 * another tenant's rows even with a hand-crafted query string.
 */
export async function GET(request: Request) {
  try {
    const { actor, group } = await requireSessionContext();

    if (!can(actor, 'report:view', group.helpDeskGroupId)) {
      return NextResponse.json({ error: 'You cannot export reports' }, { status: 403 });
    }

    const url = new URL(request.url);
    const parsed = reportParamsSchema.safeParse(Object.fromEntries(url.searchParams));
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid report parameters', issues: parsed.error.issues },
        { status: 422 },
      );
    }

    if (
      parsed.data.type === 'CHANGE_SUMMARY' &&
      !can(actor, 'change:read', group.helpDeskGroupId)
    ) {
      return NextResponse.json({ error: 'You cannot export change data' }, { status: 403 });
    }

    const report = await runReport(group, parsed.data);
    const csv = toCsv(report);

    logger.info(
      { actorUserId: actor.userId, helpDeskGroupId: group.helpDeskGroupId, type: parsed.data.type },
      'report exported',
    );

    return new NextResponse(csv, {
      headers: {
        // text/csv with an explicit charset: Excel mis-reads UTF-8 otherwise.
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${csvFilename(report, group.groupKey)}"`,
        // An export is a point-in-time extract; never let a proxy serve a stale one.
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    if (error instanceof AppError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    logger.error({ err: error }, 'report export failed');
    return NextResponse.json({ error: 'Report export failed' }, { status: 500 });
  }
}
