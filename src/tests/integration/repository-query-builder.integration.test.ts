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
    const items = await userRepo.bulkCreate(
      [
        { name: 'A', category: 'books', sortKey: 1, active: true },
        { name: 'B', category: 'books', sortKey: 2, active: true },
        { name: 'C', category: 'games', sortKey: 3, active: false },
        { name: 'D', category: 'games', sortKey: 4, active: true },
      ] as any[],
      { returnDoc: true },
    );
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

  it('distinctValues preserves a stored null but drops an absent (undefined) field', async () => {
    // Seed three docs: a real value, an explicit stored null, and one where the field is absent.
    const created = await userRepo.bulkCreate(
      [
        { name: 'has-value', tier: 'gold' },
        { name: 'explicit-null', tier: null },
        { name: 'absent-field' }, // `tier` omitted -> the field does not exist on the document
      ] as any[],
      { returnDoc: true },
    );
    created.forEach(item => trackUser(item.id));

    const tiers = await userRepo.query().distinctValues('tier' as any);

    // `null` is a genuine, stored, distinct value and must survive dedup; only `undefined` (the
    // absent field) is dropped. The old loose `!= undefined` filter also stripped `null` (because
    // `null == undefined`), collapsing this set to just ['gold'] — this asserts against that (B9).
    expect(tiers).toContain('gold');
    expect(tiers).toContain(null);
    expect(tiers).not.toContain(undefined);
    expect(tiers).toHaveLength(2);
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

  it('should stream all matching documents via async generator', async () => {
    const seeded = await seedCatalog();

    const streamed: CatalogUser[] = [];
    for await (const item of userRepo.query().orderBy('sortKey', 'asc').stream()) {
      streamed.push(item as CatalogUser);
    }

    expect(streamed.length).toBeGreaterThanOrEqual(seeded.length);
    expect(streamed.map(item => item.sortKey).sort()).toEqual(
      seeded.map(item => item.sortKey).sort(),
    );
  });

  it('should subscribe to query snapshots and receive updates', async () => {
    const created = await userRepo.create({
      name: 'Snapshot User',
      category: 'live',
      sortKey: 99,
      active: true,
    } as any);
    trackUser(created.id);

    const emissions: unknown[] = [];

    const unsubscribe = await userRepo
      .query()
      .where('name', '==', 'Snapshot User')
      .onSnapshot(items => {
        emissions.push(items);
      });

    await new Promise(resolve => setTimeout(resolve, 500));

    await userRepo.update(created.id, { active: false } as any);

    await new Promise(resolve => setTimeout(resolve, 500));

    unsubscribe();

    expect(emissions.length).toBeGreaterThanOrEqual(1);
    const latest = emissions[emissions.length - 1] as CatalogUser[];
    expect(latest.some(item => item.id === created.id && item.active === false)).toBe(true);
  });

  it('should reject paginate without orderBy', async () => {
    await seedCatalog();

    await expect(userRepo.query().paginate(2)).rejects.toThrow('orderBy');
  });

  it('should reject paginate/offsetPaginate with non-positive, non-integer, or non-finite inputs', async () => {
    await expect(userRepo.query().orderBy('sortKey').paginate(0)).rejects.toThrow('pageSize');
    await expect(userRepo.query().orderBy('sortKey').paginate(-1)).rejects.toThrow('pageSize');
    await expect(userRepo.query().orderBy('sortKey').paginate(1.5)).rejects.toThrow('pageSize');
    await expect(userRepo.query().orderBy('sortKey').paginate(Number.NaN)).rejects.toThrow(
      'pageSize',
    );
    await expect(
      userRepo.query().orderBy('sortKey').paginate(Number.POSITIVE_INFINITY),
    ).rejects.toThrow('pageSize');

    // offsetPaginate previously performed no validation at all.
    await expect(userRepo.query().offsetPaginate(0, 10)).rejects.toThrow('page');
    await expect(userRepo.query().offsetPaginate(1, 0)).rejects.toThrow('pageSize');
    await expect(userRepo.query().offsetPaginate(-2, 10)).rejects.toThrow('page');
    await expect(userRepo.query().offsetPaginate(1.5, 10)).rejects.toThrow('page');
  });

  it('should reject paginate when cursor document was deleted', async () => {
    await seedCatalog();
    const firstPage = await userRepo.query().orderBy('sortKey', 'asc').paginate(1);
    const cursorDocId = firstPage.items[0].id;

    await userRepo.delete(cursorDocId);

    await expect(
      userRepo.query().orderBy('sortKey', 'asc').paginate(1, firstPage.nextCursor),
    ).rejects.toThrow(/cursor no longer points/i);
  });

  it('should reject a cursor bound to a different collection', async () => {
    await seedCatalog();
    // Forge a cursor whose document path points at another collection.
    const foreignCursor = Buffer.from(
      JSON.stringify({ path: 'some_other_collection/forged-doc' }),
    ).toString('base64url');

    await expect(
      userRepo.query().orderBy('sortKey', 'asc').paginate(1, foreignCursor),
    ).rejects.toThrow(/cursor for this collection/i);
  });

  it('should reject a malformed cursor without echoing its contents', async () => {
    await seedCatalog();
    await expect(
      userRepo.query().orderBy('sortKey', 'asc').paginate(1, 'not-a-valid-cursor'),
    ).rejects.toThrow(/invalid pagination cursor/i);
  });

  it('should select a subset of fields in query results', async () => {
    await userRepo.create({
      name: 'Select User',
      category: 'books',
      sortKey: 1,
      active: true,
    } as any);

    const rows = await userRepo.query().select('name').get();
    const match = rows.find(row => row.name === 'Select User');

    expect(match).toBeDefined();
    expect(match).toEqual(expect.objectContaining({ name: 'Select User', id: expect.any(String) }));
  });

  it('select() is immutable: the original builder alias still returns full documents', async () => {
    await userRepo.create({
      name: 'Alias User',
      category: 'books',
      sortKey: 42,
      active: true,
    } as any);

    const builder = userRepo.query().where('name', '==', 'Alias User');
    // Capturing the projection must not project the original builder.
    const projected = builder.select('name');

    const full = await builder.get();
    const projectedRows = await projected.get();

    // Original alias returns the full document (category/sortKey present at runtime).
    expect(full[0]).toEqual(
      expect.objectContaining({ name: 'Alias User', category: 'books', sortKey: 42 }),
    );
    // Projected builder returns only the selected field (+ id).
    expect((projectedRows[0] as Record<string, unknown>).category).toBeUndefined();
    expect(projectedRows[0]).toEqual(
      expect.objectContaining({ name: 'Alias User', id: expect.any(String) }),
    );
  });

  it('onSnapshot() after select() is rejected locally', async () => {
    await expect(
      userRepo
        .query()
        .select('name')
        .onSnapshot(() => {}),
    ).rejects.toThrow(/not supported after select/i);
  });

  it('should filter with in and array-contains operators', async () => {
    await userRepo.bulkCreate([
      { name: 'In 1', category: 'books', sortKey: 1, active: true, tags: ['featured'] },
      { name: 'In 2', category: 'games', sortKey: 2, active: true, tags: ['sale'] },
    ] as any[]);

    const inResults = await userRepo.query().where('category', 'in', ['books', 'games']).get();

    expect(inResults.length).toBeGreaterThanOrEqual(2);

    const tagged = await userRepo.query().where('tags', 'array-contains', 'featured').get();

    expect(tagged.some(row => row.name === 'In 1')).toBe(true);
  });

  it('should return count for filtered queries', async () => {
    await seedCatalog();

    const activeCount = await userRepo.query().where('active', '==', true).count();
    expect(activeCount).toBeGreaterThanOrEqual(3);
  });
});
