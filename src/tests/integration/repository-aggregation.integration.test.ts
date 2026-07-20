import {
  cleanupValidatedRepo,
  createUserRepoHarness,
  createValidatedRepo,
  HookValidatedUser,
} from './helpers/firestoreIntegrationHarness.js';

describe('FirestoreRepository aggregation query behavior', () => {
  const harness = createUserRepoHarness('test_users_aggregation');
  const { db, cleanupCollection } = harness;

  afterAll(async () => {
    await cleanupCollection();
  });

  /**
   * Creates a validated test user with deterministic aggregate fields.
   *
   * @param repo - Validated repository instance used for test writes
   * @param name - Human-readable identifier for test isolation
   * @param score - Numeric value used by sum/average assertions
   * @returns The newly created persisted document metadata
   */
  const createAggregateUser = async (
    repo: ReturnType<typeof createValidatedRepo>,
    name: string,
    score: number,
  ) => {
    return repo.create(
      {
        name,
        score,
        createdAt: new Date().toISOString(),
      } as HookValidatedUser,
      { returnDoc: true },
    );
  };

  it('should calculate sum and average using query filters', async () => {
    const repo = createValidatedRepo(db);

    try {
      await createAggregateUser(repo, 'Aggregation Included 1', 10);
      await createAggregateUser(repo, 'Aggregation Included 2', 20);
      await createAggregateUser(repo, 'Aggregation Excluded', 999);

      const baseQuery = repo
        .query()
        .where('name', 'in', ['Aggregation Included 1', 'Aggregation Included 2']);

      expect(await baseQuery.count()).toBe(2);
      expect(await baseQuery.sum('score')).toBe(30);
      expect(await baseQuery.average('score')).toBe(15);
    } finally {
      await cleanupValidatedRepo(repo);
    }
  });

  it('should return 0 for empty sum and average results', async () => {
    const repo = createValidatedRepo(db);

    try {
      const emptyQuery = repo.query().where('name', '==', 'No matching documents');
      expect(await emptyQuery.count()).toBe(0);
      expect(await emptyQuery.sum('score')).toBe(0);
      expect(await emptyQuery.average('score')).toBe(0);
    } finally {
      await cleanupValidatedRepo(repo);
    }
  });

  it('should keep count, sum, average, and totalCount semantics consistent', async () => {
    const repo = createValidatedRepo(db);

    try {
      const first = await createAggregateUser(repo, 'Aggregation Total 1', 10);
      const second = await createAggregateUser(repo, 'Aggregation Total 2', 20);
      const third = await createAggregateUser(repo, 'Aggregation Total 3', 40);

      expect(await repo.query().count()).toBe(3);
      expect(await repo.query().sum('score')).toBe(70);
      expect(await repo.query().average('score')).toBeCloseTo(70 / 3);

      // totalCount() ignores user where clauses and always counts the base collection.
      expect(await repo.query().where('name', '==', first.name).totalCount()).toBe(3);
      expect(await repo.query().where('name', '==', second.name).totalCount()).toBe(3);
      expect(await repo.query().where('name', '==', third.name).totalCount()).toBe(3);
    } finally {
      await cleanupValidatedRepo(repo);
    }
  });
});
