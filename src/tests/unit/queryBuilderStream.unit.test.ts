/**
 * Strategy: unit test that FirestoreQueryBuilder.stream() drives the Admin SDK's native
 * Query.stream() (incremental) rather than buffering the whole result via Query.get(). Mocks the
 * underlying Query at the boundary: stream() yields fake snapshots, get() throws if touched.
 */
import { FirestoreQueryBuilder } from '../../core/QueryBuilder.js';

describe('FirestoreQueryBuilder.stream()', () => {
  it('consumes the native query stream and never calls get()', async () => {
    const getSpy = jest.fn(() => {
      throw new Error('stream() must not call get()');
    });

    async function* fakeSnapshots() {
      yield { data: () => ({ name: 'a' }), id: '1' };
      yield { data: () => ({ name: 'b' }), id: '2' };
    }
    const streamSpy = jest.fn(() => fakeSnapshots());

    const mockQuery = { get: getSpy, stream: streamSpy } as any;
    const builder = new FirestoreQueryBuilder(
      mockQuery,
      {} as any,
      {} as any,
      async () => {},
      async () => {},
    );

    const out: Array<Record<string, unknown>> = [];
    for await (const doc of builder.stream()) {
      out.push(doc as Record<string, unknown>);
    }

    expect(out).toEqual([
      { name: 'a', id: '1' },
      { name: 'b', id: '2' },
    ]);
    expect(streamSpy).toHaveBeenCalledTimes(1);
    expect(getSpy).not.toHaveBeenCalled();
  });

  it('normalizes a stream error through parseFirestoreError', async () => {
    async function* boom() {
      yield { data: () => ({ name: 'a' }), id: '1' };
      throw Object.assign(new Error('No document to update'), { code: 5 });
    }
    const mockQuery = { get: jest.fn(), stream: jest.fn(() => boom()) } as any;
    const builder = new FirestoreQueryBuilder(
      mockQuery,
      {} as any,
      {} as any,
      async () => {},
      async () => {},
    );

    const iterate = async () => {
      for await (const _doc of builder.stream()) {
        // drain
      }
    };
    // code 5 maps to NotFoundError via parseFirestoreError.
    await expect(iterate()).rejects.toMatchObject({ name: 'NotFoundError' });
  });
});
