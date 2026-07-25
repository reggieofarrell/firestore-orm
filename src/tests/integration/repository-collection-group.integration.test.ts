/**
 * Strategy: emulator integration tests for `repo.collectionGroup()` — collection-group queries with
 * full-path result identity (issue #31, ADR-0024). Emulator-backed because every claim here is
 * about what Firestore actually matches across collections, which mocks cannot prove.
 *
 * Verification points:
 *  - A group query really spans SEPARATE collections: multiple parents, a same-named ROOT
 *    collection, and a same-named collection nested under a group member itself.
 *  - Leaf ids COLLIDE across the group (two documents both report `id: 'p1'`), so every result
 *    carries `path` / `parentPath` and `path` is the identity that distinguishes them.
 *  - `wherePath` / `orderByPath` are document-NAME operations on the full path, with the same
 *    `InvalidDocumentIdError` boundary the leaf-id surface has (reserved `__…__`, `..`, bad segment
 *    counts, and — the likely mistake — a bare id).
 *  - Pagination cursors are bound to the group by COLLECTION ID, not by parent path: a cursor from
 *    a different parent is valid, one from a different collection is not. Firestore itself accepts
 *    a foreign `startAfter()` snapshot silently, so this guard is the only thing rejecting it.
 *  - The shared read surface (select / count / aggregates / stream / onSnapshot / distinctValues /
 *    pagination / composite filters) behaves identically to a single-collection query.
 *  - The read converter, `allowLegacyDatastoreIds` policy, and typed stored paths are inherited
 *    from the originating repository.
 */
import { FieldPath, Filter, type Firestore } from 'firebase-admin/firestore';
import { z } from 'zod';
import { FirestoreRepository } from '../../core/FirestoreRepository.js';
import { InvalidDocumentIdError } from '../../core/Errors.js';
import { getIntegrationDb } from './helpers/firestoreIntegrationHarness.js';

const postSchema = z.object({
  title: z.string(),
  status: z.string(),
  views: z.number(),
});
type Post = z.infer<typeof postSchema>;

/**
 * A unique group id per suite run. This matters more than usual: a collection group spans the whole
 * database, so a shared name would pick up documents from any other suite (or a previous run) that
 * happened to use it.
 */
const RUN = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const GROUP_ID = `cg_posts_${RUN}`;
const USERS = `cg_users_${RUN}`;
const OTHER_ID = `cg_notes_${RUN}`;

/** Encodes a pagination cursor the way the builder does, for forged-cursor probes. */
function makeCursor(path: string): string {
  return Buffer.from(JSON.stringify({ path })).toString('base64url');
}

