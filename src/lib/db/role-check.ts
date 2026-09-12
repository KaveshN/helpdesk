import { db } from '@/lib/db/client';
import { APP_ROLE, PLATFORM_ROLE } from '@/lib/db/scoped';
import { logger } from '@/lib/logger';

/**
 * Row-level security only protects anything if the application connects as
 * a role the policies apply to. This check runs at process start (Next's
 * instrumentation hook and the worker) and refuses to serve in production
 * when the runtime role would bypass RLS.
 */
export type RuntimeRoleReport = {
  user: string;
  superuser: boolean;
  rolesExist: boolean;
  platformMember: boolean;
  appMember: boolean;
};

export async function inspectRuntimeRole(): Promise<RuntimeRoleReport> {
  const rows = await db().$queryRaw<
    Array<{
      user: string;
      superuser: boolean;
      rolesExist: boolean;
      platformMember: boolean;
      appMember: boolean;
    }>
  >`
    SELECT
      current_user::text AS "user",
      (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS "superuser",
      EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${APP_ROLE})
        AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${PLATFORM_ROLE}) AS "rolesExist",
      CASE WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${PLATFORM_ROLE})
        THEN pg_has_role(current_user, ${PLATFORM_ROLE}::name, 'MEMBER') ELSE false END AS "platformMember",
      CASE WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${APP_ROLE})
        THEN pg_has_role(current_user, ${APP_ROLE}::name, 'MEMBER') ELSE false END AS "appMember"
  `;
  const row = rows[0];
  if (!row) throw new Error('role inspection returned no rows');
  return row;
}

/** Pure: what is wrong with connecting as this role, if anything. */
export function evaluateRuntimeRole(report: RuntimeRoleReport): string[] {
  const problems: string[] = [];
  if (!report.rolesExist) {
    problems.push(
      `roles ${PLATFORM_ROLE} / ${APP_ROLE} do not exist; run the migrations (npm run db:deploy)`,
    );
    return problems;
  }
  if (report.superuser) {
    problems.push(`runtime user "${report.user}" is a superuser and bypasses row-level security`);
  }
  if (!report.platformMember) {
    problems.push(`runtime user "${report.user}" is not a member of ${PLATFORM_ROLE}`);
  }
  if (!report.appMember) {
    problems.push(
      `runtime user "${report.user}" cannot SET ROLE ${APP_ROLE}; scoped transactions will fail`,
    );
  }
  return problems;
}

/**
 * Warn in development (the seeded docker cluster still ships a superuser
 * for migrations), refuse in production.
 */
export async function assertRuntimeRole(): Promise<void> {
  let report: RuntimeRoleReport;
  try {
    report = await inspectRuntimeRole();
  } catch (error) {
    logger.warn({ err: error }, 'could not inspect the database runtime role');
    return;
  }

  const problems = evaluateRuntimeRole(report);
  if (problems.length === 0) {
    logger.info({ user: report.user }, 'database runtime role verified for row-level security');
    return;
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error(`Refusing to start: ${problems.join('; ')}`);
  }
  logger.warn({ problems }, 'database runtime role would bypass row-level security');
}
