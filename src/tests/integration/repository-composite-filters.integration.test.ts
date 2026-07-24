/**
 * Strategy: emulator integration tests for `query().whereFilter(f => …)` — composite (nested
 * AND / OR) filters (issue #30). Emulator-backed because the whole point is that a disjunction
 * really is evaluated by Firestore, which mocks cannot prove.
 *
 * Verification points:
 *  - A disjunction returns the UNION of its branches, and a nested `f.and(...)` inside `f.or(...)`
 *    narrows only that branch.
 *  - `f.whereId(...)` inside a composite is a real document-name filter and keeps the validated id
 *    boundary (InvalidDocumentIdError before any I/O).
 *  - A composite is AND-ed with chained `where()` clauses, and composes with `select()`, `count()`,
 *    `orderBy`/`paginate`, `stream()`, and the `update()` / `delete()` terminals.
 *  - An EMPTY group is rejected locally. Firestore silently DROPS an empty composite filter
 *    (`Query.where()` returns the query unchanged), which would broaden the query to the entire
 *    collection — the ORM must never let that happen silently.
 *  - A prebuilt Admin SDK `Filter` is accepted verbatim (documented escape hatch); a non-filter
 *    return value is rejected with a clear error rather than being treated as a field path.
 *  - Regression: `select()` carries the repository's `allowLegacyDatastoreIds` policy into the
 *    replacement builder, so a post-projection id filter still honors the opt-in.
 */
import { Filter } from 'firebase-admin/firestore';
import { FirestoreRepository } from '../../core/FirestoreRepository.js';
import { InvalidDocumentIdError } from '../../core/Errors.js';
import { resetTestFactoryCounters } from '../shared/factories/counters.js';
import { createUserRepoHarness } from './helpers/firestoreIntegrationHarness.js';

type Post = {
  id: string;
  name: string;
  status: string;
  authorId: string;
  visibility: string;
  views: number;
};

