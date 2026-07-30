/**
 * Strategy: unit-test Query Explain (`explain()` / `explainStream()`) success paths and local
 * guards at the Firestore boundary (issue #37 / ADR-0031; issue #65 / ADR-0036). Mocks own the
 * happy path for `explain()` because the emulator always throws `No explain results` (D4).
 * `explainStream` mocks own document+metrics chunk mapping; emulator integration pins docs-without-
 * metrics (P2 / T3).
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
 *  - Stream U-1: options forwarded; document data/id mapping; metrics-only chunk identity (T1/T3/T4).
 *  - Stream U-2: group maps id/path/parentPath (T1).
 *  - Stream U-3a/U-3b: missing method upgrade hint; coded async error → NotFoundError (T5).
 */
import { FirestoreCollectionGroupQueryBuilder } from '../../core/CollectionGroup.js';
import { NotFoundError } from '../../core/Errors.js';
import { FirestoreQueryBuilder } from '../../core/QueryBuilder.js';
import * as ErrorParser from '../../core/ErrorParser.js';
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

function makeCollectionBuilder(opts: {
  explainImpl?: jest.Mock;
  omitExplain?: boolean;
  explainStreamImpl?: jest.Mock;
  omitExplainStream?: boolean;
}) {
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
  // explainStream is optional — omit for capability-guard tests (U-3a); otherwise default to an
  // empty async generator so unrelated suites do not accidentally call an undefined method.
  let explainStream: jest.Mock | undefined;
  if (!opts.omitExplainStream) {
    explainStream =
      opts.explainStreamImpl ??
      jest.fn(async function* () {
        // empty stream — callers that need chunks pass explainStreamImpl
      });
    query.explainStream = explainStream;
  }
  const builder = new FirestoreQueryBuilder(
    query as any,
    {} as any,
    {} as any,
    async () => {},
    async () => {},
  );
  return { builder, query, explain, explainStream };
}

function makeGroupBuilder(opts: {
  explainImpl?: jest.Mock;
  explainStreamImpl?: jest.Mock;
  omitExplainStream?: boolean;
}) {
  const explain =
    opts.explainImpl ??
    jest.fn(async () => ({
      metrics: PLAN_METRICS,
      snapshot: null,
    }));
  const query: Record<string, unknown> = {
    explain,
    get: jest.fn(async () => ({ docs: [] })),
  };
  let explainStream: jest.Mock | undefined;
  if (!opts.omitExplainStream) {
    explainStream =
      opts.explainStreamImpl ??
      jest.fn(async function* () {
        // empty by default
      });
    query.explainStream = explainStream;
  }
  const builder = new FirestoreCollectionGroupQueryBuilder(query as any, 'posts', {} as any);
  return { builder, query, explain, explainStream };
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

describe('Query explainStream() — Core (issue #65)', () => {
  it('U-1: forwards options; maps document data/id; preserves metrics-only chunk identity', async () => {
    // Mock owns a document chunk AND a separate metrics-only chunk (T3) — emulator never emits
    // metrics, so unit tests are the only place that pins metrics forwarding.
    const metricsChunk = { metrics: ANALYZE_METRICS };
    const explainStream = jest.fn(async function* () {
      yield { document: doc('u1', { name: 'Ada' }) };
      yield metricsChunk;
    });
    const { builder } = makeCollectionBuilder({ explainStreamImpl: explainStream });

    const chunks: Array<{ document?: unknown; metrics?: unknown }> = [];
    for await (const chunk of builder.explainStream({ analyze: true })) {
      chunks.push(chunk);
    }

    expect(explainStream).toHaveBeenCalledWith({ analyze: true });
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toEqual({ document: { name: 'Ada', id: 'u1' } });
    // Metrics-only chunk: same object identity, no explicit undefined document field (T1/T4).
    expect(chunks[1]).toEqual({ metrics: ANALYZE_METRICS });
    expect(chunks[1].metrics).toBe(ANALYZE_METRICS);
    expect(Object.prototype.hasOwnProperty.call(chunks[1], 'document')).toBe(false);
  });

  it('U-2: collection-group maps id/path/parentPath via toResult', async () => {
    const explainStream = jest.fn(async function* () {
      yield {
        document: doc(
          'p1',
          { title: 'Hello' },
          { path: 'users/u1/posts/p1', parentPath: 'users/u1/posts' },
        ),
      };
    });
    const { builder } = makeGroupBuilder({ explainStreamImpl: explainStream });

    const chunks: Array<{ document?: unknown }> = [];
    for await (const chunk of builder.explainStream({ analyze: true })) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(1);
    expect(chunks[0].document).toEqual({
      title: 'Hello',
      id: 'p1',
      path: 'users/u1/posts/p1',
      parentPath: 'users/u1/posts',
    });
  });

  it('U-3a: missing query.explainStream → local capability Error mentioning upgrade', async () => {
    const { builder } = makeCollectionBuilder({ omitExplainStream: true });

    const iterate = async () => {
      for await (const _chunk of builder.explainStream()) {
        // drain
      }
    };

    await expect(iterate()).rejects.toThrow(
      /explainStream\(\) is not available:.*@google-cloud\/firestore >= 7\.4.*Upgrade/i,
    );
  });

  it('U-3a-placement: capability guard does not call parseFirestoreError (outside try)', async () => {
    // Falsifies moving the capability check inside try: parseFirestoreError preserves plain Errors, so
    // message-only assertions would still pass — spy proves the parser is never touched (F2).
    const rewrite = jest
      .spyOn(ErrorParser, 'parseFirestoreError')
      .mockImplementation(() => new Error('REWRITTEN_BY_PARSER'));
    const { builder } = makeCollectionBuilder({ omitExplainStream: true });

    const iterate = async () => {
      for await (const _chunk of builder.explainStream()) {
        // drain
      }
    };

    await expect(iterate()).rejects.toThrow(/explainStream\(\) is not available.*Upgrade/i);
    expect(rewrite).not.toHaveBeenCalled();
    rewrite.mockRestore();
  });

  it('U-3b: coded async SDK error becomes NotFoundError via parseFirestoreError', async () => {
    // Throwing from inside the async generator (after the native call returns) exercises the
    // for-await catch path — same coded-error → NotFoundError proof as explain() U-5.
    const explainStream = jest.fn(async function* () {
      yield { document: doc('u1', { name: 'Ada' }) };
      throw { code: 5, message: 'stream failed' };
    });
    const { builder } = makeCollectionBuilder({ explainStreamImpl: explainStream });

    const iterate = async () => {
      for await (const _chunk of builder.explainStream({ analyze: true })) {
        // drain until throw
      }
    };

    await expect(iterate()).rejects.toBeInstanceOf(NotFoundError);
  });
});
