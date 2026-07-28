/**
 * Strategy: unit tests for typed query bounds / offset / limitToLast local guards on
 * FirestoreQueryBuilder (issue #36). Mock at the Firestore Query boundary — never reimplement
 * cursor math. Integration suite owns emulator semantics; this file pins guards that must fire
 * before any SDK RPC.
 *
 * Verification points:
 *  - U-1: after limitToLast, stream() throws before query.stream is touched
 *  - U-2: limitToLast then limit clears the flag so stream() calls through
 *  - U-3: empty-args startAt() throws locally
 *  - U-4: offset(-1) / non-integer throw; offset(0) forwards to the SDK
 */
import { FirestoreQueryBuilder } from '../../core/QueryBuilder.js';
import { FirestoreCollectionGroupQueryBuilder } from '../../core/CollectionGroup.js';

/**
 * Builds a fluent mock Query whose clause methods return themselves so builder chaining keeps
 * calling the same spy surface (mirrors Admin SDK fluent Query).
 */
function makeFluentQuery() {
  const query: Record<string, jest.Mock> = {};
  const self = () => query;
  query.orderBy = jest.fn(self);
  query.limit = jest.fn(self);
  query.limitToLast = jest.fn(self);
  query.offset = jest.fn(self);
  query.startAt = jest.fn(self);
  query.startAfter = jest.fn(self);
  query.endAt = jest.fn(self);
  query.endBefore = jest.fn(self);
  query.stream = jest.fn(async function* () {
    // empty stream — success path for U-2
  });
  return query;
}

function makeBuilder(query = makeFluentQuery()) {
  const builder = new FirestoreQueryBuilder(
    query as any,
    {} as any,
    {} as any,
    async () => {},
    async () => {},
  );
  return { builder, query };
}

