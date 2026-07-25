/**
 * Strategy: emulator integration tests for transaction options / read-only / PITR (issue #32).
 *
 * Expectations are pinned to observed emulator behavior (see plan "Emulator + typings: verified"):
 *   1. Read-only reads via getInTransaction succeed and return the mapped document.
 *   2. A write inside a read-only tx is rejected client-side as a plain Error whose message matches
 *      /read-only transactions cannot execute writes/; the document is unmodified afterward.
 *   3. REAL time-travel: write v1 → capture a readTime strictly after the write's updateTime →
 *      write v2 → runReadOnlyAt(T) sees v1. Timing uses snapshot updateTime + poll (not fixed sleeps).
 *   4. Query-shaped PITR + fromSnapshot maps historical rows (the acceptance "ORM mapping helpers
 *      work for PITR reads" path — and the regression guard for a missing fromSnapshot on the RO type).
 *   5. maxAttempts: 1 happy-path smoke (options do not break the commit path).
 *   6. Converter path: schema + readConverter repo applies the converter inside a read-only tx
 *      (getInTransaction AND query-shaped tx.get + fromSnapshot under PITR).
 *
 * Do NOT assert the >60s readTime window — the emulator accepts it; production rejects it absent
 * PITR retention. That divergence is documented, not tested.
 */
import { Timestamp } from 'firebase-admin/firestore';
import { z } from 'zod';
import { FirestoreRepository, ReadConverter } from '../../core/FirestoreRepository.js';
import { createTestUserInput } from '../shared/factories/user.factory.js';
import { resetTestFactoryCounters } from '../shared/factories/counters.js';
import { createUserRepoHarness, getIntegrationDb } from './helpers/firestoreIntegrationHarness.js';

/**
 * Poll until wall-clock `Timestamp.now()` is strictly after `watermark`.
 *
 * PITR acceptance tests need a readTime that is known to be after write v1 (so v1 is visible) and
 * before write v2 (so v2 is not). Fixed `setTimeout(50)` sleeps flake under CI load / coarse clocks;
 * waiting on the write's own `updateTime` makes the ordering deterministic enough for the emulator.
 *
 * @param watermark - Timestamp that must be strictly in the past before this resolves
 * @param label - Short label for the timeout error (which write / which phase)
 * @returns The first `Timestamp.now()` that is strictly after `watermark`
 */
async function waitUntilClockAfter(
  watermark: FirebaseFirestore.Timestamp,
  label: string,
): Promise<FirebaseFirestore.Timestamp> {
  const deadlineMs = Date.now() + 10_000;
  // Small backoff so we do not spin the event loop under a stalled emulator clock.
  let delayMs = 5;
  while (Date.now() < deadlineMs) {
    const now = Timestamp.now();
    if (now.toMillis() > watermark.toMillis()) {
      return now;
    }
    await new Promise(resolve => setTimeout(resolve, delayMs));
    delayMs = Math.min(delayMs * 2, 50);
  }
  throw new Error(
    `Timed out waiting for clock to advance past ${watermark.toDate().toISOString()} (${label})`,
  );
}

/**
 * Capture a PITR `readTime` that is guaranteed to be strictly after every listed document's
 * observed `updateTime`, and leave the clock past that readTime so a subsequent write cannot share
 * the same millisecond.
 *
 * Flow: read raw snapshots → take max updateTime → poll until now > that watermark → return that
 * instant as readTime → poll once more so callers may safely mutate.
 */
async function captureReadTimeAfterDocs(
  db: FirebaseFirestore.Firestore,
  collectionPath: string,
  docIds: string[],
): Promise<FirebaseFirestore.Timestamp> {
  let maxUpdateTime: FirebaseFirestore.Timestamp | null = null;
  for (const id of docIds) {
    const snap = await db.collection(collectionPath).doc(id).get();
    if (!snap.exists || !snap.updateTime) {
      throw new Error(`Expected existing doc ${id} with updateTime before capturing PITR readTime`);
    }
    if (!maxUpdateTime || snap.updateTime.toMillis() > maxUpdateTime.toMillis()) {
      maxUpdateTime = snap.updateTime;
    }
  }
  if (!maxUpdateTime) {
    throw new Error('captureReadTimeAfterDocs requires at least one document id');
  }

  // readTime must be strictly after the last write's updateTime so the snapshot includes those docs.
  const readTime = await waitUntilClockAfter(maxUpdateTime, 'post-write watermark');
  // Ensure the captured readTime itself is already in the past before the caller writes v2 —
  // otherwise v2 can commit at the same millisecond and become visible under that readTime.
  await waitUntilClockAfter(readTime, 'pre-mutation margin after readTime');
  return readTime;
}

