/**
 * Strategy: unit-test FirestoreQueryBuilderBase.aggregate() at the mocked Query boundary
 * (issue #34 / ADR-0027). No emulator — asserts the local guards, SDK AggregateField mapping, and
 * result shaping (safeAssign / sum ?? 0 / average null fidelity).
 *
 * Verification points (plan §6.1):
 *  - U-1/U-2: SDK spec keys are caller aliases; kind maps to AggregateField.count/sum/average
 *    (average uses AggregateField.average — not a raw 'avg' string).
 *  - U-3/U-4: empty spec and '__proto__' alias throw BEFORE query.aggregate is called.
 *  - U-5: sum aliases are ?? 0-normalized; average null passes through; count stays 0.
 *  - U-6/U-7: result own keys === aliases; prototype is Object.prototype; constructor/toString
 *    aliases are own properties with the right values.
 *  - U-8: local guards throw plain Error (not rewritten by parseFirestoreError).
 *  - U-9: unknown / missing kind throw BEFORE query.aggregate (no silent average fallthrough).
 */
import { AggregateField } from 'firebase-admin/firestore';
import { FirestoreQueryBuilder } from '../../core/QueryBuilder.js';
import * as ErrorParser from '../../core/ErrorParser.js';

type AggregateGetResult = { data: () => Record<string, unknown> };

/**
 * Builds a FirestoreQueryBuilder over a mocked Query whose `aggregate` captures the SDK spec and
 * returns a stub AggregateQuerySnapshot. Optionally marks the builder as post-select so the
 * kind-aware select guard can be exercised without calling select() (which needs a real mask).
 */
function makeAggregateBuilder(
  opts: {
    data?: Record<string, unknown>;
    hasSelect?: boolean;
    aggregateImpl?: (spec: Record<string, AggregateField>) => AggregateGetResult;
  } = {},
) {
  const { data = {}, hasSelect = false, aggregateImpl } = opts;
  const aggregate = jest.fn((spec: Record<string, AggregateField>) => {
    const snapshot: AggregateGetResult = aggregateImpl ? aggregateImpl(spec) : { data: () => data };
    return {
      get: jest.fn(async () => snapshot),
    };
  });
  const query = { aggregate };
  const builder = new FirestoreQueryBuilder(
    query as any,
    {} as any,
    {} as any,
    async () => {},
    async () => {},
  );
  if (hasSelect) {
    // hasSelect is protected — reach it the same way select() would set it, without needing a
    // real field-mask Query (this suite only asserts the local guard, not select() itself).
    (builder as unknown as { hasSelect: boolean }).hasSelect = true;
  }
  return { builder, aggregate, query };
}

