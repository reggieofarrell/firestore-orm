/**
 * Strategy: emulator-backed integration tests for typed query bounds (`startAt` / `startAfter` /
 * `endAt` / `endBefore`), `offset`, and `limitToLast` on `FirestoreQueryBuilderBase` (issue #36).
 *
 * Verification points:
 *  - Inclusive / exclusive field-value and DocumentSnapshot bounds match Admin SDK semantics.
 *  - Bounded inclusive ranges and reverse pages (`endAt` + `limitToLast`) work end-to-end.
 *  - Local guards: `limitToLast` requires `orderBy`; `stream` / `paginate` / `offsetPaginate` reject
 *    `limitToLast`; `offset` / `limitToLast` reject negatives; `limit` after `limitToLast` clears the
 *    stream guard; `select()` copies `hasLimitToLast` so a projected builder still rejects stream.
 *  - Collection-group builders inherit the same surface (methods live on the base).
 *  - `onSnapshot` after `limitToLast` is legal (unlike `stream`).
 */
import type { Firestore } from 'firebase-admin/firestore';
import { z } from 'zod';
import { FirestoreRepository } from '../../core/FirestoreRepository.js';
import { resetTestFactoryCounters } from '../shared/factories/counters.js';
import { createUserRepoHarness, getIntegrationDb } from './helpers/firestoreIntegrationHarness.js';

type ScoreDoc = {
  id: string;
  name: string;
  score: number;
};

