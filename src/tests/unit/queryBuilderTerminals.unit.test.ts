/**
 * Strategy: unit-test the FirestoreQueryBuilder terminal-read fixes at the Firestore boundary
 * (ADR-0021 / review findings D3, D12). Mocks the underlying Query so no emulator is needed.
 *
 * Verification points:
 *  - getOne()/exists() read a LOCAL limited query (this.query.limit(1)) and do NOT mutate this.query,
 *    so a later terminal on the same builder is not silently limited (the D3 regression).
 *  - getOne()/exists() normalize SDK errors through parseFirestoreError (they bypass the wrapper
 *    get()/count() that previously provided that mapping).
 *  - onSnapshot() routes asynchronous listener errors through parseFirestoreError (D12), matching
 *    listenOne()/get()/stream().
 *  - A projected getOne() (after select()) still shapes the result as `{ ...projectedData, id }`.
 */
import { FirestoreQueryBuilder } from '../../core/QueryBuilder.js';
import { NotFoundError } from '../../core/Errors.js';

type Doc = { data: () => Record<string, unknown>; id: string };

function doc(id: string, data: Record<string, unknown>): Doc {
  return { id, data: () => data };
}

/**
 * Builds a FirestoreQueryBuilder over a mocked Query. `limit()` returns a distinct limited query so
 * we can prove getOne()/exists() never reassign this.query back to the limited form.
 */
function makeBuilder(opts: {
  fullDocs?: Doc[];
  limitedDocs?: Doc[];
  count?: number;
  limitedGetError?: unknown;
  countGetError?: unknown;
  projectedDocs?: Doc[];
}) {
  const {
    fullDocs = [],
    limitedDocs = [],
    count = 0,
    limitedGetError,
    countGetError,
    projectedDocs = [],
  } = opts;

  const countAggregate = {
    get: jest.fn(async () => {
      if (countGetError !== undefined) throw countGetError;
      return { data: () => ({ count }) };
    }),
  };
  const limited = {
    get: jest.fn(async () => {
      if (limitedGetError !== undefined) throw limitedGetError;
      return { docs: limitedDocs };
    }),
    count: jest.fn(() => countAggregate),
  };
  const projectedLimited = {
    get: jest.fn(async () => ({ docs: projectedDocs })),
  };
  const projectedQuery = {
    limit: jest.fn(() => projectedLimited),
  };
  let capturedOnError: ((error: unknown) => void) | undefined;
  const query = {
    limit: jest.fn(() => limited),
    get: jest.fn(async () => ({ docs: fullDocs })),
    select: jest.fn(() => projectedQuery),
    onSnapshot: jest.fn((_next: unknown, onError: (error: unknown) => void) => {
      capturedOnError = onError;
      return () => {};
    }),
  };

  const builder = new FirestoreQueryBuilder(
    query as any,
    {} as any,
    {} as any,
    async () => {},
    async () => {},
  );
  return {
    builder,
    query,
    limited,
    countAggregate,
    projectedLimited,
    emitError: () => capturedOnError,
  };
}

describe('FirestoreQueryBuilder terminal reads (D3, D12)', () => {
  it('getOne() reads a local limited query and does not limit later reads of the same builder', async () => {
    const { builder, query, limited } = makeBuilder({
      fullDocs: [doc('1', { name: 'a' }), doc('2', { name: 'b' })],
      limitedDocs: [doc('1', { name: 'a' })],
    });

    const one = await builder.getOne();
    expect(one).toEqual({ name: 'a', id: '1' });
    expect(query.limit).toHaveBeenCalledWith(1);
    expect(limited.get).toHaveBeenCalledTimes(1);

    // The builder was NOT mutated: a subsequent get() returns the full (unlimited) result set.
    const all = await builder.get();
    expect(query.get).toHaveBeenCalledTimes(1);
    expect(all).toEqual([
      { name: 'a', id: '1' },
      { name: 'b', id: '2' },
    ]);
  });

  it('getOne() returns null when the limited query is empty', async () => {
    const { builder } = makeBuilder({ limitedDocs: [] });
    expect(await builder.getOne()).toBeNull();
  });

  it('exists() reads a local limited count and leaves the builder unchanged', async () => {
    const { builder, query, limited, countAggregate } = makeBuilder({
      fullDocs: [doc('1', { name: 'a' })],
      count: 3,
    });

    expect(await builder.exists()).toBe(true);
    expect(query.limit).toHaveBeenCalledWith(1);
    expect(limited.count).toHaveBeenCalledTimes(1);
    expect(countAggregate.get).toHaveBeenCalledTimes(1);

    // Builder unchanged: a later get() still reads the base query.
    await builder.get();
    expect(query.get).toHaveBeenCalledTimes(1);
  });

  it('exists() returns false for a zero count', async () => {
    const { builder } = makeBuilder({ count: 0 });
    expect(await builder.exists()).toBe(false);
  });

  it('getOne() normalizes a coded SDK error through parseFirestoreError', async () => {
    const { builder } = makeBuilder({ limitedGetError: { code: 5, message: 'gone' } });
    await expect(builder.getOne()).rejects.toBeInstanceOf(NotFoundError);
  });

  it('exists() normalizes a coded SDK error through parseFirestoreError', async () => {
    const { builder } = makeBuilder({ countGetError: { code: 5, message: 'gone' } });
    await expect(builder.exists()).rejects.toBeInstanceOf(NotFoundError);
  });

  it('onSnapshot() routes asynchronous listener errors through parseFirestoreError', async () => {
    const { builder, emitError } = makeBuilder({});
    const onError = jest.fn();
    await builder.onSnapshot(() => {}, onError);

    const deliver = emitError();
    expect(typeof deliver).toBe('function');
    deliver!({ code: 5, message: 'gone' });

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toBeInstanceOf(NotFoundError);
  });

  it('projected getOne() (after select) shapes the projected data plus id', async () => {
    const { builder, projectedLimited } = makeBuilder({
      projectedDocs: [doc('1', { name: 'a' })],
    });
    const projected = builder.select('name' as any);
    const one = await projected.getOne();
    expect(projectedLimited.get).toHaveBeenCalledTimes(1);
    expect(one).toEqual({ name: 'a', id: '1' });
  });
});