describe('FirestoreQueryBuilder bounds / limitToLast guards (issue #36)', () => {
  it('U-1: stream() after limitToLast throws before touching query.stream', async () => {
    const { builder, query } = makeBuilder();

    const limited = builder.orderBy('score').limitToLast(2);
    const iterate = async () => {
      for await (const _doc of limited.stream()) {
        // drain
      }
    };

    await expect(iterate()).rejects.toThrow(/stream\(\) is not supported after limitToLast/);
    expect(query.stream).not.toHaveBeenCalled();
  });

  it('U-2: limitToLast then limit clears the flag so stream() calls through', async () => {
    const { builder, query } = makeBuilder();

    const streamed: unknown[] = [];
    for await (const doc of builder.orderBy('score').limitToLast(2).limit(3).stream()) {
      streamed.push(doc);
    }

    expect(query.limitToLast).toHaveBeenCalledWith(2);
    expect(query.limit).toHaveBeenCalledWith(3);
    expect(query.stream).toHaveBeenCalledTimes(1);
    expect(streamed).toEqual([]);
  });

  it('U-3: empty-args startAt() throws locally without touching the SDK', () => {
    const { builder, query } = makeBuilder();

    expect(() => (builder as any).startAt()).toThrow(
      /startAt\(\) requires a DocumentSnapshot or at least one field value/,
    );
    expect(query.startAt).not.toHaveBeenCalled();
  });

  it('U-4: offset validates non-negative integers and forwards 0 to the SDK', () => {
    const { builder, query } = makeBuilder();

    expect(() => builder.offset(-1)).toThrow(
      /offset must be a non-negative integer \(received -1\)/,
    );
    expect(() => builder.offset(1.5)).toThrow(/offset must be a non-negative integer/);
    expect(() => builder.offset(NaN)).toThrow(/offset must be a non-negative integer/);
    expect(query.offset).not.toHaveBeenCalled();

    builder.offset(0);
    expect(query.offset).toHaveBeenCalledWith(0);
  });

  it('empty-args startAfter / endAt / endBefore throw with method-specific messages', () => {
    const { builder, query } = makeBuilder();

    expect(() => (builder as any).startAfter()).toThrow(/startAfter\(\) requires/);
    expect(() => (builder as any).endAt()).toThrow(/endAt\(\) requires/);
    expect(() => (builder as any).endBefore()).toThrow(/endBefore\(\) requires/);
    expect(query.startAfter).not.toHaveBeenCalled();
    expect(query.endAt).not.toHaveBeenCalled();
    expect(query.endBefore).not.toHaveBeenCalled();
  });

  it('limitToLast without orderBy throws; non-negative validation applies', () => {
    const { builder, query } = makeBuilder();

    expect(() => builder.limitToLast(2)).toThrow(
      /limitToLast\(\) requires at least one orderBy\(\) call/,
    );
    expect(query.limitToLast).not.toHaveBeenCalled();

    expect(() => builder.orderBy('score').limitToLast(-1)).toThrow(
      /limitToLast must be a non-negative integer \(received -1\)/,
    );
  });

  it('field-value startAt forwards args to the SDK after a non-empty check', () => {
    const { builder, query } = makeBuilder();
    builder.orderBy('score').startAt(30);
    expect(query.startAt).toHaveBeenCalledWith(30);
  });

  it('U-select-copy: select() copies hasLimitToLast so stream() still rejects', async () => {
    const projectedQuery = {
      stream: jest.fn(async function* () {
        // should never be reached when the flag is copied
      }),
    };
    const query: Record<string, jest.Mock | (() => unknown)> = makeFluentQuery();
    query.select = jest.fn(() => projectedQuery);

    const builder = new FirestoreQueryBuilder(
      query as any,
      {} as any,
      {} as any,
      async () => {},
      async () => {},
    );

    const projected = builder.orderBy('score').limitToLast(2).select('name');
    const iterate = async () => {
      for await (const _doc of projected.stream()) {
        // drain
      }
    };

    await expect(iterate()).rejects.toThrow(/stream\(\) is not supported after limitToLast/);
    expect(projectedQuery.stream).not.toHaveBeenCalled();
  });

  it('U-select-copy (group): collection-group select() also copies hasLimitToLast', async () => {
    const projectedQuery = {
      stream: jest.fn(async function* () {}),
    };
    const query: Record<string, jest.Mock | (() => unknown)> = makeFluentQuery();
    query.select = jest.fn(() => projectedQuery);

    const builder = new FirestoreCollectionGroupQueryBuilder(query as any, 'posts', {} as any);
    const projected = builder.orderBy('score').limitToLast(2).select('title');
    const iterate = async () => {
      for await (const _doc of projected.stream()) {
        // drain
      }
    };
    await expect(iterate()).rejects.toThrow(/stream\(\) is not supported after limitToLast/);
    expect(projectedQuery.stream).not.toHaveBeenCalled();
  });

  it('U-select-copy: select() also copies hasOffset so paginate still rejects', async () => {
    const projectedQuery: Record<string, jest.Mock> = {
      get: jest.fn(async () => ({ docs: [] })),
    };
    const query: Record<string, jest.Mock | (() => unknown)> = makeFluentQuery();
    query.select = jest.fn(() => projectedQuery);

    const builder = new FirestoreQueryBuilder(
      query as any,
      {} as any,
      {} as any,
      async () => {},
      async () => {},
    );
    await expect(builder.orderBy('score').offset(1).select('name').paginate(2)).rejects.toThrow(
      /paginate\(\) cannot be used after offset/,
    );
  });

  it('limitToLast(0) forwards to the SDK after validation', () => {
    const { builder, query } = makeBuilder();
    builder.orderBy('score').limitToLast(0);
    expect(query.limitToLast).toHaveBeenCalledWith(0);
  });

  it('R1/R2: paginate and offsetPaginate reject a prior offset()', async () => {
    const { builder } = makeBuilder();

    await expect(builder.orderBy('score').offset(2).paginate(2)).rejects.toThrow(
      /paginate\(\) cannot be used after offset/,
    );
    await expect(
      makeBuilder().builder.orderBy('score').offset(3).offsetPaginate(1, 10),
    ).rejects.toThrow(/offsetPaginate\(\) cannot be used after offset/);
  });

  it('R3: getOne after limitToLast does not apply limit(1)', async () => {
    const { builder, query } = makeBuilder();
    query.get = jest.fn(async () => ({
      docs: [
        { data: () => ({ name: 'd' }), id: 'd' },
        { data: () => ({ name: 'e' }), id: 'e' },
      ],
    }));
    query.limit = jest.fn(() => query);

    const one = await builder.orderBy('score').limitToLast(2).getOne();
    expect(one).toEqual({ name: 'd', id: 'd' });
    expect(query.limit).not.toHaveBeenCalled();
    expect(query.get).toHaveBeenCalledTimes(1);
  });

  it('R4: exists after limitToLast uses count() without limit(1)', async () => {
    const { builder, query } = makeBuilder();
    const countGet = jest.fn(async () => ({ data: () => ({ count: 0 }) }));
    query.count = jest.fn(() => ({ get: countGet }));
    query.limit = jest.fn(() => query);

    const empty = await builder.orderBy('score').limitToLast(0).exists();
    expect(empty).toBe(false);
    expect(query.limit).not.toHaveBeenCalled();
    expect(query.count).toHaveBeenCalledTimes(1);
  });
});