describe('Query bounds + limitToLast (issue #36)', () => {
  const harness = createUserRepoHarness('test_users_query_bounds');
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
   * Seeds five docs with scores 10..50 (names a..e), mirroring the plan probe seed so expected
   * inclusive/exclusive sets stay aligned with §3 observations.
   */
  async function seedScores(): Promise<ScoreDoc[]> {
    const items = await userRepo.bulkCreate(
      [
        { name: 'a', score: 10 },
        { name: 'b', score: 20 },
        { name: 'c', score: 30 },
        { name: 'd', score: 40 },
        { name: 'e', score: 50 },
      ] as any[],
      { returnDoc: true },
    );
    items.forEach(item => trackUser(item.id));
    return items as ScoreDoc[];
  }

  /** Reads a raw Admin SDK DocumentSnapshot for the snapshot-overload cases. */
  async function snapshotFor(id: string) {
    return db.collection(userRepo.getCollectionPath()).doc(id).get();
  }

  function names(rows: Array<{ name?: string }>): string[] {
    return rows.map(row => row.name as string);
  }

  // -------------------------------------------------------------------------
  // Inclusive / exclusive bounds and ranges
  // -------------------------------------------------------------------------

  it('I-1: startAt(fieldValue) is inclusive', async () => {
    await seedScores();
    const rows = await userRepo.query().orderBy('score', 'asc').startAt(30).get();
    expect(names(rows)).toEqual(['c', 'd', 'e']);
  });

  it('I-2: startAfter / endAt / endBefore exclusive and inclusive semantics', async () => {
    await seedScores();

    const after = await userRepo.query().orderBy('score', 'asc').startAfter(30).get();
    expect(names(after)).toEqual(['d', 'e']);

    const endAt = await userRepo.query().orderBy('score', 'asc').endAt(30).get();
    expect(names(endAt)).toEqual(['a', 'b', 'c']);

    const endBefore = await userRepo.query().orderBy('score', 'asc').endBefore(30).get();
    expect(names(endBefore)).toEqual(['a', 'b']);
  });

  it('I-3: startAt(low).endAt(high) is a bounded inclusive range', async () => {
    await seedScores();
    const rows = await userRepo.query().orderBy('score', 'asc').startAt(20).endAt(40).get();
    expect(names(rows)).toEqual(['b', 'c', 'd']);
  });

  it('I-4: DocumentSnapshot overloads match field-value bounds', async () => {
    const seeded = await seedScores();
    const mid = seeded.find(doc => doc.name === 'c')!;
    const snap = await snapshotFor(mid.id);

    const startAt = await userRepo.query().orderBy('score', 'asc').startAt(snap).get();
    expect(names(startAt)).toEqual(['c', 'd', 'e']);

    const startAfter = await userRepo.query().orderBy('score', 'asc').startAfter(snap).get();
    expect(names(startAfter)).toEqual(['d', 'e']);

    const endAt = await userRepo.query().orderBy('score', 'asc').endAt(snap).get();
    expect(names(endAt)).toEqual(['a', 'b', 'c']);

    const endBefore = await userRepo.query().orderBy('score', 'asc').endBefore(snap).get();
    expect(names(endBefore)).toEqual(['a', 'b']);
  });

  // -------------------------------------------------------------------------
  // limitToLast + reverse pagination
  // -------------------------------------------------------------------------

  it('I-5: limitToLast(n) returns the last n docs in orderBy order', async () => {
    await seedScores();
    const rows = await userRepo.query().orderBy('score', 'asc').limitToLast(2).get();
    expect(names(rows)).toEqual(['d', 'e']);
    expect(rows.map(row => (row as ScoreDoc).score)).toEqual([40, 50]);
  });

  it('I-6: endAt(cursor).limitToLast(n) is a reverse page ending at the bound', async () => {
    await seedScores();
    const rows = await userRepo.query().orderBy('score', 'asc').endAt(40).limitToLast(2).get();
    expect(names(rows)).toEqual(['c', 'd']);
  });

  it('I-7: limitToLast without orderBy throws locally', async () => {
    expect(() => userRepo.query().limitToLast(2)).toThrow(
      /limitToLast\(\) requires at least one orderBy\(\) call/,
    );
  });

  it('I-8: limitToLast then stream() throws locally', async () => {
    await seedScores();
    const builder = userRepo.query().orderBy('score', 'asc').limitToLast(2);

    const iterate = async () => {
      for await (const _row of builder.stream()) {
        // drain
      }
    };
    await expect(iterate()).rejects.toThrow(/stream\(\) is not supported after limitToLast/);
  });

  it('I-9: limitToLast then paginate / offsetPaginate throw', async () => {
    await seedScores();
    const builder = userRepo.query().orderBy('score', 'asc').limitToLast(2);

    await expect(builder.paginate(2)).rejects.toThrow(
      /paginate\(\) cannot be used after limitToLast/,
    );
    await expect(
      userRepo.query().orderBy('score', 'asc').limitToLast(2).offsetPaginate(1, 2),
    ).rejects.toThrow(/offsetPaginate\(\) cannot be used after limitToLast/);
  });

  it('I-10: offset(0) is allowed; offset(-1) throws locally', async () => {
    await seedScores();

    const page = await userRepo.query().orderBy('score', 'asc').offset(0).limit(2).get();
    expect(names(page)).toEqual(['a', 'b']);

    expect(() => userRepo.query().offset(-1)).toThrow(
      /offset must be a non-negative integer \(received -1\)/,
    );
  });

  it('I-11: limitToLast then limit clears the stream guard (SDK last-wins)', async () => {
    await seedScores();
    const streamed: string[] = [];
    for await (const row of userRepo
      .query()
      .orderBy('score', 'asc')
      .limitToLast(2)
      .limit(3)
      .stream()) {
      streamed.push((row as ScoreDoc).name);
    }
    expect(streamed).toEqual(['a', 'b', 'c']);
  });

  it('I-12: select() copies hasLimitToLast so stream() still rejects', async () => {
    await seedScores();
    const builder = userRepo.query().orderBy('score', 'asc').limitToLast(2).select('name');

    const iterate = async () => {
      for await (const _row of builder.stream()) {
        // drain
      }
    };
    await expect(iterate()).rejects.toThrow(/stream\(\) is not supported after limitToLast/);
  });

  it('I-14: onSnapshot after limitToLast delivers results', async () => {
    await seedScores();
    const emissions: string[][] = [];
    let unsubscribe: () => void = () => {};

    // Wait for the first listener emission rather than a bare sleep — avoids CI flake under load.
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('onSnapshot timed out waiting for emission')),
        5000,
      );
      void userRepo
        .query()
        .orderBy('score', 'asc')
        .limitToLast(2)
        .onSnapshot(rows => {
          emissions.push(names(rows));
          clearTimeout(timer);
          resolve();
        })
        .then(unsub => {
          unsubscribe = unsub;
        }, reject);
    });

    unsubscribe();

    expect(emissions.length).toBeGreaterThanOrEqual(1);
    expect(emissions[emissions.length - 1]).toEqual(['d', 'e']);
  });

  it('I-15: limitToLast(0) returns an empty page; paginateWithCount rejects limitToLast', async () => {
    await seedScores();
    const empty = await userRepo.query().orderBy('score', 'asc').limitToLast(0).get();
    expect(empty).toEqual([]);

    await expect(
      userRepo.query().orderBy('score', 'asc').limitToLast(2).paginateWithCount(2),
    ).rejects.toThrow(/paginate\(\) cannot be used after limitToLast/);
  });

  it('I-16: collection startAfter(foreign snapshot) throws (emulator F7)', async () => {
    await seedScores();
    const foreignPath = `foreign_bounds_${Date.now()}/x`;
    await db.doc(foreignPath).set({ name: 'x', score: 30 });
    try {
      const foreignSnap = await db.doc(foreignPath).get();
      // The Admin SDK rejects a single-collection foreign snapshot synchronously in startAfter(),
      // before get() — assert the local builder call throws with the SDK membership message.
      expect(() => userRepo.query().orderBy('score', 'asc').startAfter(foreignSnap)).toThrow(
        /not part of the query result set/i,
      );
    } finally {
      await db.doc(foreignPath).delete();
    }
  });
});