describe('FirestoreRepository collectionGroup()', () => {
  const db: Firestore = getIntegrationDb();

  // The repository the group is derived from: `cg_users_<run>/u1/cg_posts_<run>`.
  const postsRepo = FirestoreRepository.withSchema(db, `${USERS}/u1/${GROUP_ID}`, postSchema);
  const postGroup = postsRepo.collectionGroup();

  /** Every document path seeded, for cleanup and for membership expectations. */
  const seeded = {
    u1p1: `${USERS}/u1/${GROUP_ID}/p1`,
    u2p1: `${USERS}/u2/${GROUP_ID}/p1`, // SAME leaf id as u1p1
    u2p2: `${USERS}/u2/${GROUP_ID}/p2`,
    root: `${GROUP_ID}/root1`, // a same-named ROOT collection
    deep: `${USERS}/u1/${GROUP_ID}/p1/${GROUP_ID}/deep1`, // nested under a group member
    outsider: `${USERS}/u1/${OTHER_ID}/n1`, // different collection id — must never match
  };

  beforeAll(async () => {
    await Promise.all([
      db.doc(seeded.u1p1).set({ title: 'A', status: 'published', views: 10 }),
      db.doc(seeded.u2p1).set({ title: 'B', status: 'draft', views: 20 }),
      db.doc(seeded.u2p2).set({ title: 'C', status: 'published', views: 30 }),
      db.doc(seeded.root).set({ title: 'R', status: 'published', views: 40 }),
      db.doc(seeded.deep).set({ title: 'D', status: 'draft', views: 50 }),
      db.doc(seeded.outsider).set({ title: 'N', status: 'published', views: 60 }),
    ]);
  });

  afterAll(async () => {
    const batch = db.batch();
    Object.values(seeded).forEach(path => batch.delete(db.doc(path)));
    await batch.commit();
  });

  // -------------------------------------------------------------------------
  // Membership and identity
  // -------------------------------------------------------------------------

  it('spans every collection with the id — nested, root-level, and recursively nested', async () => {
    const rows = await postGroup.query().get();

    expect(rows.map(row => row.path).sort()).toEqual(
      [seeded.u1p1, seeded.u2p1, seeded.u2p2, seeded.root, seeded.deep].sort(),
    );
    // A different collection id is never a member, even under the same parent document.
    expect(rows.map(row => row.path)).not.toContain(seeded.outsider);
  });

  it('carries full-path identity, and `path` distinguishes colliding leaf ids', async () => {
    const rows = await postGroup.query().where('title', 'in', ['A', 'B']).get();

    // The whole reason this feature exists: `id` alone cannot tell these two apart.
    expect(rows.map(row => row.id).sort()).toEqual(['p1', 'p1']);
    expect(rows.map(row => row.path).sort()).toEqual([seeded.u1p1, seeded.u2p1].sort());

    const fromU1 = rows.find(row => row.path === seeded.u1p1)!;
    expect(fromU1).toMatchObject({
      id: 'p1',
      path: seeded.u1p1,
      parentPath: `${USERS}/u1/${GROUP_ID}`,
      title: 'A',
      status: 'published',
      views: 10,
    });
  });

  it('reports the containing collection as `parentPath`, including for a root-level document', async () => {
    const rows = await postGroup.query().get();
    const byPath = Object.fromEntries(rows.map(row => [row.path, row.parentPath]));

    expect(byPath[seeded.u2p2]).toBe(`${USERS}/u2/${GROUP_ID}`);
    expect(byPath[seeded.root]).toBe(GROUP_ID); // root collection: parentPath is the id itself
    expect(byPath[seeded.deep]).toBe(`${seeded.u1p1}/${GROUP_ID}`);
  });

  it('results stay JSON-serializable (identity is plain strings, no live references)', async () => {
    const row = (await postGroup.query().where('title', '==', 'A').getOne())!;
    expect(JSON.parse(JSON.stringify(row))).toEqual({
      title: 'A',
      status: 'published',
      views: 10,
      id: 'p1',
      path: seeded.u1p1,
      parentPath: `${USERS}/u1/${GROUP_ID}`,
    });
  });

  it('exposes the group collection id on the handle', () => {
    expect(postGroup.collectionId).toBe(GROUP_ID);
  });

  // -------------------------------------------------------------------------
  // Filtering
  // -------------------------------------------------------------------------

  it('filters on typed stored field paths across the whole group', async () => {
    const published = await postGroup.query().where('status', '==', 'published').get();
    expect(published.map(row => row.title).sort()).toEqual(['A', 'C', 'R']);

    const busy = await postGroup.query().where('views', '>=', 40).get();
    expect(busy.map(row => row.title).sort()).toEqual(['D', 'R']);
  });

  it('supports composite AND/OR filters, including a wherePath branch', async () => {
    const rows = await postGroup
      .query()
      .whereFilter(f => f.or(f.where('status', '==', 'draft'), f.where('views', '>=', 40)))
      .get();
    expect(rows.map(row => row.title).sort()).toEqual(['B', 'D', 'R']);

    const mixed = await postGroup
      .query()
      .whereFilter(f => f.or(f.where('title', '==', 'C'), f.wherePath('==', seeded.u1p1)))
      .get();
    expect(mixed.map(row => row.path).sort()).toEqual([seeded.u1p1, seeded.u2p2].sort());
  });

  it('accepts a prebuilt Admin SDK Filter as the documented escape hatch', async () => {
    const rows = await postGroup
      .query()
      .whereFilter(() => Filter.where('status', '==', 'draft'))
      .get();
    expect(rows.map(row => row.title).sort()).toEqual(['B', 'D']);
  });

  it('rejects an empty composite group with collection-GROUP wording', async () => {
    expect(() => postGroup.query().whereFilter(f => f.or())).toThrow(
      /match every document in the collection group/,
    );
    expect(() => postGroup.query().whereFilter(f => f.and())).toThrow(
      /f\.and\(\) requires at least one filter/,
    );
  });

  it('rejects a non-Filter callback return and names the group factory methods', () => {
    expect(() =>
      // Cast: the SDK's `Filter` instance type is structurally empty, so this cannot be caught by
      // the compiler — the runtime guard is the only line of defense (see applyCompositeFilter).
      postGroup.query().whereFilter((() => 'status == draft') as never),
    ).toThrow(/f\.where \/ f\.wherePath \/ f\.and \/ f\.or/);
  });

  it('rejects a wholly-empty prebuilt filter, which Firestore would silently drop', () => {
    expect(() => postGroup.query().whereFilter(() => Filter.and())).toThrow(
      /no conditions.*every document in the collection group/s,
    );
  });

  // -------------------------------------------------------------------------
  // wherePath / orderByPath — document-name operations on the FULL path
  // -------------------------------------------------------------------------

  it('matches a single document by full path, and by DocumentReference', async () => {
    const byPath = await postGroup.query().wherePath('==', seeded.u2p1).get();
    expect(byPath.map(row => row.path)).toEqual([seeded.u2p1]);

    const byRef = await postGroup.query().wherePath('==', db.doc(seeded.u2p2)).get();
    expect(byRef.map(row => row.title)).toEqual(['C']);
  });

  it('supports `in` over full paths and comparison bounds', async () => {
    const inSet = await postGroup.query().wherePath('in', [seeded.u1p1, seeded.root]).get();
    expect(inSet.map(row => row.path).sort()).toEqual([seeded.u1p1, seeded.root].sort());

    const after = await postGroup.query().wherePath('>', seeded.u1p1).get();
    // Lexicographic over the full path: everything sorting after `…/u1/…/p1`.
    expect(after.map(row => row.path).sort()).toEqual(
      [seeded.deep, seeded.u2p1, seeded.u2p2].sort(),
    );
  });

  it('matches nothing (without erroring) for a well-formed path outside the group', async () => {
    const rows = await postGroup.query().wherePath('==', seeded.outsider).get();
    expect(rows).toEqual([]);
  });

  it('rejects a bare leaf id — the likely mistake — before any I/O', async () => {
    expect(() => postGroup.query().wherePath('==', 'p1')).toThrow(InvalidDocumentIdError);
    expect(() => postGroup.query().wherePath('==', 'p1')).toThrow(/even number of segments/);
  });

  it('applies the id boundary to every segment of the path, and to every operand', () => {
    // Reserved namespace inside the path — reaches Firestore as INVALID_ARGUMENT without this gate.
    expect(() => postGroup.query().wherePath('==', `${GROUP_ID}/__evil__`)).toThrow(
      /reserved "__\.\*__" namespace/,
    );
    // A `..` segment.
    expect(() => postGroup.query().wherePath('==', `${GROUP_ID}/../x/y`)).toThrow(
      InvalidDocumentIdError,
    );
    // Leading / trailing slashes: the SDK silently normalizes these; the ORM does not.
    expect(() => postGroup.query().wherePath('==', `/${seeded.u1p1}`)).toThrow(
      InvalidDocumentIdError,
    );
    expect(() => postGroup.query().wherePath('==', `${seeded.u1p1}/`)).toThrow(
      InvalidDocumentIdError,
    );
    // Per-operand, not per-array: a valid first element must not waive the second.
    expect(() => postGroup.query().wherePath('in', [seeded.u1p1, `${GROUP_ID}/__evil__`])).toThrow(
      InvalidDocumentIdError,
    );
    // A DocumentReference operand is already resolved and passes through.
    expect(() => postGroup.query().wherePath('in', [db.doc(seeded.u1p1)])).not.toThrow();
  });

  it('routes where(FieldPath.documentId(), …) through the same path boundary', async () => {
    const rows = await postGroup.query().where(FieldPath.documentId(), '==', seeded.u2p2).get();
    expect(rows.map(row => row.title)).toEqual(['C']);

    expect(() =>
      postGroup.query().where(FieldPath.documentId(), '==', `${GROUP_ID}/__evil__`),
    ).toThrow(InvalidDocumentIdError);
    // A bare id would reach the SDK and fail there; the ORM rejects it locally with a clear reason.
    expect(() => postGroup.query().where(FieldPath.documentId(), '==', 'p1')).toThrow(
      /even number of segments/,
    );
  });

  it('leaves a NON-string operand to the SDK on the untyped where() surface, unlike wherePath()', () => {
    // Deliberate asymmetry, mirroring the single-collection surface: `wherePath` promises a path
    // string or a reference, so anything else is a contract violation the ORM owns;
    // `where(documentId(), …)` takes `unknown`, so a non-string is not an untrusted id string to
    // parse and the ORM does not claim it. The SDK's own operand check rejects it — at construction,
    // as it happens, so nothing reaches the wire either way.
    expect(() => postGroup.query().where(FieldPath.documentId(), '==', 42)).toThrow(
      /must be a string or a DocumentReference/,
    );
    expect(() => postGroup.query().where(FieldPath.documentId(), '==', 42)).not.toThrow(
      InvalidDocumentIdError,
    );
    // …whereas the typed surface rejects it as an id-validation failure, with a stable `reason`.
    expect(() => postGroup.query().wherePath('==', 42 as unknown as string)).toThrow(
      InvalidDocumentIdError,
    );
  });

  it('routes a documentId() field path inside whereFilter through the path boundary too', async () => {
    const rows = await postGroup
      .query()
      .whereFilter(f => f.where(FieldPath.documentId(), '==', seeded.u2p1))
      .get();
    expect(rows.map(row => row.path)).toEqual([seeded.u2p1]);

    expect(() =>
      postGroup.query().whereFilter(f => f.where(FieldPath.documentId(), '==', 'p1')),
    ).toThrow(/even number of segments/);
  });

  it('honors the repository allowLegacyDatastoreIds policy on document segments', () => {
    const legacyPath = `${GROUP_ID}/__id7__`;
    expect(() => postGroup.query().wherePath('==', legacyPath)).toThrow(InvalidDocumentIdError);

    const legacyRepo = FirestoreRepository.withSchema(db, GROUP_ID, postSchema, {
      allowLegacyDatastoreIds: true,
    });
    expect(() => legacyRepo.collectionGroup().query().wherePath('==', legacyPath)).not.toThrow();
    // The exception is document-segment-only: a reserved COLLECTION segment still rejects.
    expect(() => legacyRepo.collectionGroup().query().wherePath('==', '__id7__/x')).toThrow(
      InvalidDocumentIdError,
    );
  });

  it('orders by full document path in both directions', async () => {
    const asc = await postGroup.query().orderByPath().get();
    expect(asc.map(row => row.path)).toEqual([...asc.map(row => row.path)].sort());

    // Descending needs another clause: Firestore rejects a query whose ONLY ordering is a
    // descending document-name scan. Not group-specific — `orderById('desc')` on a plain
    // collection fails identically (verified), which is why both methods document it.
    const desc = await postGroup
      .query()
      .where('status', 'in', ['published', 'draft'])
      .orderByPath('desc')
      .get();
    expect(desc.map(row => row.path)).toEqual([...asc.map(row => row.path)].reverse());
  });

  it('surfaces the descending-key-scan limitation rather than hiding it', async () => {
    // Documented, and identical to the single-collection `orderById('desc')` behavior.
    await expect(postGroup.query().orderByPath('desc').get()).rejects.toThrow(
      /descending key scans/,
    );
    await expect(postsRepo.query().orderById('desc').get()).rejects.toThrow(/descending key scans/);
  });

  // -------------------------------------------------------------------------
  // Counting and aggregation
  // -------------------------------------------------------------------------

  it('counts query-aware with count() and whole-group with groupCount()', async () => {
    await expect(postGroup.query().where('status', '==', 'draft').count()).resolves.toBe(2);
    // groupCount() ignores the chained filter — it spans the entire group.
    await expect(postGroup.query().where('status', '==', 'draft').groupCount()).resolves.toBe(5);
    await expect(postGroup.query().where('title', '==', 'nope').exists()).resolves.toBe(false);
    await expect(postGroup.query().where('title', '==', 'A').exists()).resolves.toBe(true);
  });

  it('aggregates numeric fields across the group', async () => {
    await expect(postGroup.query().sum('views')).resolves.toBe(150); // 10+20+30+40+50
    await expect(postGroup.query().average('views')).resolves.toBe(30);
    await expect(
      postGroup.query().where('title', '==', 'nope').average('views'),
    ).resolves.toBeNull();
    await expect(postGroup.query().where('title', '==', 'nope').sum('views')).resolves.toBe(0);
  });

  it('collects distinct values across the group', async () => {
    const statuses = await postGroup.query().distinctValues('status');
    expect(statuses.sort()).toEqual(['draft', 'published']);
  });

  // -------------------------------------------------------------------------
  // Projection, streaming, listeners
  // -------------------------------------------------------------------------

  it('projects with select() while keeping path identity', async () => {
    const rows = await postGroup.query().select('title').where('status', '==', 'draft').get();

    expect(rows.map(row => row.title).sort()).toEqual(['B', 'D']);
    // Identity comes from the snapshot reference, so a field mask cannot strip it.
    expect(rows.map(row => row.path).sort()).toEqual([seeded.u2p1, seeded.deep].sort());
    expect(rows.every(row => typeof row.parentPath === 'string')).toBe(true);
    // Unselected data really is absent.
    expect(rows.every(row => row.views === undefined)).toBe(true);
  });

  it('does not mutate the source builder when select() projects', async () => {
    const base = postGroup.query().where('title', '==', 'A');
    const projected = base.select('title');

    const full = await base.get();
    const masked = await projected.get();
    expect(full[0].views).toBe(10);
    expect(masked[0].views).toBeUndefined();
    expect(masked[0].path).toBe(seeded.u1p1);
  });

  it('inherits the projection guards from the shared read surface', async () => {
    await expect(
      postGroup
        .query()
        .select('title')
        .onSnapshot(() => {}),
    ).rejects.toThrow(/onSnapshot\(\) is not supported after select\(\)/);
    await expect(postGroup.query().select('title').distinctValues('status')).rejects.toThrow(
      /distinctValues\(\) is not supported after select\(\)/,
    );
  });

  it('streams results with full-path identity', async () => {
    const paths: string[] = [];
    for await (const row of postGroup.query().where('status', '==', 'published').stream()) {
      paths.push(row.path);
    }
    expect(paths.sort()).toEqual([seeded.u1p1, seeded.u2p2, seeded.root].sort());
  });

  it('supports real-time listeners over the group', async () => {
    const emissions: string[][] = [];
    const unsubscribe = await postGroup
      .query()
      .where('status', '==', 'draft')
      .onSnapshot(rows => {
        emissions.push(rows.map(row => row.path).sort());
      });

    await new Promise(resolve => setTimeout(resolve, 500));
    unsubscribe();

    expect(emissions.length).toBeGreaterThanOrEqual(1);
    expect(emissions[emissions.length - 1]).toEqual([seeded.u2p1, seeded.deep].sort());
  });

  // -------------------------------------------------------------------------
  // Pagination — cursors bind to the group by COLLECTION ID
  // -------------------------------------------------------------------------

  it('paginates across parents with a stable path cursor', async () => {
    const first = await postGroup.query().orderByPath().paginate(2);
    expect(first.items).toHaveLength(2);
    expect(first.hasMore).toBe(true);

    const second = await postGroup.query().orderByPath().paginate(2, first.nextCursor);
    const third = await postGroup.query().orderByPath().paginate(2, second.nextCursor);

    const all = [...first.items, ...second.items, ...third.items].map(row => row.path);
    expect(all).toEqual([...all].sort());
    expect(new Set(all).size).toBe(5);
    expect(third.hasMore).toBe(false);
    expect(third.nextCursor).toBeNull();
  });

  it('requires an orderBy, and supports offset pagination and a counted page', async () => {
    await expect(postGroup.query().paginate(2)).rejects.toThrow(/requires at least one orderBy/);

    const page = await postGroup.query().orderBy('views').offsetPaginate(2, 2);
    expect(page).toMatchObject({ page: 2, pageSize: 2, total: 5, totalPages: 3 });
    expect(page.items.map(row => row.title)).toEqual(['C', 'R']);

    const counted = await postGroup.query().orderByPath().paginateWithCount(2);
    expect(counted.total).toBe(5);
    expect(counted.items).toHaveLength(2);
  });

  it('accepts a cursor from a DIFFERENT parent in the same group', async () => {
    // This is the case a collection-scoped cursor check would wrongly reject — and the reason the
    // group binds by collection id instead of by parent path.
    const cursor = makeCursor(seeded.u2p1);
    const page = await postGroup.query().orderByPath().paginate(10, cursor);
    expect(page.items.map(row => row.path)).toEqual([seeded.u2p2]);
  });

  it('rejects a forged cursor pointing outside the group', async () => {
    // Firestore accepts a foreign `startAfter()` snapshot silently (verified), so without this
    // guard a forged cursor would dereference an arbitrary document in the database.
    const foreign = makeCursor(seeded.outsider);
    await expect(postGroup.query().orderByPath().paginate(2, foreign)).rejects.toThrow(
      'Invalid pagination cursor for this collection group.',
    );

    const parentDoc = makeCursor(`${USERS}/u1`);
    await expect(postGroup.query().orderByPath().paginate(2, parentDoc)).rejects.toThrow(
      'Invalid pagination cursor for this collection group.',
    );
  });

  it('rejects a malformed cursor and one whose document no longer exists', async () => {
    await expect(postGroup.query().orderByPath().paginate(2, 'not-base64!!')).rejects.toThrow(
      'Invalid pagination cursor.',
    );
    const missing = makeCursor(`${GROUP_ID}/does-not-exist`);
    await expect(postGroup.query().orderByPath().paginate(2, missing)).rejects.toThrow(
      /no longer points to an existing document/,
    );
  });

  // -------------------------------------------------------------------------
  // Repository-derived configuration
  // -------------------------------------------------------------------------

  it('applies the originating repository read converter to group reads', async () => {
    const storedSchema = z.object({ title: z.string(), status: z.string(), views: z.number() });
    const readSchema = z.object({ headline: z.string(), views: z.number() });
    const converted = FirestoreRepository.withSchema(db, GROUP_ID, readSchema, {
      storedSchema,
      readConverter: snapshot => ({
        headline: (snapshot.data() as Post).title.toUpperCase(),
        views: (snapshot.data() as Post).views,
      }),
    });

    const rows = await converted.collectionGroup().query().where('status', '==', 'draft').get();
    expect(rows.map(row => row.headline).sort()).toEqual(['B', 'D']);
    // Identity is overlaid after the converter, so path identity survives conversion.
    expect(rows.map(row => row.path).sort()).toEqual([seeded.u2p1, seeded.deep].sort());
  });

  it('reconstructs a group document from a raw snapshot via fromSnapshot()', async () => {
    const snapshot = await db.doc(seeded.deep).get();
    expect(postGroup.fromSnapshot(snapshot)).toEqual({
      title: 'D',
      status: 'draft',
      views: 50,
      id: 'deep1',
      path: seeded.deep,
      parentPath: `${seeded.u1p1}/${GROUP_ID}`,
    });

    const absent = await db.doc(`${GROUP_ID}/never-written`).get();
    expect(postGroup.fromSnapshot(absent)).toBeNull();
  });

  it('rejects a fromSnapshot() snapshot from outside the group', async () => {
    // Without this, an outsider snapshot is reshaped into a perfectly well-typed
    // CollectionGroupDocument carrying the outsider's path — a trigger wired to the wrong path would
    // look correct and silently lie. Same membership boundary the cursor guard applies.
    const outsider = await db.doc(seeded.outsider).get();
    expect(() => postGroup.fromSnapshot(outsider)).toThrow(/is not part of the/);
    expect(() => postGroup.fromSnapshot(outsider)).toThrow(new RegExp(OTHER_ID));

    // A non-existent snapshot short-circuits to null before the membership check, so a delete
    // trigger on an unrelated path does not throw where it previously returned null.
    const absentOutsider = await db.doc(`${USERS}/u1/${OTHER_ID}/never-written`).get();
    expect(postGroup.fromSnapshot(absentOutsider)).toBeNull();
  });

  it('distinctValues() reads the stored field, never the identity overlay', async () => {
    // Deliberate divergence from the row-materializing terminals, pinned here: this is the only
    // surface that can still read a field the identity overlay shadows.
    const raw = FirestoreRepository.raw<{ title: string; path: string }>(db, GROUP_ID);
    const paths = [`${GROUP_ID}/dv1`, `${USERS}/u4/${GROUP_ID}/dv2`, `${GROUP_ID}/dv3`];
    await Promise.all([
      db.doc(paths[0]).set({ title: 'X', path: '/var/a.txt' }),
      db.doc(paths[1]).set({ title: 'X', path: '/var/b.txt' }),
      db.doc(paths[2]).set({ title: 'X', path: '/var/a.txt' }), // duplicate stored value
    ]);

    try {
      const group = raw.collectionGroup();
      const distinct = await group.query().where('title', '==', 'X').distinctValues('path');
      expect(distinct.sort()).toEqual(['/var/a.txt', '/var/b.txt']);

      // …while the materializing terminals report document paths for the same field name.
      const rows = await group.query().where('title', '==', 'X').get();
      expect(rows.map(row => row.path).sort()).toEqual([...paths].sort());
    } finally {
      const batch = db.batch();
      paths.forEach(path => batch.delete(db.doc(path)));
      await batch.commit();
    }
  });

  it('applies the read converter in fromSnapshot() before overlaying identity', async () => {
    const converted = FirestoreRepository.withSchema(
      db,
      GROUP_ID,
      z.object({ headline: z.string() }),
      {
        storedSchema: postSchema,
        readConverter: snapshot => ({ headline: (snapshot.data() as Post).title.toUpperCase() }),
      },
    );

    // A trigger snapshot is NOT converter-applied by the SDK, which is the whole reason this exists.
    const snapshot = await db.doc(seeded.u2p2).get();
    expect(converted.collectionGroup().fromSnapshot(snapshot)).toEqual({
      headline: 'C',
      id: 'p2',
      path: seeded.u2p2,
      parentPath: `${USERS}/u2/${GROUP_ID}`,
    });
  });

  it('shadows a stored identity-named field on an unvalidated repository', async () => {
    // The schema guard cannot fire without a schema, so the `Omit` in the result type is the only
    // thing surfacing it. Pin the runtime consequence: identity is written last and wins.
    const raw = FirestoreRepository.raw<{ title: string; path: string }>(db, GROUP_ID);
    const filePath = `${GROUP_ID}/shadow1`;
    await db.doc(filePath).set({ title: 'S', status: 'published', views: 1, path: 'MY/OWN/VALUE' });

    try {
      const row = (await raw.collectionGroup().query().where('title', '==', 'S').getOne())!;
      expect(row.path).toBe(filePath); // identity, NOT 'MY/OWN/VALUE'
      // The stored value is still readable through a surface that does not overlay identity.
      expect((await db.doc(filePath).get()).data()?.path).toBe('MY/OWN/VALUE');
    } finally {
      await db.doc(filePath).delete();
    }
  });

  it('derives the group id from the last segment of the repository path', () => {
    const nested = FirestoreRepository.withSchema(db, `${USERS}/u9/${GROUP_ID}`, postSchema);
    expect(nested.collectionGroup().collectionId).toBe(GROUP_ID);

    const topLevel = FirestoreRepository.withSchema(db, GROUP_ID, postSchema);
    expect(topLevel.collectionGroup().collectionId).toBe(GROUP_ID);
  });

  it('returns a fresh builder per query() call', async () => {
    const handle = postsRepo.collectionGroup();
    const a = handle.query().where('status', '==', 'draft');
    const b = handle.query();

    await expect(a.count()).resolves.toBe(2);
    await expect(b.count()).resolves.toBe(5); // unaffected by the filter chained onto `a`
  });

  it('rejects a read schema whose top-level fields collide with group identity', () => {
    const withPath = FirestoreRepository.withSchema(
      db,
      `${GROUP_ID}_files`,
      z.object({ path: z.string(), size: z.number() }),
    );
    expect(() => withPath.collectionGroup()).toThrow(/declares a top-level "path" field/);

    const withParentPath = FirestoreRepository.withSchema(
      db,
      `${GROUP_ID}_files`,
      z.object({ parentPath: z.string() }),
    );
    expect(() => withParentPath.collectionGroup()).toThrow(/declares a top-level "parentPath"/);

    // A nested field named `path` is unaffected — only the top level collides.
    const nestedPath = FirestoreRepository.withSchema(
      db,
      `${GROUP_ID}_files`,
      z.object({ file: z.object({ path: z.string() }) }),
    );
    expect(() => nestedPath.collectionGroup()).not.toThrow();
  });

  it('rejects a STORED schema whose top-level fields collide with group identity', () => {
    // The read model is clean but the at-rest model — the shape query field paths derive from —
    // declares `path`. `where('path', …)` would then filter the stored field while `row.path` came
    // back as the document path, with the caller's own value unreachable. The library already
    // rejects a top-level `id` in a storedSchema; identity fields must be treated the same way.
    const storedPath = FirestoreRepository.withSchema(
      db,
      `${GROUP_ID}_files`,
      z.object({ title: z.string() }),
      { storedSchema: z.object({ title: z.string(), path: z.string() }) },
    );
    expect(() => storedPath.collectionGroup()).toThrow(/declares a top-level "path" field/);
    expect(() => storedPath.collectionGroup()).toThrow(/stored schema/);

    // Also when a converter is configured — the converter strips the stored field so there is no
    // silent replacement, but `where('path', …)` still targets a field the result cannot expose.
    const storedPathConverted = FirestoreRepository.withSchema(
      db,
      `${GROUP_ID}_files`,
      z.object({ title: z.string() }),
      {
        storedSchema: z.object({ title: z.string(), parentPath: z.string() }),
        readConverter: snapshot => ({ title: (snapshot.data() as Post).title }),
      },
    );
    expect(() => storedPathConverted.collectionGroup()).toThrow(
      /declares a top-level "parentPath"/,
    );

    // The ordinary (non-group) surface of such a repository is untouched.
    expect(() => storedPath.query().where('path', '==', 'x')).not.toThrow();
  });

  it('exposes the effective stored schema on `schemas`, defaulting to the read schema', () => {
    const explicit = FirestoreRepository.withSchema(db, GROUP_ID, postSchema, {
      storedSchema: z.object({ title: z.string() }),
    });
    expect(Object.keys(explicit.schemas!.stored!.shape).sort()).toEqual(['title']);

    // Omitted: the stored model IS the read model (ADR-0018), so that is what it reports.
    const implied = FirestoreRepository.withSchema(db, GROUP_ID, postSchema);
    expect(Object.keys(implied.schemas!.stored!.shape).sort()).toEqual([
      'status',
      'title',
      'views',
    ]);
  });

  it('leaves the single-collection surface untouched', async () => {
    // The repository the group came from still reads only its own collection, ids and all.
    const own = await postsRepo.query().get();
    expect(own.map(row => row.id)).toEqual(['p1']);
    expect(await postsRepo.query().collectionCount()).toBe(1);
    await expect(postsRepo.getByIdOrThrow('p1')).resolves.toMatchObject({ id: 'p1', title: 'A' });
  });
});
