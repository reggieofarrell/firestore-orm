/**
 * Strategy: unit-test the PURE-LOGIC guards of `whereFilter()` (issue #30) at the Firestore
 * boundary, so they are checked by the pre-push hook (unit only — no emulator). The query semantics
 * of a disjunction are proven separately in repository-composite-filters.integration.test.ts; this
 * file covers only what needs no Firestore.
 *
 * Verification points:
 *  - The factory hands `Query.where()` a real SDK `Filter` (not a field path), for a bare condition
 *    and for a nested and/or group.
 *  - An empty `f.and()` / `f.or()` group is rejected at the construction site. The SDK silently DROPS
 *    an empty composite filter, so this is the difference between "no filter" and "matches every
 *    document".
 *  - A callback that does not return a filter is rejected with a message that names `whereFilter`
 *    and the factory. The compiler cannot catch this (the SDK's `Filter` type is structurally empty —
 *    see query-paths.type-test.ts) and the SDK's own rejection is an opaque argument error, so this
 *    guard exists for diagnostics. The message names only the value's type, never its contents.
 *  - A prebuilt filter that reduces to zero conditions is rejected (the SDK returns the query
 *    unchanged, which would silently widen the query to the whole collection).
 *  - `f.whereId()` applies the same validated id boundary as `whereId()`, honoring
 *    `allowLegacyDatastoreIds` — including through `select()`, which previously dropped the flag.
 */
import { Filter } from 'firebase-admin/firestore';
import { FirestoreQueryBuilder } from '../../core/QueryBuilder.js';
import { InvalidDocumentIdError } from '../../core/Errors.js';

/**
 * Builds a FirestoreQueryBuilder over a mocked Query. `where()` returns a DISTINCT query object so
 * the builder's "filter was silently dropped" guard (reference equality against the pre-filter
 * query) is not tripped by the mock itself; `noopWhere` opts into the SDK's real empty-filter
 * behavior of returning the same query.
 */
function makeBuilder(opts: { allowLegacyDatastoreIds?: boolean; noopWhere?: boolean } = {}) {
  const { allowLegacyDatastoreIds = false, noopWhere = false } = opts;
  const filtered = { get: jest.fn(async () => ({ docs: [] })) };
  const query: Record<string, jest.Mock> = {
    where: jest.fn(() => (noopWhere ? query : filtered)),
    select: jest.fn(() => query),
  };
  const builder = new FirestoreQueryBuilder(
    query as any,
    {} as any,
    {} as any,
    async () => {},
    async () => {},
    undefined,
    allowLegacyDatastoreIds,
  );
  return { builder, query };
}

describe('FirestoreQueryBuilder whereFilter guards', () => {
  it('passes a real SDK Filter to Query.where() for a bare condition', () => {
    const { builder, query } = makeBuilder();

    const returned = builder.whereFilter(f => f.where('status', '==', 'published'));

    expect(returned).toBe(builder); // chainable: mutates in place like where()
    expect(query.where).toHaveBeenCalledTimes(1);
    expect(query.where).toHaveBeenCalledWith(expect.any(Filter));
    // Exactly one argument — a field-path/op/value call would pass three.
    expect(query.where.mock.calls[0]).toHaveLength(1);
  });

  it('passes a nested and/or group as a single composite Filter', () => {
    const { builder, query } = makeBuilder();

    builder.whereFilter(f =>
      f.or(
        f.where('status', '==', 'published'),
        f.and(f.where('a', '==', 1), f.where('b', '==', 2)),
      ),
    );

    expect(query.where).toHaveBeenCalledTimes(1);
    expect(query.where).toHaveBeenCalledWith(expect.any(Filter));
  });

  it('rejects an empty or()/and() group at the construction site', () => {
    expect(() => makeBuilder().builder.whereFilter(f => f.or())).toThrow(
      /f\.or\(\) requires at least one filter/,
    );
    expect(() => makeBuilder().builder.whereFilter(f => f.and())).toThrow(
      /f\.and\(\) requires at least one filter/,
    );
    // Nested empty groups are rejected too — the SDK drops them at ANY depth.
    expect(() =>
      makeBuilder().builder.whereFilter(f => f.or(f.where('a', '==', 1), f.and())),
    ).toThrow(/f\.and\(\) requires at least one filter/);

    // The guard fires before the SDK is touched.
    const { builder, query } = makeBuilder();
    expect(() => builder.whereFilter(f => f.or())).toThrow();
    expect(query.where).not.toHaveBeenCalled();
  });

  it('rejects a callback that does not return a filter, reporting only the type', () => {
    const cases: Array<[unknown, RegExp]> = [
      [undefined, /received undefined/],
      [null, /received null/],
      ['status == published', /received string/],
      [42, /received number/],
      [{ field: 'secret-value' }, /received object/],
    ];

    for (const [value, expected] of cases) {
      const { builder, query } = makeBuilder();
      expect(() => builder.whereFilter(() => value as any)).toThrow(expected);
      expect(() => builder.whereFilter(() => value as any)).toThrow(
        /must return a filter built with the provided factory/,
      );
      expect(query.where).not.toHaveBeenCalled();
    }

    // A secret carried by the rejected value is never echoed into the message.
    const { builder } = makeBuilder();
    expect(() => builder.whereFilter(() => ({ token: 'super-secret' }) as any)).not.toThrow(
      /super-secret/,
    );
  });

  it('rejects a prebuilt filter the SDK would silently drop', () => {
    // noopWhere models the SDK returning the query UNCHANGED for a zero-condition filter.
    const { builder } = makeBuilder({ noopWhere: true });

    expect(() => builder.whereFilter(() => Filter.or())).toThrow(
      /no conditions, which Firestore silently drops/,
    );
  });

  it('applies the validated id boundary inside a composite', () => {
    expect(() => makeBuilder().builder.whereFilter(f => f.whereId('==', 'bad/id'))).toThrow(
      InvalidDocumentIdError,
    );
    expect(() =>
      makeBuilder().builder.whereFilter(f => f.or(f.whereId('in', ['ok', '../escape']))),
    ).toThrow(InvalidDocumentIdError);

    // A well-formed id passes through as a document-name Filter.
    const { builder, query } = makeBuilder();
    builder.whereFilter(f => f.whereId('==', 'user-123'));
    expect(query.where).toHaveBeenCalledWith(expect.any(Filter));
  });

  it('honors allowLegacyDatastoreIds in the factory, including after select()', () => {
    // Opted in: the reserved `__id<n>__` Datastore-import namespace is addressable.
    expect(() =>
      makeBuilder({ allowLegacyDatastoreIds: true }).builder.whereFilter(f =>
        f.whereId('==', '__id7__'),
      ),
    ).not.toThrow();

    // Not opted in: still rejected.
    expect(() => makeBuilder().builder.whereFilter(f => f.whereId('==', '__id7__'))).toThrow(
      InvalidDocumentIdError,
    );

    // Regression: select() must carry the flag into the replacement builder. It previously omitted
    // the constructor argument, so the projected builder silently fell back to `false`.
    expect(() =>
      makeBuilder({ allowLegacyDatastoreIds: true })
        .builder.select('name')
        .whereFilter(f => f.whereId('==', '__id7__')),
    ).not.toThrow();
    expect(() =>
      makeBuilder({ allowLegacyDatastoreIds: true })
        .builder.select('name')
        .whereId('==', '__id7__'),
    ).not.toThrow();
    expect(() => makeBuilder().builder.select('name').whereId('==', '__id7__')).toThrow(
      InvalidDocumentIdError,
    );
  });
});
