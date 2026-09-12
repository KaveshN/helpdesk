import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  APP_ROLE,
  GLOBAL_OR_GROUP_MODELS,
  GROUP_SCOPED_MODELS,
  GROUP_SETTING,
  PLATFORM_ROLE,
  UNSCOPED_MODELS,
} from '@/lib/db/scoped';

/**
 * The RLS migration must cover exactly the tables scoped.ts says are scoped.
 * A model added to schema.prisma and classified in scoped.ts but never given a
 * policy would be protected by Prisma only -- this test makes that a failure.
 */
const migrationSql = readdirSync('prisma/migrations')
  .filter((dir) => dir.endsWith('_rls') || dir.includes('rls'))
  .map((dir) => readFileSync(`prisma/migrations/${dir}/migration.sql`, 'utf8'))
  .join('\n');

function policiesFor(table: string): { enabled: boolean; platform: boolean; group: boolean } {
  return {
    enabled: migrationSql.includes(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY;`),
    platform: migrationSql.includes(`CREATE POLICY "${table}_platform" ON "${table}"`),
    group: migrationSql.includes(`CREATE POLICY "${table}_group" ON "${table}"`),
  };
}

describe('row-level security migration', () => {
  it('exists and names the roles and setting the code uses', () => {
    expect(migrationSql.length).toBeGreaterThan(0);
    expect(migrationSql).toContain(`CREATE ROLE ${APP_ROLE} NOLOGIN`);
    expect(migrationSql).toContain(`CREATE ROLE ${PLATFORM_ROLE} NOLOGIN`);
    expect(migrationSql).toContain(`GRANT ${APP_ROLE} TO ${PLATFORM_ROLE}`);
    expect(migrationSql).toContain(`current_setting('${GROUP_SETTING}', true)::uuid`);
  });

  it.each([...GROUP_SCOPED_MODELS])('strictly scopes "%s"', (table) => {
    expect(policiesFor(table)).toEqual({ enabled: true, platform: true, group: true });
    const policy = new RegExp(
      `CREATE POLICY "${table}_group" ON "${table}" FOR ALL TO ${APP_ROLE}\\s+USING \\("helpDeskGroupId" = current_setting\\('${GROUP_SETTING}', true\\)::uuid\\)`,
    );
    expect(migrationSql).toMatch(policy);
  });

  it.each([...GLOBAL_OR_GROUP_MODELS])('admits platform rows on "%s"', (table) => {
    expect(policiesFor(table)).toEqual({ enabled: true, platform: true, group: true });
    expect(migrationSql).toMatch(
      new RegExp(
        `CREATE POLICY "${table}_group" ON "${table}"[\\s\\S]*?OR "helpDeskGroupId" IS NULL\\)\\s+WITH CHECK \\("helpDeskGroupId" = current_setting`,
      ),
    );
  });

  it.each([...UNSCOPED_MODELS])('leaves platform table "%s" without RLS', (table) => {
    expect(policiesFor(table).enabled).toBe(false);
  });
});