describe('Query bounds on collection groups (issue #36 / I-13)', () => {
  const db: Firestore = getIntegrationDb();
  const RUN = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const GROUP_ID = `cg_bounds_${RUN}`;
  const USERS = `cg_bounds_users_${RUN}`;
  const OTHER_ID = `cg_bounds_other_${RUN}`;

  const postSchema = z.object({
    title: z.string(),
    score: z.number(),
  });

  const postsRepo = FirestoreRepository.withSchema(db, `${USERS}/u1/${GROUP_ID}`, postSchema);
  const postGroup = postsRepo.collectionGroup();

  const seeded = {
    u1a: `${USERS}/u1/${GROUP_ID}/a`,
    u2b: `${USERS}/u2/${GROUP_ID}/b`,
    u2c: `${USERS}/u2/${GROUP_ID}/c`,
    root: `${GROUP_ID}/root`,
    outsider: `${USERS}/u1/${OTHER_ID}/n1`,
  };

  beforeAll(async () => {
    await Promise.all([
      db.doc(seeded.u1a).set({ title: 'a', score: 10 }),
      db.doc(seeded.u2b).set({ title: 'b', score: 20 }),
      db.doc(seeded.u2c).set({ title: 'c', score: 30 }),
      db.doc(seeded.root).set({ title: 'r', score: 40 }),
      db.doc(seeded.outsider).set({ title: 'n', score: 25 }),
    ]);
  });

  afterAll(async () => {
    const batch = db.batch();
    Object.values(seeded).forEach(path => batch.delete(db.doc(path)));
    await batch.commit();
  });

  it('I-13: collection-group builder supports orderBy + startAt + limitToLast', async () => {
    const ranged = await postGroup.query().orderBy('score', 'asc').startAt(20).get();
    expect(ranged.map(row => row.title)).toEqual(['b', 'c', 'r']);

    const lastTwo = await postGroup.query().orderBy('score', 'asc').limitToLast(2).get();
    expect(lastTwo.map(row => row.title)).toEqual(['c', 'r']);

    // orderByPath sets hasOrderBy, so the local limitToLast(orderBy) guard accepts it. Do not
    // execute get() here: the emulator rejects some documentId + limitToLast scans with
    // FAILED_PRECONDITION ("does not support descending key scans") even for asc — that is an
    // SDK/emulator constraint, not an ORM guard regression.
    expect(() => postGroup.query().orderByPath('asc').limitToLast(1)).not.toThrow();
  });

  it('I-13b: group select() copies hasLimitToLast so stream() still rejects', async () => {
    const builder = postGroup.query().orderBy('score', 'asc').limitToLast(2).select('title');
    const iterate = async () => {
      for await (const _row of builder.stream()) {
        // drain
      }
    };
    await expect(iterate()).rejects.toThrow(/stream\(\) is not supported after limitToLast/);
  });

  it('I-17: group startAfter(foreign snap) uses orderBy field values (emulator F2 shape)', async () => {
    // Typed snapshot bounds are NOT membership-checked (D7). On a group, a foreign snapshot is
    // accepted and its orderBy field values drive the cursor. A foreign doc with score beyond the
    // set yields empty (probe F2 used score:99); a mid-range score acts like startAfter(that score).
    const highForeign = `${USERS}/u1/${OTHER_ID}/high`;
    await db.doc(highForeign).set({ title: 'high', score: 99 });
    try {
      const highSnap = await db.doc(highForeign).get();
      const empty = await postGroup.query().orderBy('score', 'asc').startAfter(highSnap).get();
      expect(empty).toEqual([]);

      const midSnap = await db.doc(seeded.outsider).get(); // score: 25
      const afterMid = await postGroup.query().orderBy('score', 'asc').startAfter(midSnap).get();
      expect(afterMid.map(row => row.title)).toEqual(['c', 'r']);
    } finally {
      await db.doc(highForeign).delete();
    }
  });
});
