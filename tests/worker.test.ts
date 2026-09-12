import { describe, expect, it } from 'vitest';
import { evaluateRuntimeRole } from '@/lib/db/role-check';
import { planMailboxSync } from '@/worker/jobs';

const group = (overrides: Partial<Parameters<typeof planMailboxSync>[0][number]>) => ({
  id: 'g',
  key: 'G',
  isActive: true,
  mailboxSyncEnabled: true,
  inboundEmailAddress: 'g@example.com',
  ...overrides,
});

describe('planMailboxSync', () => {
  it('polls only active groups that opted in and have a mailbox', () => {
    const plan = planMailboxSync([
      group({ id: 'ok' }),
      group({ id: 'inactive', isActive: false }),
      group({ id: 'off', mailboxSyncEnabled: false }),
      group({ id: 'nomailbox', inboundEmailAddress: null }),
    ]);
    expect(plan.map((item) => item.id)).toEqual(['ok']);
  });

  it('is empty when nothing qualifies', () => {
    expect(planMailboxSync([])).toEqual([]);
  });
});

describe('evaluateRuntimeRole', () => {
  const healthy = {
    user: 'helpdesk_runtime',
    superuser: false,
    rolesExist: true,
    platformMember: true,
    appMember: true,
  };

  it('accepts the intended runtime role', () => {
    expect(evaluateRuntimeRole(healthy)).toEqual([]);
  });

  it('reports a superuser, which would bypass every policy', () => {
    expect(evaluateRuntimeRole({ ...healthy, superuser: true })[0]).toMatch(/superuser/);
  });

  it('reports missing memberships separately', () => {
    const problems = evaluateRuntimeRole({ ...healthy, platformMember: false, appMember: false });
    expect(problems).toHaveLength(2);
  });

  it('points at the migrations when the roles are absent', () => {
    expect(evaluateRuntimeRole({ ...healthy, rolesExist: false })).toEqual([
      expect.stringContaining('db:deploy'),
    ]);
  });
});
