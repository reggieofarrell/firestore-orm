/**
 * Strategy: emulator-backed integration tests for Query Explain (issue #37 / ADR-0031).
 * The Firestore emulator does not return explain metrics today — the Admin SDK throws
 * `Error: No explain results`. Happy-path metrics live in unit mocks; these cases pin the known
 * emulator failure mode for collection, collection-group, and vector builders (D4 / T6).
 *
 * Verification points:
 *  - I-1 / I-2: collection `explain()` / `explain({ analyze: true })` reject with No explain results.
 *  - I-3: collection-group `explain()` wires the same rejection (not a toResult proof — see U-4g).
 *  - I-4: vector `findNearest(…).explain()` rejects the same way.
 *
 * Do NOT assert on indexesUsed / executionStats against the emulator.
 */
import { FieldValue } from 'firebase-admin/firestore';
import { withVectorSearch } from '../../vector/index.js';
import { resetTestFactoryCounters } from '../shared/factories/counters.js';
import {
  createUserRepoHarness,
  createVectorDocRepoHarness,
  VectorDoc,
} from './helpers/firestoreIntegrationHarness.js';
import { FirestoreRepository } from '../../core/FirestoreRepository.js';

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
});

describe('Query explain() vector emulator behavior (issue #37)', () => {
  const harness = createVectorDocRepoHarness();
  const { vectorRepo, cleanupVectorCollections } = harness;

  afterEach(async () => {
    await cleanupVectorCollections();
  });

  it('I-4: vector findNearest().explain() rejects with No explain results', async () => {
    await vectorRepo.create({
      name: 'nearest',
      embedding: FieldValue.vector([1, 0, 0]),
    } as VectorDoc);

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
