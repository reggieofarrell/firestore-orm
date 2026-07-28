/**
 * Strategy: unit-test Query Explain (`explain()`) success paths and local guards at the Firestore
 * boundary (issue #37 / ADR-0031). Mocks own the happy path because the emulator always throws
 * `No explain results` (D4). Integration covers that emulator failure mode only.
 *
 * Verification points:
 *  - U-1: options are forwarded to SDK `explain` (including `{ analyze: true }` and `undefined`).
 *  - U-2 / U-3: `documents: null` (plan-only) vs `documents: []` (analyzed, empty) are distinct.
 *  - U-4: collection analyze maps docs through `toResult` (`{…data, id}`).
 *  - U-4g: collection-group analyze maps via group `toResult` (`path` / `parentPath`).
 *  - U-5 / U-5v: SDK throws are routed through `parseFirestoreError` (coded error → NotFoundError).
 *  - U-6: missing `query.explain` → local capability Error (upgrade hint).
 *  - U-7 / U-8 / U-2v / U-3v / U-9: vector findNearest gate, doc mapping, null/[] contract,
 *    and defense-in-depth missing-`explain` guard.
 */
import { FirestoreCollectionGroupQueryBuilder } from '../../core/CollectionGroup.js';
import { NotFoundError } from '../../core/Errors.js';
import { FirestoreQueryBuilder } from '../../core/QueryBuilder.js';
import { VectorQueryBuilder } from '../../vector/VectorQueryBuilder.js';

type Doc = {
  data: () => Record<string, unknown>;
  id: string;
  ref?: { path: string; parent: { path: string } };
};

function doc(
  id: string,
  data: Record<string, unknown>,
  pathParts?: { path: string; parentPath: string },
): Doc {
  return {
    id,
    data: () => data,
    ...(pathParts ? { ref: { path: pathParts.path, parent: { path: pathParts.parentPath } } } : {}),
  };
}

/** Structural metrics stub — unit tests never assert production plan fields. */
const PLAN_METRICS = {
  planSummary: { indexesUsed: [{ query_scope: 'COLLECTION', properties: '(name ASC)' }] },
  executionStats: null,
};

const ANALYZE_METRICS = {
  planSummary: { indexesUsed: [] as Array<{ query_scope: string; properties: string }> },
  executionStats: {
    resultsReturned: 0,
    executionDuration: { seconds: 0, nanos: 0 },
    readOperations: 0,
  },
};

function makeCollectionBuilder(opts: { explainImpl?: jest.Mock; omitExplain?: boolean }) {
  const explain =
    opts.explainImpl ??
    jest.fn(async () => ({
      metrics: PLAN_METRICS,
      snapshot: null,
    }));
  const query: Record<string, unknown> = {
    get: jest.fn(async () => ({ docs: [] })),
  };
  if (!opts.omitExplain) {
    query.explain = explain;
  }
  const builder = new FirestoreQueryBuilder(
    query as any,
    {} as any,
    {} as any,
    async () => {},
    async () => {},
  );
  return { builder, query, explain };
}

function makeGroupBuilder(opts: { explainImpl?: jest.Mock }) {
  const explain =
    opts.explainImpl ??
    jest.fn(async () => ({
      metrics: PLAN_METRICS,
      snapshot: null,
    }));
  const query = { explain, get: jest.fn(async () => ({ docs: [] })) };
  const builder = new FirestoreCollectionGroupQueryBuilder(query as any, 'posts', {} as any);
  return { builder, query, explain };
}

function createMockCoreBuilder(findNearestImpl?: () => unknown) {
  const query = {
    where: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    findNearest: jest.fn().mockImplementation(
      findNearestImpl ??
        (() => ({
          get: jest.fn().mockResolvedValue({ docs: [] }),
          explain: jest.fn().mockResolvedValue({
            metrics: PLAN_METRICS,
            snapshot: null,
          }),
        })),
    ),
  };

  const builder = {
    where: jest.fn(function (
      this: FirestoreQueryBuilder<Record<string, unknown>>,
      ...args: unknown[]
    ) {
      query.where(...args);
      return this;
    }),
    select: jest.fn(function (
      this: FirestoreQueryBuilder<Record<string, unknown>>,
      ...args: unknown[]
    ) {
      query.select(...args);
      return this;
    }),
    getUnderlyingQuery: jest.fn(() => query),
  } as unknown as FirestoreQueryBuilder<{ id?: string; name: string }>;

  return { builder, query };
}

