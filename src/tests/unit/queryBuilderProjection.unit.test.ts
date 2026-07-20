/**
 * Strategy: unit-test the projection soundness of FirestoreQueryBuilder at the Firestore boundary.
 *  - select() returns a NEW builder (immutable) so a pre-select alias is not silently projected.
 *  - onSnapshot() after select() is rejected locally (Firestore forbids field-masked listeners).
 * Mocks the underlying Query: base.get() returns full docs, base.select() returns a distinct
 * projected query whose get() returns projected docs.
 */
import { FirestoreQueryBuilder } from '../../core/QueryBuilder.js';

function makeBuilder() {
  const projectedQuery = {
    get: jest.fn(async () => ({ docs: [{ data: () => ({ name: 'a' }), id: '1' }] })),
  };
  const baseQuery = {
    select: jest.fn(() => projectedQuery),
    get: jest.fn(async () => ({
      docs: [{ data: () => ({ name: 'a', createdAt: 123 }), id: '1' }],
    })),
    onSnapshot: jest.fn(() => () => {}),
  };
  const builder = new FirestoreQueryBuilder(
    baseQuery as any,
    {} as any,
    {} as any,
    async () => {},
    async () => {},
  );
  return { builder, baseQuery, projectedQuery };
}

describe('FirestoreQueryBuilder projection soundness', () => {
  it('select() returns a new builder and leaves the original alias unprojected at runtime', async () => {
    const { builder, baseQuery, projectedQuery } = makeBuilder();

    const projected = builder.select('name');
    expect(projected).not.toBe(builder);
    expect(baseQuery.select).toHaveBeenCalledWith('name');

    // Original alias still reads the full (unprojected) query.
    const original = await builder.get();
    expect(baseQuery.get).toHaveBeenCalledTimes(1);
    expect(projectedQuery.get).not.toHaveBeenCalled();
    expect(original).toEqual([{ name: 'a', createdAt: 123, id: '1' }]);

    // The returned builder reads the projected query.
    const rows = await projected.get();
    expect(projectedQuery.get).toHaveBeenCalledTimes(1);
    expect(rows).toEqual([{ name: 'a', id: '1' }]);
  });

  it('onSnapshot() works without select()', async () => {
    const { builder, baseQuery } = makeBuilder();
    const unsub = await builder.onSnapshot(() => {});
    expect(baseQuery.onSnapshot).toHaveBeenCalledTimes(1);
    expect(typeof unsub).toBe('function');
  });

  it('onSnapshot() after select() is rejected locally', async () => {
    const { builder, projectedQuery } = makeBuilder();
    await expect(builder.select('name').onSnapshot(() => {})).rejects.toThrow(
      /not supported after select/i,
    );
    // The guard fires before touching the SDK.
    expect((projectedQuery as { onSnapshot?: unknown }).onSnapshot).toBeUndefined();
  });
});
