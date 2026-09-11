import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  GLOBAL_OR_GROUP_MODELS,
  GROUP_SCOPED_MODELS,
  UNSCOPED_MODELS,
  mergeWhere,
  modelToDelegate,
  rewriteOperation,
  STRICT_NULLABLE_COLUMN_MODELS,
  scopeClause,
  scopeCreateData,
  scopeModeFor,
} from '@/lib/db/scoped';
import { TenancyViolationError } from '@/lib/errors';

const GROUP = '00000000-0000-7000-8000-00000000000a';
const OTHER_GROUP = '00000000-0000-7000-8000-00000000000b';

describe('model classification', () => {
  /**
   * The tenancy filter is only as good as its model list. This test reads
   * schema.prisma directly so that adding a model without deciding how it is
   * scoped fails CI instead of silently defaulting to unfiltered.
   */
  it('classifies every model in schema.prisma exactly once', () => {
    const schema = readFileSync('prisma/schema.prisma', 'utf8');
    const models = [...schema.matchAll(/^model\s+(\w+)\s*\{/gm)].map((match) => match[1]!);

    expect(models.length).toBeGreaterThan(30);

    const unclassified: string[] = [];
    const duplicated: string[] = [];

    for (const model of models) {
      const memberships = [
        GROUP_SCOPED_MODELS.has(model),
        GLOBAL_OR_GROUP_MODELS.has(model),
        UNSCOPED_MODELS.has(model),
      ].filter(Boolean).length;

      if (memberships === 0) unclassified.push(model);
      if (memberships > 1) duplicated.push(model);
    }

    expect({ unclassified, duplicated }).toEqual({ unclassified: [], duplicated: [] });
  });

  it('gives every strictly-scoped model a helpDeskGroupId column', () => {
    const schema = readFileSync('prisma/schema.prisma', 'utf8');

    for (const model of GROUP_SCOPED_MODELS) {
      const block = new RegExp(`^model ${model} \\{([\\s\\S]*?)^\\}`, 'm').exec(schema)?.[1];
      expect(block, `model ${model} missing from schema`).toBeDefined();
      expect(block, `${model} should declare helpDeskGroupId`).toMatch(/helpDeskGroupId\s+String/);

      // A nullable column on a strictly-scoped table is allowed only where the
      // asymmetry is documented -- otherwise it is a schema mistake that would
      // let rows exist outside every tenant's view by accident.
      const nullable = /helpDeskGroupId\s+String\?/.test(block!);
      expect(
        !nullable || STRICT_NULLABLE_COLUMN_MODELS.has(model),
        `${model} has a nullable helpDeskGroupId but is not in STRICT_NULLABLE_COLUMN_MODELS`,
      ).toBe(true);
    }
  });

  it('does not list a model as a documented exception unless it is scoped', () => {
    for (const model of STRICT_NULLABLE_COLUMN_MODELS) {
      expect(GROUP_SCOPED_MODELS.has(model), `${model} should be strictly scoped`).toBe(true);
    }
  });

  it('resolves delegate names', () => {
    expect(modelToDelegate('TicketComment')).toBe('ticketComment');
    expect(modelToDelegate('Cab')).toBe('cab');
  });
});

describe('scopeClause', () => {
  it('filters strictly for tenant-only models', () => {
    expect(scopeClause('strict', GROUP)).toEqual({ helpDeskGroupId: GROUP });
  });

  it('admits platform-global rows for globalOrGroup models', () => {
    expect(scopeClause('globalOrGroup', GROUP)).toEqual({
      OR: [{ helpDeskGroupId: GROUP }, { helpDeskGroupId: null }],
    });
  });

  it('knows which mode each model uses', () => {
    expect(scopeModeFor('Ticket')).toBe('strict');
    expect(scopeModeFor('KnowledgeArticle')).toBe('globalOrGroup');
    expect(scopeModeFor('User')).toBeNull();
  });
});

describe('mergeWhere', () => {
  it('preserves top-level unique selectors', () => {
    const merged = mergeWhere({ id: 'abc' }, { helpDeskGroupId: GROUP });
    expect(merged.id).toBe('abc');
    expect(merged.AND).toEqual([{ helpDeskGroupId: GROUP }]);
  });

  it('appends to an existing AND rather than replacing it', () => {
    const merged = mergeWhere(
      { AND: [{ subject: { contains: 'vpn' } }] },
      { helpDeskGroupId: GROUP },
    );
    expect(merged.AND).toEqual([{ subject: { contains: 'vpn' } }, { helpDeskGroupId: GROUP }]);
  });

  it('normalises a single-object AND into a list', () => {
    const merged = mergeWhere({ AND: { subject: 'x' } }, { helpDeskGroupId: GROUP });
    expect(merged.AND).toEqual([{ subject: 'x' }, { helpDeskGroupId: GROUP }]);
  });

  it('does not clobber an existing OR', () => {
    const original = { OR: [{ subject: 'a' }, { subject: 'b' }] };
    const merged = mergeWhere(original, { helpDeskGroupId: GROUP });
    expect(merged.OR).toEqual(original.OR);
    expect(merged.AND).toEqual([{ helpDeskGroupId: GROUP }]);
  });

  it('handles an absent where', () => {
    expect(mergeWhere(undefined, { helpDeskGroupId: GROUP })).toEqual({
      AND: [{ helpDeskGroupId: GROUP }],
    });
  });
});

describe('rewriteOperation', () => {
  it('injects the tenant filter into reads', () => {
    const result = rewriteOperation({
      model: 'Ticket',
      operation: 'findMany',
      args: { where: { statusId: 's1' } },
      groupId: GROUP,
    });

    expect(result.operation).toBe('findMany');
    expect(result.args.where).toEqual({
      statusId: 's1',
      AND: [{ helpDeskGroupId: GROUP }],
    });
  });

  it('converts findUnique to findFirst so the filter can be applied', () => {
    const result = rewriteOperation({
      model: 'Ticket',
      operation: 'findUnique',
      args: { where: { reference: 'ITHD-000001' } },
      groupId: GROUP,
    });

    expect(result.operation).toBe('findFirst');
    expect(result.args.where).toEqual({
      reference: 'ITHD-000001',
      AND: [{ helpDeskGroupId: GROUP }],
    });
  });

  it('converts findUniqueOrThrow to findFirstOrThrow', () => {
    expect(
      rewriteOperation({
        model: 'Ticket',
        operation: 'findUniqueOrThrow',
        args: {},
        groupId: GROUP,
      }).operation,
    ).toBe('findFirstOrThrow');
  });

  it('scopes batch writes through the where clause', () => {
    for (const operation of ['updateMany', 'deleteMany']) {
      const result = rewriteOperation({
        model: 'Ticket',
        operation,
        args: { where: { assigneeId: null } },
        groupId: GROUP,
      });
      expect(result.args.where).toMatchObject({ AND: [{ helpDeskGroupId: GROUP }] });
      expect(result.ownershipCheck).toBe(false);
    }
  });

  it('forces the tenant column onto creates', () => {
    const result = rewriteOperation({
      model: 'Ticket',
      operation: 'create',
      args: { data: { subject: 'test' } },
      groupId: GROUP,
    });

    expect(result.args.data).toEqual({ subject: 'test', helpDeskGroupId: GROUP });
  });

  it('forces the tenant column onto every row of a createMany', () => {
    const result = rewriteOperation({
      model: 'TicketEvent',
      operation: 'createMany',
      args: { data: [{ ticketId: 't1' }, { ticketId: 't2' }] },
      groupId: GROUP,
    });

    expect(result.args.data).toEqual([
      { ticketId: 't1', helpDeskGroupId: GROUP },
      { ticketId: 't2', helpDeskGroupId: GROUP },
    ]);
  });

  it('flags single-row writes for an ownership pre-check', () => {
    for (const operation of ['update', 'delete', 'upsert']) {
      const result = rewriteOperation({
        model: 'Ticket',
        operation,
        args: { where: { id: 't1' } },
        groupId: GROUP,
      });
      expect(result.ownershipCheck).toBe(true);
    }
  });

  it('leaves unscoped models completely alone', () => {
    const args = { where: { email: 'a@b.c' } };
    const result = rewriteOperation({
      model: 'User',
      operation: 'findUnique',
      args,
      groupId: GROUP,
    });

    expect(result.operation).toBe('findUnique');
    expect(result.args).toBe(args);
    expect(result.ownershipCheck).toBe(false);
  });

  it('fails closed on an operation it does not recognise', () => {
    expect(() =>
      rewriteOperation({
        model: 'Ticket',
        operation: 'someFutureOperation',
        args: {},
        groupId: GROUP,
      }),
    ).toThrow(TenancyViolationError);
  });
});

describe('scopeCreateData', () => {
  it('rejects a row that names a different group', () => {
    expect(() =>
      scopeCreateData({ helpDeskGroupId: OTHER_GROUP }, GROUP, 'Ticket', 'create'),
    ).toThrow(TenancyViolationError);
  });

  it('accepts a row that names the active group', () => {
    expect(
      scopeCreateData({ helpDeskGroupId: GROUP, subject: 'x' }, GROUP, 'Ticket', 'create'),
    ).toEqual({ helpDeskGroupId: GROUP, subject: 'x' });
  });

  it('rejects a bad row inside an array', () => {
    expect(() =>
      scopeCreateData(
        [{ helpDeskGroupId: GROUP }, { helpDeskGroupId: OTHER_GROUP }],
        GROUP,
        'TicketEvent',
        'createMany',
      ),
    ).toThrow(TenancyViolationError);
  });
});