describe('FirestoreQueryBuilder whereFilter (composite AND/OR)', () => {
  const harness = createUserRepoHarness('test_users_composite_filters');
  const { db, userRepo, trackUser, cleanupTrackedUsers, cleanupCollection } = harness;

  beforeEach(() => {
    resetTestFactoryCounters();
  });

  afterEach(async () => {
    await cleanupTrackedUsers();
  });

  afterAll(async () => {
    await cleanupCollection();
  });

  /**
   * Seeds four documents spanning the status/author/visibility combinations the disjunction cases
   * assert over. Returns them keyed by `name` for readable expectations.
   */
  async function seedPosts(): Promise<Record<string, Post>> {
    const created = await userRepo.bulkCreate(
      [
        {
          name: 'published-u1-public',
          status: 'published',
          authorId: 'u1',
          visibility: 'public',
          views: 10,
        },
        {
          name: 'draft-u1-private',
          status: 'draft',
          authorId: 'u1',
          visibility: 'private',
          views: 20,
        },
        {
          name: 'draft-u2-public',
          status: 'draft',
          authorId: 'u2',
          visibility: 'public',
          views: 30,
        },
        {
          name: 'archived-u3-private',
          status: 'archived',
          authorId: 'u3',
          visibility: 'private',
          views: 40,
        },
      ] as any[],
      { returnDoc: true },
    );
    const posts = created as unknown as Post[];
    posts.forEach(post => trackUser(post.id));
    return Object.fromEntries(posts.map(post => [post.name, post]));
  }

  const names = (rows: { name?: string }[]) => rows.map(row => row.name).sort();

  it('returns the union of an OR across two fields', async () => {
    await seedPosts();

    const rows = await userRepo
      .query()
      .whereFilter(f => f.or(f.where('status', '==', 'published'), f.where('authorId', '==', 'u2')))
      .get();

    expect(names(rows)).toEqual(['draft-u2-public', 'published-u1-public']);
  });

  it('narrows a single branch with a nested AND inside an OR', async () => {
    await seedPosts();

    const rows = await userRepo
      .query()
      .whereFilter(f =>
        f.or(
          f.where('status', '==', 'published'),
          f.and(f.where('authorId', '==', 'u1'), f.where('visibility', '==', 'private')),
        ),
      )
      .get();

    // published-u1-public matches the first branch; draft-u1-private matches the nested AND.
    // draft-u2-public is excluded (wrong author) and archived-u3-private (private but wrong author).
    expect(names(rows)).toEqual(['draft-u1-private', 'published-u1-public']);
  });

  it('supports a validated document-name filter inside a composite', async () => {
    const posts = await seedPosts();

    const rows = await userRepo
      .query()
      .whereFilter(f =>
        f.or(
          f.where('status', '==', 'published'),
          f.whereId('==', posts['archived-u3-private'].id),
        ),
      )
      .get();

    expect(names(rows)).toEqual(['archived-u3-private', 'published-u1-public']);

    const inRows = await userRepo
      .query()
      .whereFilter(f =>
        f.whereId('in', [posts['draft-u1-private'].id, posts['draft-u2-public'].id]),
      )
      .get();

    expect(names(inRows)).toEqual(['draft-u1-private', 'draft-u2-public']);
  });

  it('rejects a malformed id inside a composite before any I/O', async () => {
    expect(() =>
      userRepo.query().whereFilter(f => f.or(f.whereId('==', 'bad/id'), f.whereId('==', 'ok'))),
    ).toThrow(InvalidDocumentIdError);
  });

  it('AND-s a composite with chained where() clauses', async () => {
    await seedPosts();

    const rows = await userRepo
      .query()
      .where('visibility', '==', 'private')
      .whereFilter(f => f.or(f.where('status', '==', 'draft'), f.where('status', '==', 'archived')))
      .get();

    expect(names(rows)).toEqual(['archived-u3-private', 'draft-u1-private']);
  });

  it('composes with count() and sum() aggregations', async () => {
    await seedPosts();

    const builder = () =>
      userRepo
        .query()
        .whereFilter(f =>
          f.or(f.where('status', '==', 'draft'), f.where('status', '==', 'archived')),
        );

    expect(await builder().count()).toBe(3);
    expect(await builder().sum('views')).toBe(90);
  });

  it('composes with select() in both orders', async () => {
    await seedPosts();

    const projectedAfter = await userRepo
      .query()
      .whereFilter(f => f.or(f.where('status', '==', 'published'), f.where('authorId', '==', 'u2')))
      .select('name')
      .get();

    expect(names(projectedAfter)).toEqual(['draft-u2-public', 'published-u1-public']);
    expect((projectedAfter[0] as Record<string, unknown>).status).toBeUndefined();

    // Filtering AFTER the projection must apply to the projected builder too.
    const projectedBefore = await userRepo
      .query()
      .select('name')
      .whereFilter(f => f.or(f.where('name', '==', 'draft-u2-public')))
      .get();

    expect(names(projectedBefore)).toEqual(['draft-u2-public']);
  });

  it('composes with orderBy + cursor pagination', async () => {
    await seedPosts();

    const page = () =>
      userRepo
        .query()
        .whereFilter(f =>
          f.or(f.where('status', '==', 'draft'), f.where('status', '==', 'archived')),
        )
        .orderBy('views', 'asc');

    const first = await page().paginate(2);
    expect(names(first.items)).toEqual(['draft-u1-private', 'draft-u2-public']);
    expect(first.hasMore).toBe(true);

    const second = await page().paginate(2, first.nextCursor);
    expect(names(second.items)).toEqual(['archived-u3-private']);
    expect(second.hasMore).toBe(false);
  });

  it('composes with orderBy + limit', async () => {
    await seedPosts();

    const rows = await userRepo
      .query()
      .whereFilter(f => f.or(f.where('status', '==', 'draft'), f.where('status', '==', 'archived')))
      .orderBy('views', 'desc')
      .limit(2)
      .get();

    expect(names(rows)).toEqual(['archived-u3-private', 'draft-u2-public']);
  });

  it('composes with stream()', async () => {
    await seedPosts();

    const streamed: string[] = [];
    for await (const row of userRepo
      .query()
      .whereFilter(f => f.or(f.where('status', '==', 'published'), f.where('authorId', '==', 'u2')))
      .stream()) {
      streamed.push((row as unknown as Post).name);
    }

    expect(streamed.sort()).toEqual(['draft-u2-public', 'published-u1-public']);
  });

  it('composes with the update() terminal', async () => {
    await seedPosts();

    const updated = await userRepo
      .query()
      .whereFilter(f => f.or(f.where('status', '==', 'draft'), f.where('status', '==', 'archived')))
      .update({ visibility: 'internal' } as any);

    expect(updated).toBe(3);

    const internal = await userRepo.query().where('visibility', '==', 'internal').get();
    expect(names(internal)).toEqual(['archived-u3-private', 'draft-u1-private', 'draft-u2-public']);
  });

  it('composes with the delete() terminal', async () => {
    await seedPosts();

    const deleted = await userRepo
      .query()
      .whereFilter(f => f.or(f.where('status', '==', 'draft'), f.where('status', '==', 'archived')))
      .delete();

    expect(deleted).toBe(3);

    const remaining = await userRepo.query().get();
    expect(names(remaining)).toEqual(['published-u1-public']);
  });

  it('rejects an empty or() group instead of silently matching the whole collection', async () => {
    await seedPosts();

    expect(() => userRepo.query().whereFilter(f => f.or())).toThrow(
      /f\.or\(\) requires at least one filter/,
    );
    expect(() => userRepo.query().whereFilter(f => f.and())).toThrow(
      /f\.and\(\) requires at least one filter/,
    );

    // Prove the guard is load-bearing rather than defensive noise: the raw SDK equivalent silently
    // drops the empty filter and matches EVERY document in the collection. If a future SDK starts
    // rejecting empty composites itself, this assertion fails and the guard can be revisited.
    const collectionSize = await userRepo.query().collectionCount();
    const unguarded = await userRepo.query().getUnderlyingQuery().where(Filter.or()).get();
    expect(collectionSize).toBeGreaterThan(0);
    expect(unguarded.size).toBe(collectionSize);
  });

  it('rejects a prebuilt filter that reduces to no conditions', async () => {
    expect(() => userRepo.query().whereFilter(() => Filter.or())).toThrow(
      /no conditions, which Firestore silently drops/,
    );
  });

  it('rejects a callback that does not return a filter', async () => {
    expect(() => userRepo.query().whereFilter(() => undefined as any)).toThrow(
      /must return a filter built with the provided factory/,
    );
    expect(() => userRepo.query().whereFilter(() => null as any)).toThrow(/received null/);
    expect(() => userRepo.query().whereFilter(() => 'status == published' as any)).toThrow(
      /received string/,
    );
  });

  it('accepts a prebuilt Admin SDK Filter as the documented escape hatch', async () => {
    await seedPosts();

    const rows = await userRepo
      .query()
      .whereFilter(() =>
        Filter.or(Filter.where('status', '==', 'published'), Filter.where('authorId', '==', 'u2')),
      )
      .get();

    expect(names(rows)).toEqual(['draft-u2-public', 'published-u1-public']);
  });

  it('select() preserves allowLegacyDatastoreIds for post-projection id filters', () => {
    const legacyRepo = FirestoreRepository.raw<Post>(db, 'test_legacy_ids_composite', {
      allowLegacyDatastoreIds: true,
    });
    const strictRepo = FirestoreRepository.raw<Post>(db, 'test_strict_ids_composite');

    // Regression (select() previously dropped the flag, defaulting the new builder to `false`).
    expect(() => legacyRepo.query().select('name').whereId('==', '__id7__')).not.toThrow();
    expect(() =>
      legacyRepo
        .query()
        .select('name')
        .whereFilter(f => f.whereId('==', '__id7__')),
    ).not.toThrow();

    // A repository that did NOT opt in still rejects the reserved id namespace, projected or not.
    expect(() => strictRepo.query().select('name').whereId('==', '__id7__')).toThrow(
      InvalidDocumentIdError,
    );
    expect(() =>
      strictRepo
        .query()
        .select('name')
        .whereFilter(f => f.whereId('==', '__id7__')),
    ).toThrow(InvalidDocumentIdError);
  });
});