describe('FirestoreRepository transaction options (issue #32)', () => {
  const harness = createUserRepoHarness('test_users_tx_options');
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

  it('read-only transaction reads a document via getInTransaction', async () => {
    const created = await userRepo.create(createTestUserInput({ name: 'RO Read' }));
    trackUser(created.id);

    const read = await userRepo.runInTransaction(
      async (tx, repo) => repo.getInTransaction(tx, created.id),
      { readOnly: true },
    );

    expect(read?.id).toBe(created.id);
    expect(read?.name).toBe('RO Read');
  });

  it('write inside a read-only transaction is rejected and leaves the document unchanged', async () => {
    const created = await userRepo.create(createTestUserInput({ name: 'RO Guard' }));
    trackUser(created.id);

    await expect(
      userRepo.runInTransaction(
        async (tx, repo) => {
          // Bypass the typed surface deliberately: the SDK (not the ORM) is what rejects the write.
          // Use the raw transaction handle so the runtime path is exercised regardless of typing.
          // Prefer the callback repo's getCollectionPath (RO membership) over the outer repo.
          const ref = db.collection(repo.getCollectionPath()).doc(created.id);
          tx.set(ref, { name: 'mutated' }, { merge: true });
        },
        { readOnly: true },
      ),
    ).rejects.toThrow(/read-only transactions cannot execute writes/i);

    // Document must be unmodified — the rejection is client-side before commit.
    const after = await userRepo.getById(created.id);
    expect(after?.name).toBe('RO Guard');
  });

  it('runReadOnlyAt time-travels: callback sees the pre-write version', async () => {
    // Write v1 → capture readTime from updateTime watermark → write v2 → read at T must return v1.
    const created = await userRepo.create(
      createTestUserInput({ name: 'PITR', profile: { bio: 'before' } }),
    );
    trackUser(created.id);

    const readTime = await captureReadTimeAfterDocs(db, userRepo.getCollectionPath(), [created.id]);

    await userRepo.update(created.id, { 'profile.bio': 'after' });

    const historical = await userRepo.runReadOnlyAt(readTime, async (tx, repo) => {
      return repo.getInTransaction(tx, created.id);
    });

    expect(historical?.profile?.bio).toBe('before');

    // Sanity: a normal read sees the current value.
    const current = await userRepo.getById(created.id);
    expect(current?.profile?.bio).toBe('after');
  });

  it('query-shaped PITR + fromSnapshot maps historical rows', async () => {
    const a = await userRepo.create(
      createTestUserInput({ name: 'Alice', profile: { bio: 'v1', verified: true } }),
    );
    const b = await userRepo.create(
      createTestUserInput({ name: 'Bob', profile: { bio: 'v1', verified: true } }),
    );
    trackUser(a.id);
    trackUser(b.id);

    const readTime = await captureReadTimeAfterDocs(db, userRepo.getCollectionPath(), [a.id, b.id]);

    // Mutate both after the snapshot so a current query would see different bios.
    await userRepo.update(a.id, { 'profile.bio': 'v2' });
    await userRepo.update(b.id, { 'profile.bio': 'v2' });

    const rows = await userRepo.runReadOnlyAt(readTime, async (tx, repo) => {
      // Escape hatch: tx.get(query) + fromSnapshot — the only mapping route for query-shaped PITR.
      // Build the collection ref from the callback repo (getCollectionPath is on the RO surface).
      const snap = await tx.get(
        db.collection(repo.getCollectionPath()).where('profile.verified', '==', true),
      );
      return snap.docs.map(d => repo.fromSnapshot(d));
    });

    const byId = new Map(rows.filter(Boolean).map(r => [r!.id, r!]));
    expect(byId.get(a.id)?.profile?.bio).toBe('v1');
    expect(byId.get(b.id)?.profile?.bio).toBe('v1');
    expect(byId.get(a.id)?.name).toBe('Alice');
    expect(byId.get(b.id)?.name).toBe('Bob');
  });

  it('runInTransaction with maxAttempts: 1 succeeds on the happy path', async () => {
    const created = await userRepo.runInTransaction(
      async (tx, repo) => {
        return repo.createInTransaction(tx, createTestUserInput({ name: 'MaxAttempts' }));
      },
      { maxAttempts: 1 },
    );
    trackUser(created.id);

    const fetched = await userRepo.getById(created.id);
    expect(fetched?.name).toBe('MaxAttempts');
  });
});

describe('FirestoreRepository read-only tx + converter (issue #32)', () => {
  const db = getIntegrationDb();
  const COLLECTION = `test_tx_options_converter_${Date.now()}`;

  interface WidgetDoc {
    name: string;
    value: number;
  }

  const widgetSchema = z.object({
    name: z.string().min(1),
    value: z.number(),
  });

  // Uppercase name on read — proves the converter ran inside the read-only transaction path.
  const readConverter: ReadConverter<WidgetDoc> = snapshot => {
    const data = snapshot.data();
    return { ...data, name: String(data.name).toUpperCase() } as WidgetDoc;
  };

  const repo = FirestoreRepository.withSchema(db, COLLECTION, widgetSchema, {
    readConverter,
    storedSchema: widgetSchema,
  });

  afterAll(async () => {
    const docs = await repo.query().get();
    if (docs.length > 0) {
      await repo.bulkDelete(docs.map(doc => doc.id));
    }
  });

  it('read-only getInTransaction applies the readConverter', async () => {
    const created = await repo.create({ name: 'widget', value: 9 });

    const read = await repo.runInTransaction(
      async (tx, txRepo) => txRepo.getInTransaction(tx, created.id),
      { readOnly: true },
    );

    expect(read?.name).toBe('WIDGET');
    expect(read?.value).toBe(9);
  });

  it('PITR query + fromSnapshot applies the readConverter to historical rows', async () => {
    // Acceptance path 2: schema + readConverter, mutate after readTime, tx.get(query) + fromSnapshot
    // must return the converted historical shape (not the post-mutation value, and not raw casing).
    const created = await repo.create({ name: 'gadget', value: 1 });

    const readTime = await captureReadTimeAfterDocs(db, COLLECTION, [created.id]);

    await repo.update(created.id, { name: 'gadget-v2', value: 2 });

    const rows = await repo.runReadOnlyAt(readTime, async (tx, txRepo) => {
      const snap = await tx.get(db.collection(COLLECTION).where('value', '==', 1));
      return snap.docs.map(d => txRepo.fromSnapshot(d));
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(created.id);
    // Converter uppercases name; historical value must still be 1 (pre-mutation).
    expect(rows[0]?.name).toBe('GADGET');
    expect(rows[0]?.value).toBe(1);

    // Sanity: live read sees the mutated converted shape.
    const current = await repo.getById(created.id);
    expect(current?.name).toBe('GADGET-V2');
    expect(current?.value).toBe(2);
  });
});
