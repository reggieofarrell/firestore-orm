/**
 * Strategy: emulator-backed integration tests for Query Explain (issue #37 / ADR-0031) and
 * explainStream (issue #65 / ADR-0036). The Firestore emulator does not return explain metrics for
 * `explain()` — the Admin SDK throws `Error: No explain results`. Happy-path metrics live in unit
 * mocks. Emulator `explainStream({ analyze: true })` yields **document chunks without metrics**
 * (P2 / T3) — I-stream cases assert mapping + absent metrics; they do NOT claim production
 * diagnostics.
 *
 * Verification points:
 *  - I-1 / I-2: collection `explain()` / `explain({ analyze: true })` reject with No explain results.
 *  - I-3: collection-group `explain()` wires the same rejection (not a toResult proof — see U-4g).
 *  - I-4: vector `findNearest(…).explain()` rejects the same way — **without seeding** into the
 *    shared `test_vectors` harness collection (parallel Jest workers otherwise race
 *    `vector-search.integration.test.ts` and can leave a second identical `[1,0,0]` "nearest"
 *    document that breaks KNN order assertions — review B2).
 *  - I-stream-1 / I-stream-2: collection / unique-group analyze stream map identity and have no
 *    metrics; finally cleanup.
 *
 * Do NOT assert on indexesUsed / executionStats against the emulator.
 */
import { resetTestFactoryCounters } from '../shared/factories/counters.js';
import {
  createUserRepoHarness,
  createVectorDocRepoHarness,
} from './helpers/firestoreIntegrationHarness.js';
import { FirestoreRepository } from '../../core/FirestoreRepository.js';
import { withVectorSearch } from '../../vector/index.js';

describe('Query explain() emulator behavior (issue #37)', () => {
  const harness = createUserRepoHarness('test_users_query_explain');
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

  it('I-1: collection explain() rejects with No explain results', async () => {
    const created = await userRepo.create({ name: 'explain-seed' });
    trackUser(created.id);

    await expect(userRepo.query().where('name', '==', 'explain-seed').explain()).rejects.toThrow(
      /No explain results/,
    );
  });

  it('I-2: collection explain({ analyze: true }) rejects with No explain results', async () => {
    const created = await userRepo.create({ name: 'explain-analyze' });
    trackUser(created.id);

    await expect(
      userRepo.query().where('name', '==', 'explain-analyze').explain({ analyze: true }),
    ).rejects.toThrow(/No explain results/);
  });

  it('I-3: collection-group explain() rejects with No explain results', async () => {
    // Unique group id so this test does not collide with other collection-group suites.
    const run = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const groupId = `posts_explain_${run}`;
    const users = `users_explain_${run}`;
    const docPath = `${users}/u1/${groupId}/p1`;
    await db.doc(docPath).set({ title: 'g1' });

    try {
      const postsRepo = new FirestoreRepository<{ title: string }>(db, `${users}/u1/${groupId}`);
      const group = postsRepo.collectionGroup();
      await expect(group.query().explain()).rejects.toThrow(/No explain results/);
    } finally {
      await db.doc(docPath).delete();
    }
  });

  it('I-stream-1: collection explainStream({ analyze: true }) maps id/data and has no metrics', async () => {
    // P2 / T3: emulator yields document chunks without a metrics chunk. Assert mapping + absence —
    // never claim production diagnostics here.
    const created = await userRepo.create({ name: 'explain-stream-seed' });
    trackUser(created.id);

    const chunks: Array<{ document?: { id: string; name?: string }; metrics?: unknown }> = [];
    for await (const chunk of userRepo
      .query()
      .where('name', '==', 'explain-stream-seed')
      .explainStream({ analyze: true })) {
      chunks.push(chunk);
    }

    expect(chunks.length).toBeGreaterThanOrEqual(1);
    const docChunks = chunks.filter(c => c.document !== undefined);
    expect(docChunks.some(c => c.document?.id === created.id)).toBe(true);
    expect(docChunks.find(c => c.document?.id === created.id)?.document?.name).toBe(
      'explain-stream-seed',
    );
    // Hard-pin: no metrics own-property (not merely undefined value — §6 forbids explicit undefined).
    expect(chunks.every(c => !Object.prototype.hasOwnProperty.call(c, 'metrics'))).toBe(true);
  });

  it('I-stream-2: unique-group explainStream maps path/parentPath and has no metrics', async () => {
    const run = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const groupId = `posts_explain_stream_${run}`;
    const users = `users_explain_stream_${run}`;
    const docPath = `${users}/u1/${groupId}/p1`;
    await db.doc(docPath).set({ title: 'stream-g1' });

    const chunks: Array<{
      document?: { id: string; title?: string; path?: string; parentPath?: string };
      metrics?: unknown;
    }> = [];
    try {
      const postsRepo = new FirestoreRepository<{ title: string }>(db, `${users}/u1/${groupId}`);
      const group = postsRepo.collectionGroup();
      for await (const chunk of group.query().explainStream({ analyze: true })) {
        chunks.push(chunk);
      }

      expect(chunks.length).toBeGreaterThanOrEqual(1);
      const mapped = chunks.find(c => c.document?.id === 'p1');
      expect(mapped?.document).toEqual({
        title: 'stream-g1',
        id: 'p1',
        path: docPath,
        parentPath: `${users}/u1/${groupId}`,
      });
      expect(chunks.every(c => !Object.prototype.hasOwnProperty.call(c, 'metrics'))).toBe(true);
    } finally {
      await db.doc(docPath).delete();
    }
  });
});

describe('Query explain() vector emulator behavior (issue #37)', () => {
  const harness = createVectorDocRepoHarness();
  const { vectorRepo, cleanupVectorCollections } = harness;

  afterEach(async () => {
    await cleanupVectorCollections();
  });

  it('I-4: vector findNearest().explain() rejects with No explain results', async () => {
    // Do NOT seed into the shared `test_vectors` collection. Jest runs integration files in
    // parallel; a seeded `[1,0,0]` "nearest" races `vector-search.integration.test.ts`'s
    // seedBasicVectors and can make findNearest(limit: 2) return two "nearest" rows (B2).
    // The emulator throws `No explain results` for VectorQuery.explain with or without docs
    // (verified empty-collection probe) — seeding adds nothing to this assertion.
    const wrapped = withVectorSearch(vectorRepo);
    await expect(
      wrapped
        .vectorQuery()
        .findNearest({
          vectorField: 'embedding',
          queryVector: [1, 0, 0],
          limit: 1,
          distanceMeasure: 'EUCLIDEAN',
        })
        .explain(),
    ).rejects.toThrow(/No explain results/);
  });
});