describe('Query explain() — Core (issue #37)', () => {
  it('U-1: forwards options to SDK explain (analyze true and undefined)', async () => {
    const { builder, explain } = makeCollectionBuilder({});

    await builder.explain();
    expect(explain).toHaveBeenCalledWith(undefined);

    await builder.explain({ analyze: true });
    expect(explain).toHaveBeenCalledWith({ analyze: true });
  });

  it('U-2: plan-only mock (snapshot null) → documents: null', async () => {
    const { builder } = makeCollectionBuilder({
      explainImpl: jest.fn(async () => ({
        metrics: PLAN_METRICS,
        snapshot: null,
      })),
    });

    const result = await builder.explain();
    expect(result.metrics).toBe(PLAN_METRICS);
    expect(result.documents).toBeNull();
  });

  it('U-3: analyze mock with 0 docs → documents: [] (not null)', async () => {
    const { builder } = makeCollectionBuilder({
      explainImpl: jest.fn(async () => ({
        metrics: ANALYZE_METRICS,
        snapshot: { docs: [] },
      })),
    });

    const result = await builder.explain({ analyze: true });
    expect(result.documents).toEqual([]);
    expect(result.documents).not.toBeNull();
  });

  it('U-4: analyze mock with docs → collection toResult mapping', async () => {
    const { builder } = makeCollectionBuilder({
      explainImpl: jest.fn(async () => ({
        metrics: ANALYZE_METRICS,
        snapshot: { docs: [doc('u1', { name: 'Ada' })] },
      })),
    });

    const result = await builder.explain({ analyze: true });
    expect(result.documents).toEqual([{ name: 'Ada', id: 'u1' }]);
  });

  it('U-4g: collection-group analyze maps path and parentPath via toResult', async () => {
    const { builder } = makeGroupBuilder({
      explainImpl: jest.fn(async () => ({
        metrics: ANALYZE_METRICS,
        snapshot: {
          docs: [
            doc(
              'p1',
              { title: 'Hello' },
              { path: 'users/u1/posts/p1', parentPath: 'users/u1/posts' },
            ),
          ],
        },
      })),
    });

    const result = await builder.explain({ analyze: true });
    expect(result.documents).toHaveLength(1);
    expect(result.documents![0]).toEqual({
      title: 'Hello',
      id: 'p1',
      path: 'users/u1/posts/p1',
      parentPath: 'users/u1/posts',
    });
  });

  it('U-5: SDK throw → parseFirestoreError path (coded error becomes NotFoundError)', async () => {
    // Plain Error('No explain results') is rethrown unchanged by ErrorParser, so that alone cannot
    // prove the catch wraps through parseFirestoreError. A coded SDK-shaped rejection must become a
    // typed ORM error — proving the wrapper is on the path.
    const { builder } = makeCollectionBuilder({
      explainImpl: jest.fn(async () => {
        throw { code: 5, message: 'No explain results' };
      }),
    });

    await expect(builder.explain()).rejects.toBeInstanceOf(NotFoundError);
  });

  it('U-6: missing query.explain → local capability Error mentioning upgrade', async () => {
    const { builder } = makeCollectionBuilder({ omitExplain: true });

    await expect(builder.explain()).rejects.toThrow(/explain\(\) is not available.*Upgrade/i);
  });
});

describe('Query explain() — Vector (issue #37)', () => {
  const findNearestOptions = {
    vectorField: 'embedding' as const,
    queryVector: [1, 0, 0],
    limit: 1,
    distanceMeasure: 'EUCLIDEAN' as const,
  };

  it('U-7: before findNearest → throws requiring findNearest', async () => {
    const { builder } = createMockCoreBuilder();
    const vectorBuilder = new VectorQueryBuilder(builder);

    await expect(vectorBuilder.explain()).rejects.toThrow(/requires findNearest\(\)/i);
  });

  it('U-8: after findNearest, explain maps docs like get and returns metrics', async () => {
    const explain = jest.fn(async () => ({
      metrics: ANALYZE_METRICS,
      snapshot: {
        docs: [{ id: 'doc-1', data: () => ({ name: 'nearest' }) }],
      },
    }));
    const { builder } = createMockCoreBuilder(() => ({
      get: jest.fn().mockResolvedValue({ docs: [] }),
      explain,
    }));
    const vectorBuilder = new VectorQueryBuilder(builder);

    const result = await vectorBuilder.findNearest(findNearestOptions).explain({ analyze: true });

    expect(explain).toHaveBeenCalledWith({ analyze: true });
    expect(result.metrics).toBe(ANALYZE_METRICS);
    expect(result.documents).toEqual([{ name: 'nearest', id: 'doc-1' }]);
  });

  it('U-2v: vector plan-only (snapshot null) → documents: null', async () => {
    const { builder } = createMockCoreBuilder(() => ({
      get: jest.fn().mockResolvedValue({ docs: [] }),
      explain: jest.fn(async () => ({
        metrics: PLAN_METRICS,
        snapshot: null,
      })),
    }));
    const vectorBuilder = new VectorQueryBuilder(builder);

    const result = await vectorBuilder.findNearest(findNearestOptions).explain();
    expect(result.documents).toBeNull();
  });

  it('U-3v: vector analyze empty docs → documents: []', async () => {
    const { builder } = createMockCoreBuilder(() => ({
      get: jest.fn().mockResolvedValue({ docs: [] }),
      explain: jest.fn(async () => ({
        metrics: ANALYZE_METRICS,
        snapshot: { docs: [] },
      })),
    }));
    const vectorBuilder = new VectorQueryBuilder(builder);

    const result = await vectorBuilder.findNearest(findNearestOptions).explain({ analyze: true });
    expect(result.documents).toEqual([]);
    expect(result.documents).not.toBeNull();
  });

  it('U-9: explain missing on mocked findNearest result → capability Error', async () => {
    // Deliberate stub without explain — defense-in-depth for D6 (unreachable via real SDKs that
    // pass assertVectorSearchSupported, but hit by a deliberate mock).
    const { builder } = createMockCoreBuilder(() => ({
      get: jest.fn().mockResolvedValue({ docs: [] }),
      // no explain property
    }));
    const vectorBuilder = new VectorQueryBuilder(builder);

    await expect(vectorBuilder.findNearest(findNearestOptions).explain()).rejects.toThrow(
      /explain\(\) is not available on this VectorQuery.*Upgrade/i,
    );
  });

  it('U-5v: vector SDK throw → parseFirestoreError path (coded error becomes NotFoundError)', async () => {
    const { builder } = createMockCoreBuilder(() => ({
      get: jest.fn().mockResolvedValue({ docs: [] }),
      explain: jest.fn(async () => {
        throw { code: 5, message: 'No explain results' };
      }),
    }));
    const vectorBuilder = new VectorQueryBuilder(builder);

    await expect(vectorBuilder.findNearest(findNearestOptions).explain()).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});