describe('FirestoreQueryBuilder.aggregate() (issue #34)', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('U-1/U-2: builds the SDK spec with caller aliases and AggregateField factories', async () => {
    const { builder, aggregate } = makeAggregateBuilder({
      data: { orders: 2, revenue: 30, avgOrder: 15 },
    });

    await builder.aggregate({
      orders: { kind: 'count' },
      revenue: { kind: 'sum', field: 'score' },
      avgOrder: { kind: 'average', field: 'score' },
    } as any);

    expect(aggregate).toHaveBeenCalledTimes(1);
    const sdkSpec = aggregate.mock.calls[0][0] as Record<string, AggregateField>;
    expect(Object.keys(sdkSpec).sort()).toEqual(['avgOrder', 'orders', 'revenue']);

    expect(sdkSpec.orders).toBeInstanceOf(AggregateField);
    expect(sdkSpec.orders.aggregateType).toBe('count');

    expect(sdkSpec.revenue).toBeInstanceOf(AggregateField);
    expect(sdkSpec.revenue.aggregateType).toBe('sum');

    // Public kind is 'average'; the SDK's AggregateField.average sets aggregateType to 'avg'.
    // Asserting AggregateField.average was used (not a hand-rolled { aggregateType: 'avg' }).
    expect(sdkSpec.avgOrder).toBeInstanceOf(AggregateField);
    expect(sdkSpec.avgOrder.aggregateType).toBe('avg');
    // Sanity: the factory we would have called produces the same type tag.
    expect(AggregateField.average('score').aggregateType).toBe('avg');
  });

  it('U-3: empty spec throws and never calls query.aggregate', async () => {
    const { builder, aggregate } = makeAggregateBuilder();
    await expect(builder.aggregate({} as any)).rejects.toThrow(/non-empty spec/);
    expect(aggregate).not.toHaveBeenCalled();
  });

  it('U-4: __proto__ alias throws and never calls query.aggregate', async () => {
    const { builder, aggregate } = makeAggregateBuilder();
    // Build a spec whose own enumerable key is literally '__proto__' (Object.assign would not).
    const spec = Object.create(null) as Record<string, { kind: 'count' }>;
    Object.defineProperty(spec, '__proto__', {
      value: { kind: 'count' },
      enumerable: true,
      configurable: true,
      writable: true,
    });
    await expect(builder.aggregate(spec as any)).rejects.toThrow(/__proto__/);
    expect(aggregate).not.toHaveBeenCalled();
  });

  it('U-5: sum aliases are ?? 0-normalized; average null passes through', async () => {
    const { builder } = makeAggregateBuilder({
      data: { s: null, a: null, c: 0 },
    });
    const result = await builder.aggregate({
      s: { kind: 'sum', field: 'score' },
      a: { kind: 'average', field: 'score' },
      c: { kind: 'count' },
    } as any);
    expect(result).toEqual({ s: 0, a: null, c: 0 });
  });

  it('U-6: result own keys are exactly the aliases and prototype is Object.prototype', async () => {
    const { builder } = makeAggregateBuilder({
      data: { orders: 1, revenue: 10 },
    });
    const result = await builder.aggregate({
      orders: { kind: 'count' },
      revenue: { kind: 'sum', field: 'score' },
    } as any);
    expect(Object.getOwnPropertyNames(result).sort()).toEqual(['orders', 'revenue']);
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
  });

  it('U-7: constructor / toString aliases come back as own properties', async () => {
    const { builder } = makeAggregateBuilder({
      data: { constructor: 3, toString: 7 },
    });
    const result = await builder.aggregate({
      constructor: { kind: 'count' },
      toString: { kind: 'count' },
    } as any);
    expect(Object.prototype.hasOwnProperty.call(result, 'constructor')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(result, 'toString')).toBe(true);
    expect(result.constructor).toBe(3);
    expect(result.toString).toBe(7);
  });

  it('U-8: local guards throw plain Error, not a parseFirestoreError rewrite', async () => {
    const rewrite = jest
      .spyOn(ErrorParser, 'parseFirestoreError')
      .mockImplementation(() => new Error('REWRITTEN_BY_PARSER'));
    const { builder, aggregate } = makeAggregateBuilder({ hasSelect: true });

    await expect(builder.aggregate({} as any)).rejects.toThrow(/non-empty spec/);
    await expect(
      builder.aggregate({ revenue: { kind: 'sum', field: 'score' } } as any),
    ).rejects.toThrow(/not supported after select/);
    await expect(
      builder.aggregate({ total: { kind: 'total', field: 'score' } } as any),
    ).rejects.toThrow(/unsupported kind/);
    expect(aggregate).not.toHaveBeenCalled();
    expect(rewrite).not.toHaveBeenCalled();
  });

  it('U-9: unknown / missing kind throws and never calls query.aggregate', async () => {
    const { builder, aggregate } = makeAggregateBuilder();

    // Typo / dashboard config: "total" is not a kind — must not silently become average.
    await expect(
      builder.aggregate({ total: { kind: 'total', field: 'score' } } as any),
    ).rejects.toThrow(/unsupported kind.*"total"/);
    // Missing entry (O1): undefined value must not TypeError inside the try via parseFirestoreError.
    await expect(builder.aggregate({ a: undefined } as any)).rejects.toThrow(/unsupported kind/);
    expect(aggregate).not.toHaveBeenCalled();
  });

  it('select() + count-only does not hit the field-aggregation guard', async () => {
    const { builder, aggregate } = makeAggregateBuilder({
      hasSelect: true,
      data: { orders: 4 },
    });
    await expect(builder.aggregate({ orders: { kind: 'count' } } as any)).resolves.toEqual({
      orders: 4,
    });
    expect(aggregate).toHaveBeenCalledTimes(1);
  });
});
