/**
 * Strategy: emulator integration tests for QueryBuilder pagination and query helpers.
 * Verifies paginate, offsetPaginate, exists, distinctValues, getOne, and query delete.
 */
import { createTestUserInput } from '../shared/factories/user.factory.js';
import { resetTestFactoryCounters } from '../shared/factories/counters.js';
import { createUserRepoHarness } from './helpers/firestoreIntegrationHarness.js';

type CatalogUser = {
  id: string;
  name: string;
  category: string;
  sortKey: number;
  active: boolean;
};

describe('FirestoreRepository QueryBuilder', () => {
  const harness = createUserRepoHarness('test_users_query_builder');
  const { userRepo, trackUser, cleanupTrackedUsers, cleanupCollection } = harness;

  beforeEach(() => {
    resetTestFactoryCounters();
  });

  afterEach(async () => {
    await cleanupTrackedUsers();
  });

  afterAll(async () => {
    await cleanupCollection();
  });

  async function seedCatalog(): Promise<CatalogUser[]> {
    const items = await userRepo.bulkCreate([
      { name: 'A', category: 'books', sortKey: 1, active: true },
      { name: 'B', category: 'books', sortKey: 2, active: true },
      { name: 'C', category: 'games', sortKey: 3, active: false },
      { name: 'D', category: 'games', sortKey: 4, active: true },
    ] as any[]);
    items.forEach(item => trackUser(item.id));
    return items as CatalogUser[];
  }

  it('should paginate with cursor when orderBy is provided', async () => {
    await seedCatalog();

    const firstPage = await userRepo.query().orderBy('sortKey', 'asc').paginate(2);

    expect(firstPage.items).toHaveLength(2);
    expect(firstPage.hasMore).toBe(true);
    expect(firstPage.nextCursor).toBeTruthy();

    const secondPage = await userRepo
      .query()
      .orderBy('sortKey', 'asc')
      .paginate(2, firstPage.nextCursor);

    expect(secondPage.items.length).toBeGreaterThanOrEqual(1);
  });

  it('should offset paginate with totals', async () => {
    await seedCatalog();

    const page = await userRepo.query().orderBy('sortKey', 'asc').offsetPaginate(1, 2);

    expect(page.page).toBe(1);
    expect(page.pageSize).toBe(2);
    expect(page.items).toHaveLength(2);
    expect(page.total).toBeGreaterThanOrEqual(4);
    expect(page.totalPages).toBeGreaterThanOrEqual(2);
  });

  it('should paginate with count metadata', async () => {
    await seedCatalog();

    const result = await userRepo.query().orderBy('sortKey', 'asc').paginateWithCount(2);

    expect(result.items).toHaveLength(2);
    expect(result.total).toBeGreaterThanOrEqual(4);
    expect(result.hasMore).toBe(true);
  });

  it('should report exists true or false for matching queries', async () => {
    await seedCatalog();

    const hasActive = await userRepo.query().where('active', '==', true).exists();
    const hasMissing = await userRepo.query().where('name', '==', 'no-such-user').exists();

    expect(hasActive).toBe(true);
    expect(hasMissing).toBe(false);
  });

  it('should return distinct field values', async () => {
    await seedCatalog();

    const categories = await userRepo.query().distinctValues('category' as any);
    expect(categories.sort()).toEqual(['books', 'games']);
  });

  it('should return getOne for first match', async () => {
    await seedCatalog();

    const one = await userRepo.query().where('category', '==', 'books').orderBy('sortKey').getOne();
    expect(one?.category).toBe('books');
  });

  it('should delete all matching documents via query().delete()', async () => {
    await seedCatalog();

    const deleted = await userRepo.query().where('active', '==', false).delete();
    expect(deleted).toBe(1);

    const remainingInactive = await userRepo.query().where('active', '==', false).get();
    expect(remainingInactive).toHaveLength(0);
  });
});
