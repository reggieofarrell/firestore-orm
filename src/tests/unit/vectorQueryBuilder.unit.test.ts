/**
 * Strategy: unit tests for VectorQueryBuilder guards and delegation using mocked Firestore queries.
 */
import { NotFoundError } from '../../core/Errors.js';
import { FirestoreQueryBuilder } from '../../core/QueryBuilder.js';
import { VectorQueryBuilder } from '../../vector/VectorQueryBuilder.js';

function createMockCoreBuilder(findNearestImpl?: () => unknown) {
  const query = {
    where: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    findNearest: jest.fn().mockImplementation(
      findNearestImpl ??
        (() => ({
          get: jest.fn().mockResolvedValue({
            docs: [
              {
                id: 'doc-1',
                data: () => ({ name: 'nearest' }),
              },
            ],
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

describe('VectorQueryBuilder', () => {
  const findNearestOptions = {
    vectorField: 'embedding',
    queryVector: [1, 0, 0],
    limit: 1,
    distanceMeasure: 'EUCLIDEAN' as const,
  };

  it('should delegate where() to the core builder before findNearest()', () => {
    const { builder, query } = createMockCoreBuilder();
    const vectorBuilder = new VectorQueryBuilder(builder);

    vectorBuilder.where('status', '==', 'published');

    expect(query.where).toHaveBeenCalledWith('status', '==', 'published');
  });

  it('should execute findNearest().get() and map document results', async () => {
    const { builder } = createMockCoreBuilder();
    const vectorBuilder = new VectorQueryBuilder(builder);

    const results = await vectorBuilder.findNearest(findNearestOptions).get();

    expect(results).toEqual([{ name: 'nearest', id: 'doc-1' }]);
  });

  it('should forward distanceResultField and distanceThreshold to findNearest', () => {
    const { builder, query } = createMockCoreBuilder();
    const vectorBuilder = new VectorQueryBuilder(builder);

    vectorBuilder.findNearest({
      ...findNearestOptions,
      distanceResultField: 'vectorDistance',
      distanceThreshold: 0.75,
    });

    expect(query.findNearest).toHaveBeenCalledWith(
      expect.objectContaining({
        distanceResultField: 'vectorDistance',
        distanceThreshold: 0.75,
      }),
    );
  });

  it('should throw when get() is called before findNearest()', async () => {
    const { builder } = createMockCoreBuilder();
    const vectorBuilder = new VectorQueryBuilder(builder);

    await expect(vectorBuilder.get()).rejects.toThrow(/requires findNearest\(\)/i);
  });

  it('should throw when findNearest() is called twice', () => {
    const { builder } = createMockCoreBuilder();
    const vectorBuilder = new VectorQueryBuilder(builder).findNearest(findNearestOptions);

    expect(() => vectorBuilder.findNearest(findNearestOptions)).toThrow(/only be called once/i);
  });

  it('should parse Firestore errors from get()', async () => {
    const firestoreError = { code: 5, message: 'No document to update' };
    const { builder } = createMockCoreBuilder(() => ({
      get: jest.fn().mockRejectedValue(firestoreError),
    }));
    const vectorBuilder = new VectorQueryBuilder(builder);

    await expect(vectorBuilder.findNearest(findNearestOptions).get()).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('should throw when where() is called after findNearest()', () => {
    const { builder } = createMockCoreBuilder();
    const vectorBuilder = new VectorQueryBuilder(builder).findNearest(findNearestOptions);

    expect(() => vectorBuilder.where('status', '==', 'published')).toThrow(
      /cannot be called after findNearest/i,
    );
  });

  it('should throw when orderBy() is called before findNearest()', () => {
    const { builder } = createMockCoreBuilder();
    const vectorBuilder = new VectorQueryBuilder(builder);

    expect(() => vectorBuilder.orderBy()).toThrow(
      /orderBy\(\) is not supported on VectorQueryBuilder/i,
    );
  });

  it('should throw when orderBy() is called after findNearest()', () => {
    const { builder } = createMockCoreBuilder();
    const vectorBuilder = new VectorQueryBuilder(builder).findNearest(findNearestOptions);

    expect(() => vectorBuilder.orderBy()).toThrow(
      /orderBy\(\) is not supported on vector queries/i,
    );
  });

  it('should throw when select() is called after findNearest()', () => {
    const { builder } = createMockCoreBuilder();
    const vectorBuilder = new VectorQueryBuilder(builder).findNearest(findNearestOptions);

    expect(() => vectorBuilder.select('name')).toThrow(/cannot be called after findNearest/i);
  });

  it('should reject onSnapshot() before and after findNearest()', async () => {
    const { builder } = createMockCoreBuilder();
    const beforeVector = new VectorQueryBuilder(builder);
    await expect(beforeVector.onSnapshot()).rejects.toThrow(
      /onSnapshot\(\) is not supported on vector queries/i,
    );

    const afterVector = new VectorQueryBuilder(builder).findNearest(findNearestOptions);
    await expect(afterVector.onSnapshot()).rejects.toThrow(
      /onSnapshot\(\) is not supported on vector queries/i,
    );
  });

  it('should reject stream() before and after findNearest()', () => {
    const { builder } = createMockCoreBuilder();
    const beforeVector = new VectorQueryBuilder(builder);
    expect(() => beforeVector.stream()).toThrow(/stream\(\) is not supported on vector queries/i);

    const afterVector = new VectorQueryBuilder(builder).findNearest(findNearestOptions);
    expect(() => afterVector.stream()).toThrow(/stream\(\) is not supported on vector queries/i);
  });

  it('should return the first result from getOne()', async () => {
    const { builder } = createMockCoreBuilder();
    const vectorBuilder = new VectorQueryBuilder(builder);

    const result = await vectorBuilder
      .findNearest({
        ...findNearestOptions,
        limit: 3,
      })
      .getOne();

    expect(result).toEqual({ name: 'nearest', id: 'doc-1' });
  });

  it('should return null from getOne() when no documents match', async () => {
    const { builder } = createMockCoreBuilder(() => ({
      get: jest.fn().mockResolvedValue({ docs: [] }),
    }));
    const vectorBuilder = new VectorQueryBuilder(builder);

    const result = await vectorBuilder.findNearest(findNearestOptions).getOne();

    expect(result).toBeNull();
  });

  it('should reject invalid findNearest options at configuration time', () => {
    const { builder } = createMockCoreBuilder();
    const vectorBuilder = new VectorQueryBuilder(builder);

    expect(() =>
      vectorBuilder.findNearest({
        ...findNearestOptions,
        queryVector: [],
      }),
    ).toThrow(/non-empty number array/i);
  });
});
