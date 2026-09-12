/**
 * Live verification of row-level security against the seeded database.
 *
 *   npm run verify:rls
 *
 * Not a vitest suite on purpose: tests must not need a database. This is the
 * script to run after a migration or a role change, the way Phase 1 was
 * verified. Every check uses the two seeded groups (ITHD and KEN), reads and
 * writes through the paths RLS is meant to cover, and rolls back anything it
 * would have written.
 */
import 'dotenv/config';
import { db, disconnectDb } from '../src/lib/db/client';
import { APP_ROLE, scopedDb, scopedTransaction } from '../src/lib/db/scoped';
import { inspectRuntimeRole, evaluateRuntimeRole } from '../src/lib/db/role-check';

type Check = { name: string; pass: boolean; detail: string };
const checks: Check[] = [];

function record(name: string, pass: boolean, detail: string) {
  checks.push({ name, pass, detail });
}

async function main() {
  const role = await inspectRuntimeRole();
  const problems = evaluateRuntimeRole(role);
  record('runtime role', problems.length === 0, problems.join('; ') || `connected as ${role.user}`);

  const [a, b] = await db().helpDeskGroup.findMany({
    where: { key: { in: ['ITHD', 'KEN'] } },
    orderBy: { key: 'asc' },
  });
  if (!a || !b)
    throw new Error('Seed the database first (npm run db:seed): ITHD and KEN not found');

  const totalA = await db().ticket.count({ where: { helpDeskGroupId: a.id } });
  const totalB = await db().ticket.count({ where: { helpDeskGroupId: b.id } });
  const totalAll = await db().ticket.count();
  record(
    'seed has tickets in both groups',
    totalA > 0 && totalB > 0,
    `${a.key}=${totalA} ${b.key}=${totalB}`,
  );

  // 1. Scoped Prisma read: rewrite + RLS agree.
  const viaScoped = await scopedDb(a.id).ticket.count();
  record('scoped count matches', viaScoped === totalA, `${viaScoped} vs ${totalA}`);

  // 2. Raw SQL through the scoped client, no WHERE at all: RLS alone filters.
  const [rawRow] = await scopedDb(a.id).$queryRaw<
    Array<{ n: number }>
  >`SELECT count(*)::int AS n FROM "Ticket"`;
  record('raw SQL is filtered by RLS', rawRow?.n === totalA, `${rawRow?.n} vs ${totalA}`);

  // 3. Raw SQL that explicitly asks for the other group: nothing.
  const [otherRow] = await scopedDb(a.id).$queryRaw<
    Array<{ n: number }>
  >`SELECT count(*)::int AS n FROM "Ticket" WHERE "helpDeskGroupId" = ${b.id}::uuid`;
  record('raw SQL cannot see the other group', otherRow?.n === 0, `${otherRow?.n} rows visible`);

  // 4. Inside a scoped transaction the plain transaction client is filtered.
  const { user, count } = await scopedTransaction(a.id, async (tx) => {
    const [row] = await tx.$queryRaw<Array<{ user: string }>>`SELECT current_user::text AS "user"`;
    return { user: row?.user, count: await tx.ticket.count() };
  });
  record('scoped transaction runs as the app role', user === APP_ROLE, `current_user=${user}`);
  record('unfiltered count inside scoped transaction', count === totalA, `${count} vs ${totalA}`);

  // 5. A batch update aimed at the other group touches nothing.
  const touched = await scopedTransaction(a.id, (tx) =>
    tx.ticket.updateMany({ where: { helpDeskGroupId: b.id }, data: { updatedAt: new Date() } }),
  );
  record('cross-group updateMany affects 0 rows', touched.count === 0, `${touched.count} rows`);

  // 6. A nested/explicit write naming the other group is rejected at the database.
  let outcome = 'row was accepted';
  try {
    await scopedTransaction(a.id, async (tx) => {
      await tx.category.create({
        data: { helpDeskGroupId: b.id, name: `rls-probe-${Date.now()}` },
      });
      throw new Error('ROLLBACK');
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Prisma error messages start with a blank line and an invocation dump;
    // keep the sentence that matters.
    outcome =
      message === 'ROLLBACK'
        ? 'row was accepted (rolled back)'
        : (message.match(/[^\n]*row-level security[^\n]*/i)?.[0] ??
          message.replace(/\s+/g, ' ').trim());
  }
  record(
    'cross-group insert rejected by policy',
    /row-level security/i.test(outcome),
    outcome.slice(0, 120),
  );

  // 7. Scoped interactive transaction on the scoped client itself.
  const nested = await scopedDb(a.id).$transaction(async (tx) => tx.ticket.count());
  record('scopedDb().$transaction enters the scope', nested === totalA, `${nested} vs ${totalA}`);

  // 8. Platform client still sees everything.
  record(
    'unscoped client bypasses (platform role)',
    totalAll >= totalA + totalB,
    `${totalAll} total`,
  );

  // 9. Shared calendars: a platform calendar is visible from a group scope, and
  //    the group cannot edit it.
  const platformCalendar = await db().calendar.create({
    data: { helpDeskGroupId: null, name: `rls-probe-${Date.now()}`, timeZone: 'UTC' },
  });
  try {
    const seen = await scopedDb(a.id).calendar.findFirst({ where: { id: platformCalendar.id } });
    record('platform calendar readable from a group', Boolean(seen), seen ? 'visible' : 'hidden');
    let edit = 'update succeeded';
    try {
      await scopedDb(a.id).calendar.update({
        where: { id: platformCalendar.id },
        data: { name: 'hijacked' },
      });
    } catch (error) {
      edit = error instanceof Error ? error.constructor.name : String(error);
    }
    record('platform calendar not editable from a group', edit !== 'update succeeded', edit);
  } finally {
    await db().calendar.delete({ where: { id: platformCalendar.id } });
  }

  const width = Math.max(...checks.map((check) => check.name.length));
  for (const check of checks) {
    process.stdout.write(
      `${check.pass ? 'PASS' : 'FAIL'}  ${check.name.padEnd(width)}  ${check.detail}\n`,
    );
  }
  const failed = checks.filter((check) => !check.pass).length;
  process.stdout.write(`\n${checks.length - failed}/${checks.length} checks passed\n`);
  process.exitCode = failed === 0 ? 0 : 1;
}

main()
  .catch((error) => {
    process.stderr.write(`verify-rls failed: ${error instanceof Error ? error.stack : error}\n`);
    process.exitCode = 1;
  })
  .finally(() => disconnectDb());
