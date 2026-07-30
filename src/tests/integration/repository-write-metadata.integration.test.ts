/**
 * Strategy: emulator integration coverage for opt-in `{ withMetadata: true }` on non-transactional
 * repository writes (issue #72, ADR-0037).
 *
 * Verification points (plan §8.2):
 *  - I-1: create (auto-id), createWithId, update, patch, both upsert branches return id + Timestamp
 *  - I-2: defaults keep `{id}` / `void`; returnDoc still returns only the converted doc (no writeTime)
 *  - I-3: fixed-batch helpers return positional ids/timestamps
 *  - I-4: 501-entry fixed batch returns 501 ordered timestamps and writes both chunk edges
 *  - I-5: bulkDelete metadata count/timestamps only for existing docs (no invented missing-id receipt)
 *  - I-6: JS-shaped `{ returnDoc: true, withMetadata: true }` rejects before write
 */
import { Timestamp } from 'firebase-admin/firestore';
import { FirestoreRepository } from '../../core/FirestoreRepository.js';
import { createUserRepoHarness, getIntegrationDb } from './helpers/firestoreIntegrationHarness.js';

describe('repository write metadata (issue #72)', () => {
  const harness = createUserRepoHarness('test_users_write_metadata');
  const { userRepo, trackUser, cleanupTrackedUsers, cleanupCollection } = harness;

  afterEach(async () => {
    await cleanupTrackedUsers();
  });

  afterAll(async () => {
    await cleanupCollection();
  });

  it('I-1: direct writes return id plus Timestamp writeTime', async () => {
    const created = await userRepo.create(
      { name: 'Write Meta Create', email: 'wm-create@example.com' },
      { withMetadata: true },
    );
    trackUser(created.id);
    expect(created.id).toEqual(expect.any(String));
    expect(created.writeTime).toBeInstanceOf(Timestamp);
    expect((await userRepo.getById(created.id))?.name).toBe('Write Meta Create');

    const withId = await userRepo.createWithId(
      `wm-explicit-${Date.now()}`,
      { name: 'Write Meta Explicit', email: 'wm-explicit@example.com' },
      { withMetadata: true },
    );
    trackUser(withId.id);
    expect(withId.writeTime).toBeInstanceOf(Timestamp);

    const updated = await userRepo.update(
      created.id,
      { name: 'Write Meta Updated' },
      { withMetadata: true },
    );
    expect(updated.id).toBe(created.id);
    expect(updated.writeTime).toBeInstanceOf(Timestamp);

    const patched = await userRepo.patch(
      created.id,
      { email: 'wm-patched@example.com' },
      { withMetadata: true },
    );
    expect(patched.id).toBe(created.id);
    expect(patched.writeTime).toBeInstanceOf(Timestamp);

    // Upsert update branch (document already exists).
    const upsertUpdate = await userRepo.upsert(
      created.id,
      { name: 'Write Meta Upsert Update', email: 'wm-upsert-u@example.com' },
      { withMetadata: true },
    );
    expect(upsertUpdate.id).toBe(created.id);
    expect(upsertUpdate.writeTime).toBeInstanceOf(Timestamp);

    // Upsert create branch (new id).
    const upsertCreateId = `wm-upsert-create-${Date.now()}`;
    const upsertCreate = await userRepo.upsert(
      upsertCreateId,
      { name: 'Write Meta Upsert Create', email: 'wm-upsert-c@example.com' },
      { withMetadata: true },
    );
    trackUser(upsertCreate.id);
    expect(upsertCreate.id).toBe(upsertCreateId);
    expect(upsertCreate.writeTime).toBeInstanceOf(Timestamp);

    const deleted = await userRepo.delete(withId.id, { withMetadata: true });
    expect(deleted.writeTime).toBeInstanceOf(Timestamp);
  });

  it('I-2: defaults and returnDoc keep legacy shapes without writeTime', async () => {
    const created = await userRepo.create({ name: 'Legacy Shape', email: 'legacy@example.com' });
    trackUser(created.id);
    expect(created).toEqual({ id: created.id });
    expect('writeTime' in created).toBe(false);

    const withId = await userRepo.createWithId(`wm-legacy-id-${Date.now()}`, {
      name: 'Legacy WithId',
      email: 'legacy-id@example.com',
    });
    trackUser(withId.id);
    expect(withId).toEqual({ id: withId.id });
    expect('writeTime' in withId).toBe(false);

    const doc = await userRepo.create(
      { name: 'Return Doc', email: 'return-doc@example.com' },
      { returnDoc: true },
    );
    trackUser(doc.id);
    expect(doc.name).toBe('Return Doc');
    expect('writeTime' in doc).toBe(false);

    const updated = await userRepo.update(created.id, { name: 'Legacy Updated' });
    expect(updated).toEqual({ id: created.id });
    expect('writeTime' in updated).toBe(false);

    const patched = await userRepo.patch(created.id, { email: 'legacy-patched@example.com' });
    expect(patched).toEqual({ id: created.id });
    expect('writeTime' in patched).toBe(false);

    const upserted = await userRepo.upsert(created.id, {
      name: 'Legacy Upsert',
      email: 'legacy-upsert@example.com',
    });
    expect(upserted).toEqual({ id: created.id });
    expect('writeTime' in upserted).toBe(false);

    const bulk = await userRepo.bulkCreate([
      { name: 'Legacy Bulk', email: 'legacy-bulk@example.com' },
    ]);
    bulk.forEach(row => trackUser(row.id));
    expect(bulk[0]).toEqual({ id: bulk[0]!.id });
    expect('writeTime' in bulk[0]!).toBe(false);

    await expect(userRepo.delete(created.id)).resolves.toBeUndefined();
  });

  it('I-3: fixed batches return positional ids and timestamps', async () => {
    const created = await userRepo.bulkCreate(
      [
        { name: 'Bulk A', email: 'bulk-a@example.com' },
        { name: 'Bulk B', email: 'bulk-b@example.com' },
      ],
      { withMetadata: true },
    );
    created.forEach(row => trackUser(row.id));
    expect(created).toHaveLength(2);
    expect(created[0]!.writeTime).toBeInstanceOf(Timestamp);
    expect(created[1]!.writeTime).toBeInstanceOf(Timestamp);
    expect((await userRepo.getById(created[0]!.id))?.name).toBe('Bulk A');
    expect((await userRepo.getById(created[1]!.id))?.name).toBe('Bulk B');

    const explicitIds = [`wm-bulk-id-a-${Date.now()}`, `wm-bulk-id-b-${Date.now()}`];
    const createdIds = await userRepo.bulkCreateWithIds(
      [
        { id: explicitIds[0]!, data: { name: 'Bulk Id A', email: 'bulk-id-a@example.com' } },
        { id: explicitIds[1]!, data: { name: 'Bulk Id B', email: 'bulk-id-b@example.com' } },
      ],
      { withMetadata: true },
    );
    createdIds.forEach(row => trackUser(row.id));
    expect(createdIds.map(row => row.id)).toEqual(explicitIds);
    expect(createdIds.every(row => row.writeTime instanceof Timestamp)).toBe(true);

    const updated = await userRepo.bulkUpdate(
      [
        { id: created[0]!.id, data: { name: 'Bulk A Updated' } },
        { id: created[1]!.id, data: { name: 'Bulk B Updated' } },
      ],
      { withMetadata: true },
    );
    expect(updated.map(row => row.id)).toEqual([created[0]!.id, created[1]!.id]);
    expect(updated.every(row => row.writeTime instanceof Timestamp)).toBe(true);

    const patched = await userRepo.bulkPatch(
      [
        { id: created[0]!.id, data: { email: 'bulk-a-patched@example.com' } },
        { id: created[1]!.id, data: { email: 'bulk-b-patched@example.com' } },
      ],
      { withMetadata: true },
    );
    expect(patched.map(row => row.id)).toEqual([created[0]!.id, created[1]!.id]);
    expect(patched.every(row => row.writeTime instanceof Timestamp)).toBe(true);
  });

  it('I-4: 501-entry fixed batch preserves ordered receipts across chunks', async () => {
    // Dedicated collection so recursiveDelete can wipe the 501 docs without competing with harness
    // tracking (plan §8.2).
    const db = getIntegrationDb();
    const collectionName = `test_users_write_metadata_501_${Date.now()}`;
    const bigRepo = new FirestoreRepository<{ name: string; email?: string }>(db, collectionName);

    try {
      const rows = Array.from({ length: 501 }, (_, index) => ({
        name: `Chunk User ${index}`,
        email: `chunk-${index}@example.com`,
      }));
      const receipts = await bigRepo.bulkCreate(rows, { withMetadata: true });
      expect(receipts).toHaveLength(501);
      expect(receipts.every(row => row.writeTime instanceof Timestamp)).toBe(true);
      expect(receipts[0]!.id).toEqual(expect.any(String));
      expect(receipts[500]!.id).toEqual(expect.any(String));

      // Both chunk edges must exist: index 0 (first chunk) and index 500 (second chunk).
      expect((await bigRepo.getById(receipts[0]!.id))?.name).toBe('Chunk User 0');
      expect((await bigRepo.getById(receipts[500]!.id))?.name).toBe('Chunk User 500');
    } finally {
      await db.recursiveDelete(db.collection(collectionName));
    }
  });

  it('I-5: bulkDelete metadata covers only surviving documents', async () => {
    const a = await userRepo.create({ name: 'Delete A', email: 'del-a@example.com' });
    const b = await userRepo.create({ name: 'Delete B', email: 'del-b@example.com' });
    trackUser(a.id);
    trackUser(b.id);

    const missingId = `wm-missing-delete-${Date.now()}`;
    const result = await userRepo.bulkDelete([a.id, missingId, b.id], { withMetadata: true });

    expect(result.count).toBe(2);
    expect(result.writeTimes).toHaveLength(2);
    expect(result.writeTimes.every(time => time instanceof Timestamp)).toBe(true);
    expect(await userRepo.getById(a.id)).toBeNull();
    expect(await userRepo.getById(b.id)).toBeNull();
  });

  it('I-6: combined returnDoc + withMetadata rejects before write', async () => {
    const before = await userRepo.query().count();
    const ambiguous = { returnDoc: true, withMetadata: true };

    await expect(
      // JavaScript-shaped call that bypasses overload exclusion.
      (userRepo as any).create(
        { name: 'Should Not Persist', email: 'reject-combo@example.com' },
        ambiguous,
      ),
    ).rejects.toThrow(/mutually exclusive/i);

    // F1 regression: patch used to forward returnDoc alone and silently drop withMetadata.
    await expect(
      (userRepo as any).patch(
        'wm-patch-reject-id',
        { email: 'reject-patch@example.com' },
        ambiguous,
      ),
    ).rejects.toThrow(/mutually exclusive/i);

    await expect(
      (userRepo as any).update(
        'wm-update-reject-id',
        { name: 'Should Not Persist Update' },
        ambiguous,
      ),
    ).rejects.toThrow(/mutually exclusive/i);

    await expect(
      (userRepo as any).upsert(
        'wm-upsert-reject-id',
        { name: 'Should Not Persist Upsert', email: 'reject-upsert@example.com' },
        ambiguous,
      ),
    ).rejects.toThrow(/mutually exclusive/i);

    const after = await userRepo.query().count();
    expect(after).toBe(before);
  });
});
