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
import { FieldPath, Filter } from 'firebase-admin/firestore';
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

  // ---------------------------------------------------------------------------------------------
  // Firestore semantics that composite filters expose and the ORM deliberately does NOT guard.
  // These pin OBSERVED backend behavior so an SDK/emulator change is detected rather than silently
  // changing consumers' result sets.
  // ---------------------------------------------------------------------------------------------

  /**
   * Seeds a set where two documents match `kind == 'x'` but have NO `score` field, so an inequality
   * on `score` inside an OR branch can be shown to exclude them.
   */
  async function seedSparse(): Promise<void> {
    const created = await userRepo.bulkCreate(
      [
        { name: 'x-with-score', kind: 'x', score: 10 },
        { name: 'x-no-score', kind: 'x' },
        { name: 'x-no-score-2', kind: 'x' },
        { name: 'z-with-score', kind: 'z', score: 30 },
      ] as any[],
      { returnDoc: true },
    );
    (created as unknown as { id: string }[]).forEach(row => trackUser(row.id));
  }

  it('an inequality inside an or() branch EXCLUDES documents missing that field', async () => {
    await seedSparse();

    // Baseline: the equality branch alone matches all three `kind: 'x'` documents.
    const equalityOnly = await userRepo.query().where('kind', '==', 'x').get();
    expect(names(equalityOnly)).toEqual(['x-no-score', 'x-no-score-2', 'x-with-score']);

    // Same equality branch OR-ed with an inequality on a field two of them do not have: Firestore
    // adds an implicit orderBy('score') across the FLATTENED filter tree, and a document missing an
    // ordered field cannot appear — so the OR returns FEWER rows than one of its own disjuncts.
    const withInequality = await userRepo
      .query()
      .whereFilter(f => f.or(f.where('score', '>', 5), f.where('kind', '==', 'x')))
      .get();
    expect(names(withInequality)).toEqual(['x-with-score', 'z-with-score']);
    expect(withInequality.length).toBeLessThan(equalityOnly.length);

    // count() agrees, so this is a query-planning effect and not a read-path artifact.
    const counted = await userRepo
      .query()
      .whereFilter(f => f.or(f.where('score', '>', 5), f.where('kind', '==', 'x')))
      .count();
    expect(counted).toBe(2);

    // An equality-only disjunction is unaffected.
    const equalityOr = await userRepo
      .query()
      .whereFilter(f => f.or(f.where('kind', '==', 'x'), f.where('kind', '==', 'z')))
      .get();
    expect(names(equalityOr)).toEqual([
      'x-no-score',
      'x-no-score-2',
      'x-with-score',
      'z-with-score',
    ]);
  });

  it('f.whereId() with a comparison operator is exempt from the missing-field exclusion', async () => {
    await seedSparse();

    // Firestore skips documentId() when adding implicit orders, and a document name always exists,
    // so a document-name comparison inside an OR does NOT drop field-less documents. This is the one
    // safe inequality shape inside a disjunction.
    const rows = await userRepo
      .query()
      .whereFilter(f => f.or(f.whereId('>', '\u0000'), f.where('kind', '==', 'x')))
      .get();

    expect(names(rows)).toEqual(['x-no-score', 'x-no-score-2', 'x-with-score', 'z-with-score']);
  });

  it('cursor pagination stays consistent across an OR containing an inequality', async () => {
    await seedSparse();

    const page = (dir: 'asc' | 'desc') =>
      userRepo
        .query()
        .whereFilter(f => f.or(f.where('score', '>', 5), f.where('kind', '==', 'z')))
        .orderBy('score', dir);

    for (const dir of ['asc', 'desc'] as const) {
      const all = await page(dir).get();
      const first = await page(dir).paginate(1);
      const second = await page(dir).paginate(1, first.nextCursor);
      const paged = [...first.items, ...second.items].map(row => (row as { name?: string }).name);

      // No duplicates and no skips versus the unpaginated result, in either direction. The cursor is
      // a document PATH that decodeCursor re-fetches in full, which is what keeps this working: the
      // implicit orderBy that the inequality adds would reject a projected cursor snapshot.
      expect(paged).toEqual(all.map(row => (row as { name?: string }).name));
      expect(new Set(paged).size).toBe(paged.length);
    }
  });

  it('a projected OR-with-inequality query still paginates (cursor is a path, not field values)', async () => {
    await seedSparse();

    const projected = await userRepo
      .query()
      .whereFilter(f => f.or(f.where('score', '>', 5), f.where('kind', '==', 'z')))
      .select('name')
      .orderBy('score', 'asc')
      .paginate(1);

    expect(projected.items).toHaveLength(1);
    expect(projected.hasMore).toBe(true);

    const next = await userRepo
      .query()
      .whereFilter(f => f.or(f.where('score', '>', 5), f.where('kind', '==', 'z')))
      .select('name')
      .orderBy('score', 'asc')
      .paginate(1, projected.nextCursor);

    expect(next.items).toHaveLength(1);
    expect(names(next.items)).not.toEqual(names(projected.items));
  });

  it('surfaces the server-side disjunction cap intact rather than guarding locally', async () => {
    // 31 disjunctions after normalization exceeds the documented maximum of 30. The ORM does not
    // pre-check this; the backend rejects it and the message must reach the caller unchanged.
    await expect(
      userRepo
        .query()
        .whereFilter(f =>
          f.or(...Array.from({ length: 31 }, (_, i) => f.where('kind', '==', `k${i}`))),
        )
        .get(),
    ).rejects.toThrow(/Too many disjunctions after normalization/);

    // 30 is accepted, proving the boundary is the backend's and not something the ORM invented.
    await expect(
      userRepo
        .query()
        .whereFilter(f =>
          f.or(...Array.from({ length: 30 }, (_, i) => f.where('kind', '==', `k${i}`))),
        )
        .get(),
    ).resolves.toEqual([]);
  });

  it('rejects not-in combined with OR even when the not-in comes from a chained where()', async () => {
    // The incompatibility is per QUERY, not per callback: a not-in outside whereFilter() still
    // collides with a disjunction inside it. Documented rather than locally guarded.
    await expect(
      userRepo
        .query()
        .where('kind', 'not-in', ['q'])
        .whereFilter(f => f.or(f.where('kind', '==', 'x'), f.where('kind', '==', 'z')))
        .get(),
    ).rejects.toThrow(
      /'NOT_IN' cannot be used in the same query with 'IN', 'ARRAY_CONTAINS_ANY' or 'OR'/,
    );
  });

  it('a PARTIALLY empty prebuilt filter is not caught by the dropped-filter guard', async () => {
    await seedPosts();

    // Documents the residual escape-hatch gap honestly: _parseCompositeFilter drops empty sub-groups
    // at any depth, so these change meaning and still produce a NEW query object — reference equality
    // cannot see them. The factory's construction-site guard is what closes this for f.and()/f.or().
    const narrowed = await userRepo
      .query()
      .whereFilter(() => Filter.or(Filter.and(), Filter.where('status', '==', 'published')))
      .get();
    // Semantically `TRUE OR status == published` should match everything; the empty AND is dropped.
    expect(names(narrowed)).toEqual(['published-u1-public']);

    const widened = await userRepo
      .query()
      .whereFilter(() => Filter.and(Filter.or(), Filter.where('status', '==', 'published')))
      .get();
    // Semantically `FALSE AND status == published` should match nothing; the empty OR is dropped.
    expect(names(widened)).toEqual(['published-u1-public']);
  });

  it('validates a reserved-namespace id passed through where(FieldPath.documentId())', () => {
    // The document NAME reached via a FieldPath must clear the same id boundary as whereId(), on both
    // the chained and the composite surface (the SDK itself accepts the reserved `__…__` namespace).
    expect(() => userRepo.query().where(FieldPath.documentId(), '==', '__id7__')).toThrow(
      InvalidDocumentIdError,
    );
    expect(() =>
      userRepo.query().whereFilter(f => f.where(FieldPath.documentId(), '==', '__id7__')),
    ).toThrow(InvalidDocumentIdError);

    // A DocumentReference operand is already resolved, so it must NOT be routed into id parsing.
    // (The SDK still rejects a reference outside the queried collection — a different error, which is
    // exactly the point: it reached the SDK rather than validateDocumentId.)
    expect(() =>
      userRepo.query().where(FieldPath.documentId(), '==', db.doc('some_collection/ok-id')),
    ).not.toThrow(InvalidDocumentIdError);
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
