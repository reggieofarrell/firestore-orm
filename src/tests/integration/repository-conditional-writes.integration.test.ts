/**
 * Strategy: emulator integration tests for conditional writes (issue #33).
 *
 * The two ACCEPTANCE flows come first and are written the way the issue describes them, end to end:
 *   1. create-only — `createWithId` claims an id; a second claim rejects with `ConflictError` and the
 *      first write survives byte-for-byte;
 *   2. precondition-guarded read-modify-write — `getByIdWithUpdateTime` → out-of-band mutation →
 *      the guarded `update` rejects with `PreconditionFailedError`, the other writer's value
 *      survives, and a re-read + retry commits.
 *
 * The rest covers every new/changed surface against the real backend: the create-only trio, the
 * `lastUpdateTime` precondition on all seven update/delete surfaces, and `getByIdWithUpdateTime`
 * (including under a `readConverter`).
 *
 * Two constraints this file deliberately honors:
 *   - TRAP T3 — no assertion touches server MESSAGE text. The emulator's Datastore-flavored strings
 *     ("the stored version (…) does not match the required base version (…)") differ from
 *     production, so every expectation is on the error CLASS.
 *   - TRAP T4 — a FUTURE `lastUpdateTime` returns `INVALID_ARGUMENT` (gRPC 3) on the emulator, which
 *     is NOT verified against production. That test asserts only that the call rejects and the
 *     document is unchanged; it must not pin an error class.
 */
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { z } from 'zod';
import { FirestoreRepository, ReadConverter } from '../../core/FirestoreRepository.js';
import {
  ConflictError,
  InvalidDocumentIdError,
  NotFoundError,
  PreconditionFailedError,
  ValidationError,
} from '../../core/Errors.js';
import { createTestUserInput } from '../shared/factories/user.factory.js';
import { resetTestFactoryCounters } from '../shared/factories/counters.js';
import {
  createUserRepoHarness,
  getIntegrationDb,
  User,
} from './helpers/firestoreIntegrationHarness.js';

describe('conditional writes: create-only + lastUpdateTime preconditions (issue #33)', () => {
  const { db, userRepo, trackUser, cleanupTrackedUsers, cleanupCollection } =
    createUserRepoHarness('test_conditional_writes');
  const collectionPath = userRepo.getCollectionPath();

  /**
   * Reads a document's `updateTime` through a RAW (converter-free, repository-free) reference.
   * Used both to obtain out-of-band tokens and to cross-check what `getByIdWithUpdateTime` returns.
   */
  async function rawUpdateTime(id: string): Promise<FirebaseFirestore.Timestamp> {
    const snap = await db.collection(collectionPath).doc(id).get();
    if (!snap.exists || !snap.updateTime) {
      throw new Error(`Expected an existing document ${id} with an updateTime`);
    }
    return snap.updateTime;
  }

  /**
   * Mutates a document from OUTSIDE the repository, simulating a competing writer. This is what
   * makes a previously-read `updateTime` stale.
   */
  async function mutateOutOfBand(id: string, data: Record<string, unknown>): Promise<void> {
    await db.collection(collectionPath).doc(id).update(data);
  }

  /** Creates a tracked document and returns its id together with its current `updateTime`. */
  async function seedUser(overrides: Partial<User> = {}) {
    const { id } = await userRepo.create(createTestUserInput(overrides));
    trackUser(id);
    return { id, updateTime: await rawUpdateTime(id) };
  }

  beforeEach(() => {
    resetTestFactoryCounters();
  });

  afterEach(async () => {
    await cleanupTrackedUsers();
  });

  afterAll(async () => {
    await cleanupCollection();
  });

  // -------------------------------------------------------------------------
  // Acceptance flows
  // -------------------------------------------------------------------------

  describe('acceptance: create-only write', () => {
    it('claims an id once; a second claim rejects with ConflictError and the first write survives', async () => {
      const id = trackUser('acceptance-create-only');
      const first = createTestUserInput({ name: 'First Writer' });

      await userRepo.createWithId(id, first);

      await expect(
        userRepo.createWithId(id, createTestUserInput({ name: 'Second Writer' })),
      ).rejects.toBeInstanceOf(ConflictError);

      // The losing create must not have touched the target — the stored document is exactly the
      // first write.
      const stored = await userRepo.getById(id);
      expect(stored).toEqual({ ...first, id });
    });
  });

  describe('acceptance: precondition-guarded read-modify-write', () => {
    it('rejects a stale write, preserves the competing value, and commits on retry', async () => {
      const { id } = await seedUser({ name: 'Original' });

      // Read the version we intend to write against.
      const read = await userRepo.getByIdWithUpdateTime(id);
      expect(read).not.toBeNull();

      // A competing writer commits first, making our token stale.
      await mutateOutOfBand(id, { name: 'Competing Writer' });

      await expect(
        userRepo.update(id, { name: 'Stale Writer' }, { lastUpdateTime: read!.updateTime }),
      ).rejects.toBeInstanceOf(PreconditionFailedError);

      // The competing value survives — the rejected write applied nothing.
      const afterConflict = await userRepo.getById(id);
      expect(afterConflict?.name).toBe('Competing Writer');

      // Re-read and retry against the newer version: this one commits.
      const fresh = await userRepo.getByIdWithUpdateTime(id);
      await userRepo.update(id, { name: 'Retried Writer' }, { lastUpdateTime: fresh!.updateTime });

      const afterRetry = await userRepo.getById(id);
      expect(afterRetry?.name).toBe('Retried Writer');
    });
  });

  // -------------------------------------------------------------------------
  // createWithId
  // -------------------------------------------------------------------------

  describe('createWithId', () => {
    it('returns { id } by default and the converted read model with { returnDoc: true }', async () => {
      const bare = await userRepo.createWithId(trackUser('cwi-bare'), createTestUserInput());
      expect(Object.keys(bare)).toEqual(['id']);

      const input = createTestUserInput({ name: 'Returned Doc' });
      const doc = await userRepo.createWithId(trackUser('cwi-returned'), input, {
        returnDoc: true,
      });
      expect(doc).toEqual({ ...input, id: 'cwi-returned' });
    });

    it('fires beforeCreate and afterCreate with the caller-supplied id', async () => {
      // A dedicated repository so hook registrations do not leak into the shared harness repo.
      const repo = new FirestoreRepository<User>(db, `test_cwi_hooks_${Date.now()}`);
      const beforeIds: (string | undefined)[] = [];
      const afterIds: string[] = [];
      repo.on('beforeCreate', data => {
        beforeIds.push(data.id);
      });
      repo.on('afterCreate', data => {
        afterIds.push(data.id);
      });

      await repo.createWithId('hooked-id', createTestUserInput());

      expect(beforeIds).toEqual(['hooked-id']);
      expect(afterIds).toEqual(['hooked-id']);

      await repo.delete('hooked-id');
    });

    it('rejects a slash-containing id with InvalidDocumentIdError before any hook or write', async () => {
      const repo = new FirestoreRepository<User>(db, `test_cwi_badid_${Date.now()}`);
      const beforeCreate = jest.fn();
      repo.on('beforeCreate', beforeCreate);

      await expect(
        repo.createWithId('other-collection/escaped', createTestUserInput()),
      ).rejects.toBeInstanceOf(InvalidDocumentIdError);

      // The id boundary is a security boundary: nothing — not even a hook — runs before it.
      expect(beforeCreate).not.toHaveBeenCalled();
    });

    it('rejects a FieldValue.delete() payload with ValidationError', async () => {
      await expect(
        userRepo.createWithId('cwi-delete-sentinel', {
          ...createTestUserInput(),
          email: FieldValue.delete(),
        } as unknown as User),
      ).rejects.toBeInstanceOf(ValidationError);

      // Nothing was written.
      await expect(userRepo.getById('cwi-delete-sentinel')).resolves.toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // bulkCreateWithIds
  // -------------------------------------------------------------------------

  describe('bulkCreateWithIds', () => {
    it('creates every entry under the caller-supplied ids', async () => {
      const entries = [
        { id: trackUser('bulk-cwi-1'), data: createTestUserInput({ name: 'Alice' }) },
        { id: trackUser('bulk-cwi-2'), data: createTestUserInput({ name: 'Bob' }) },
      ];

      const result = await userRepo.bulkCreateWithIds(entries);

      expect(result).toEqual([{ id: 'bulk-cwi-1' }, { id: 'bulk-cwi-2' }]);
      const stored = await Promise.all(entries.map(entry => userRepo.getById(entry.id)));
      expect(stored.map(doc => doc?.name)).toEqual(['Alice', 'Bob']);
    });

    it('rejects with ConflictError when one id exists, and no sibling in the batch lands', async () => {
      const existingId = trackUser('bulk-cwi-existing');
      const siblingId = trackUser('bulk-cwi-sibling');
      await userRepo.createWithId(existingId, createTestUserInput({ name: 'Incumbent' }));

      await expect(
        userRepo.bulkCreateWithIds([
          { id: siblingId, data: createTestUserInput({ name: 'Sibling' }) },
          { id: existingId, data: createTestUserInput({ name: 'Usurper' }) },
        ]),
      ).rejects.toBeInstanceOf(ConflictError);

      // Batches of <= 500 operations are atomic: the sibling create must NOT have landed, and the
      // incumbent must be untouched.
      await expect(userRepo.getById(siblingId)).resolves.toBeNull();
      const incumbent = await userRepo.getById(existingId);
      expect(incumbent?.name).toBe('Incumbent');
    });

    it('rejects duplicate ids in the input before writing anything', async () => {
      await expect(
        userRepo.bulkCreateWithIds([
          { id: 'bulk-cwi-dup', data: createTestUserInput() },
          { id: 'bulk-cwi-dup', data: createTestUserInput() },
        ]),
      ).rejects.toThrow(/duplicate document id/i);

      await expect(userRepo.getById('bulk-cwi-dup')).resolves.toBeNull();
    });

    it('rejects an invalid id before writing anything', async () => {
      await expect(
        userRepo.bulkCreateWithIds([
          { id: trackUser('bulk-cwi-valid'), data: createTestUserInput() },
          { id: 'nested/segment', data: createTestUserInput() },
        ]),
      ).rejects.toBeInstanceOf(InvalidDocumentIdError);

      await expect(userRepo.getById('bulk-cwi-valid')).resolves.toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // createWithIdInTransaction
  // -------------------------------------------------------------------------

  describe('createWithIdInTransaction', () => {
    it('creates the document under the caller-supplied id', async () => {
      const id = trackUser('tx-cwi-ok');

      await userRepo.runInTransaction(async (tx, repo) => {
        await repo.createWithIdInTransaction(tx, id, createTestUserInput({ name: 'Tx Created' }));
      });

      const stored = await userRepo.getById(id);
      expect(stored?.name).toBe('Tx Created');
    });

    it('rejects with ConflictError on an existing id and does NOT retry the callback', async () => {
      const id = trackUser('tx-cwi-conflict');
      await userRepo.createWithId(id, createTestUserInput({ name: 'Incumbent' }));

      let attempts = 0;
      await expect(
        userRepo.runInTransaction(async (tx, repo) => {
          attempts += 1;
          await repo.createWithIdInTransaction(tx, id, createTestUserInput({ name: 'Usurper' }));
        }),
      ).rejects.toBeInstanceOf(ConflictError);

      // A rejected create is not contention — Firestore must not retry the transaction.
      expect(attempts).toBe(1);
      const stored = await userRepo.getById(id);
      expect(stored?.name).toBe('Incumbent');
    });
  });

  // -------------------------------------------------------------------------
  // update / patch preconditions
  // -------------------------------------------------------------------------

  describe('update / patch with lastUpdateTime', () => {
    it('commits with an exact token', async () => {
      const { id, updateTime } = await seedUser({ name: 'Before' });

      await userRepo.update(id, { name: 'After' }, { lastUpdateTime: updateTime });

      const stored = await userRepo.getById(id);
      expect(stored?.name).toBe('After');
    });

    it('rejects a stale token and leaves the document unchanged', async () => {
      const { id, updateTime } = await seedUser({ name: 'Before' });
      await mutateOutOfBand(id, { name: 'Competing' });

      await expect(
        userRepo.update(id, { name: 'Stale' }, { lastUpdateTime: updateTime }),
      ).rejects.toBeInstanceOf(PreconditionFailedError);

      const stored = await userRepo.getById(id);
      expect(stored?.name).toBe('Competing');
    });

    it('patch commits with an exact token and rejects a stale one', async () => {
      const { id, updateTime } = await seedUser({
        name: 'Patch Target',
        address: { city: 'Austin' },
      });

      await userRepo.patch(id, { 'address.city': 'Dallas' } as any, {
        lastUpdateTime: updateTime,
      });
      const patched = await userRepo.getById(id);
      expect(patched?.address?.city).toBe('Dallas');

      // The old token is now stale.
      await expect(
        userRepo.patch(id, { 'address.city': 'Houston' } as any, { lastUpdateTime: updateTime }),
      ).rejects.toBeInstanceOf(PreconditionFailedError);
      const unchanged = await userRepo.getById(id);
      expect(unchanged?.address?.city).toBe('Dallas');
    });

    it('raises PreconditionFailedError (not NotFoundError) for a guarded update on a missing document', async () => {
      const { id, updateTime } = await seedUser();
      await userRepo.delete(id);

      // Firestore reports an absent document as "stored version 0", i.e. a FAILED_PRECONDITION —
      // the guarded and unguarded missing-document outcomes genuinely differ.
      await expect(
        userRepo.update(id, { name: 'Ghost' }, { lastUpdateTime: updateTime }),
      ).rejects.toBeInstanceOf(PreconditionFailedError);
    });

    it('still raises NotFoundError for an UNGUARDED update on a missing document (baseline)', async () => {
      await expect(
        userRepo.update('definitely-missing-doc', { name: 'Ghost' }),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    /**
     * TRAP T4. A `lastUpdateTime` newer than the stored version is INVALID_ARGUMENT (gRPC 3) on the
     * emulator, not FAILED_PRECONDITION — and the ORM deliberately does not normalize code 3, since
     * a future token is a malformed value (clock skew / fabrication), not a lost race. Whether
     * production agrees with the emulator here is UNVERIFIED, so this test pins only the two things
     * that are true either way: the call rejects, and nothing was written.
     */
    it('rejects a FUTURE lastUpdateTime and leaves the document unchanged (error class NOT pinned)', async () => {
      const { id } = await seedUser({ name: 'Present' });
      const future = Timestamp.fromMillis(Date.now() + 60_000);

      await expect(
        userRepo.update(id, { name: 'Future' }, { lastUpdateTime: future }),
      ).rejects.toThrow();

      const stored = await userRepo.getById(id);
      expect(stored?.name).toBe('Present');
    });
  });

  // -------------------------------------------------------------------------
  // delete preconditions
  // -------------------------------------------------------------------------

  describe('delete with lastUpdateTime', () => {
    it('deletes with an exact token', async () => {
      const { id, updateTime } = await seedUser();

      await userRepo.delete(id, { lastUpdateTime: updateTime });

      await expect(userRepo.getById(id)).resolves.toBeNull();
    });

    it('rejects a stale token and leaves the document present', async () => {
      const { id, updateTime } = await seedUser({ name: 'Keep Me' });
      await mutateOutOfBand(id, { name: 'Competing' });

      await expect(userRepo.delete(id, { lastUpdateTime: updateTime })).rejects.toBeInstanceOf(
        PreconditionFailedError,
      );

      const stored = await userRepo.getById(id);
      expect(stored?.name).toBe('Competing');
    });

    it('raises NotFoundError for a guarded delete on a missing document (the pre-read throws first)', async () => {
      const { id, updateTime } = await seedUser();
      await userRepo.delete(id);

      // Unlike update(), delete() performs its own existence pre-read, so a missing document is
      // reported as NotFoundError before any precondition reaches the backend.
      await expect(userRepo.delete(id, { lastUpdateTime: updateTime })).rejects.toBeInstanceOf(
        NotFoundError,
      );
    });
  });

  // -------------------------------------------------------------------------
  // bulk preconditions
  // -------------------------------------------------------------------------

  describe('bulkUpdate / bulkPatch with per-entry preconditions', () => {
    it('commits when every token is current', async () => {
      const first = await seedUser({ name: 'First' });
      const second = await seedUser({ name: 'Second' });

      await userRepo.bulkUpdate([
        { id: first.id, data: { name: 'First Updated' }, lastUpdateTime: first.updateTime },
        { id: second.id, data: { name: 'Second Updated' }, lastUpdateTime: second.updateTime },
      ]);

      const stored = await Promise.all([userRepo.getById(first.id), userRepo.getById(second.id)]);
      expect(stored.map(doc => doc?.name)).toEqual(['First Updated', 'Second Updated']);
    });

    it('rejects the WHOLE batch when one token is stale, changing nothing', async () => {
      const fresh = await seedUser({ name: 'Fresh' });
      const stale = await seedUser({ name: 'Stale Target' });
      await mutateOutOfBand(stale.id, { name: 'Competing' });

      await expect(
        userRepo.bulkUpdate([
          { id: fresh.id, data: { name: 'Should Not Land' }, lastUpdateTime: fresh.updateTime },
          { id: stale.id, data: { name: 'Should Not Land' }, lastUpdateTime: stale.updateTime },
        ]),
      ).rejects.toBeInstanceOf(PreconditionFailedError);

      // Atomic at <= 500 operations: the healthy sibling must be untouched too.
      const storedFresh = await userRepo.getById(fresh.id);
      const storedStale = await userRepo.getById(stale.id);
      expect(storedFresh?.name).toBe('Fresh');
      expect(storedStale?.name).toBe('Competing');
    });

    it('bulkPatch honors per-entry tokens and rejects a stale one', async () => {
      const target = await seedUser({ name: 'Patchable', address: { city: 'Austin' } });

      await userRepo.bulkPatch([
        {
          id: target.id,
          data: { 'address.city': 'Dallas' } as any,
          lastUpdateTime: target.updateTime,
        },
      ]);
      expect((await userRepo.getById(target.id))?.address?.city).toBe('Dallas');

      await expect(
        userRepo.bulkPatch([
          {
            id: target.id,
            data: { 'address.city': 'Houston' } as any,
            lastUpdateTime: target.updateTime,
          },
        ]),
      ).rejects.toBeInstanceOf(PreconditionFailedError);
      expect((await userRepo.getById(target.id))?.address?.city).toBe('Dallas');
    });

    it('bulkUpdate still accepts entries with no precondition (baseline unchanged)', async () => {
      const target = await seedUser({ name: 'Unguarded' });

      await userRepo.bulkUpdate([{ id: target.id, data: { name: 'Unguarded Updated' } }]);

      expect((await userRepo.getById(target.id))?.name).toBe('Unguarded Updated');
    });
  });

  describe('bulkDelete with per-entry preconditions', () => {
    it('deletes entries whose tokens are current', async () => {
      const first = await seedUser();
      const second = await seedUser();

      const deleted = await userRepo.bulkDelete([
        { id: first.id, lastUpdateTime: first.updateTime },
        // A mixed batch: the second entry is deliberately unguarded.
        { id: second.id },
      ]);

      expect(deleted).toBe(2);
      await expect(userRepo.getById(first.id)).resolves.toBeNull();
      await expect(userRepo.getById(second.id)).resolves.toBeNull();
    });

    it('rejects the whole batch when a token is stale, deleting nothing', async () => {
      const fresh = await seedUser({ name: 'Fresh' });
      const stale = await seedUser({ name: 'Stale Target' });
      await mutateOutOfBand(stale.id, { name: 'Competing' });

      await expect(
        userRepo.bulkDelete([
          { id: fresh.id, lastUpdateTime: fresh.updateTime },
          { id: stale.id, lastUpdateTime: stale.updateTime },
        ]),
      ).rejects.toBeInstanceOf(PreconditionFailedError);

      await expect(userRepo.getById(fresh.id)).resolves.not.toBeNull();
      await expect(userRepo.getById(stale.id)).resolves.not.toBeNull();
    });

    it('returns 0 when the target is already gone (the pre-read filters it out)', async () => {
      const { id, updateTime } = await seedUser();
      await userRepo.delete(id);

      // The existence pre-read drops missing documents before the batch is built, so a precondition
      // on an already-deleted document is skipped rather than raising.
      await expect(userRepo.bulkDelete([{ id, lastUpdateTime: updateTime }])).resolves.toBe(0);
    });

    it('still accepts the plain id-array overload (baseline unchanged)', async () => {
      const first = await seedUser();
      const second = await seedUser();

      await expect(userRepo.bulkDelete([first.id, second.id])).resolves.toBe(2);
    });
  });

  // -------------------------------------------------------------------------
  // transaction preconditions
  // -------------------------------------------------------------------------

  describe('transaction surfaces with lastUpdateTime', () => {
    it('updateInTransaction commits with an exact token', async () => {
      const { id, updateTime } = await seedUser({ name: 'Tx Before' });

      await userRepo.runInTransaction(async (tx, repo) => {
        await repo.updateInTransaction(
          tx,
          id,
          { name: 'Tx After' },
          { lastUpdateTime: updateTime },
        );
      });

      expect((await userRepo.getById(id))?.name).toBe('Tx After');
    });

    it('updateInTransaction rejects a stale token WITHOUT retrying the callback', async () => {
      const { id, updateTime } = await seedUser({ name: 'Tx Before' });
      await mutateOutOfBand(id, { name: 'Competing' });

      let attempts = 0;
      await expect(
        userRepo.runInTransaction(async (tx, repo) => {
          attempts += 1;
          await repo.updateInTransaction(
            tx,
            id,
            { name: 'Tx Stale' },
            {
              lastUpdateTime: updateTime,
            },
          );
        }),
      ).rejects.toBeInstanceOf(PreconditionFailedError);

      expect(attempts).toBe(1);
      expect((await userRepo.getById(id))?.name).toBe('Competing');
    });

    it('patchInTransaction commits with an exact token and rejects a stale one', async () => {
      const target = await seedUser({ name: 'Tx Patch', address: { city: 'Austin' } });

      await userRepo.runInTransaction(async (tx, repo) => {
        await repo.patchInTransaction(tx, target.id, { 'address.city': 'Dallas' } as any, {
          lastUpdateTime: target.updateTime,
        });
      });
      expect((await userRepo.getById(target.id))?.address?.city).toBe('Dallas');

      await expect(
        userRepo.runInTransaction(async (tx, repo) => {
          await repo.patchInTransaction(tx, target.id, { 'address.city': 'Houston' } as any, {
            lastUpdateTime: target.updateTime,
          });
        }),
      ).rejects.toBeInstanceOf(PreconditionFailedError);
      expect((await userRepo.getById(target.id))?.address?.city).toBe('Dallas');
    });

    it('deleteInTransaction deletes with an exact token and rejects a stale one', async () => {
      const stale = await seedUser({ name: 'Tx Delete Stale' });
      await mutateOutOfBand(stale.id, { name: 'Competing' });

      await expect(
        userRepo.runInTransaction(async (tx, repo) => {
          await repo.deleteInTransaction(tx, stale.id, { lastUpdateTime: stale.updateTime });
        }),
      ).rejects.toBeInstanceOf(PreconditionFailedError);
      await expect(userRepo.getById(stale.id)).resolves.not.toBeNull();

      const exact = await seedUser();
      await userRepo.runInTransaction(async (tx, repo) => {
        await repo.deleteInTransaction(tx, exact.id, { lastUpdateTime: exact.updateTime });
      });
      await expect(userRepo.getById(exact.id)).resolves.toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // getByIdWithUpdateTime
  // -------------------------------------------------------------------------

  describe('getByIdWithUpdateTime', () => {
    it('returns null for a missing document', async () => {
      await expect(userRepo.getByIdWithUpdateTime('no-such-document')).resolves.toBeNull();
    });

    it('returns the document paired with the same updateTime a raw snapshot reports', async () => {
      const { id } = await seedUser({ name: 'Paired' });

      const result = await userRepo.getByIdWithUpdateTime(id);
      const raw = await rawUpdateTime(id);

      expect(result).not.toBeNull();
      expect(result!.doc).toEqual({ ...(await userRepo.getById(id)) });
      expect(result!.doc.id).toBe(id);
      expect(result!.updateTime.isEqual(raw)).toBe(true);
    });

    it('rejects an invalid id before any read', async () => {
      await expect(userRepo.getByIdWithUpdateTime('nested/segment')).rejects.toBeInstanceOf(
        InvalidDocumentIdError,
      );
    });

    it('applies a readConverter to doc and still yields a usable updateTime token', async () => {
      // A converter-applied snapshot still carries the server updateTime, and the token it yields is
      // accepted on the raw write reference — pin both, since the converted read ref is a different
      // code path from the plain one.
      interface Widget {
        name: string;
        value: number;
      }
      const widgetSchema = z.object({ name: z.string(), value: z.number() });
      const readConverter: ReadConverter<Widget> = snapshot => {
        const data = snapshot.data();
        return { ...data, name: String(data.name).toUpperCase() } as Widget;
      };
      const repo = FirestoreRepository.withSchema(
        db,
        `test_cwi_converter_${Date.now()}`,
        widgetSchema,
        { readConverter, storedSchema: widgetSchema },
      );

      await repo.createWithId('converted', { name: 'lowercase', value: 1 });

      const result = await repo.getByIdWithUpdateTime('converted');
      expect(result).not.toBeNull();
      // fromFirestore ran on the read.
      expect(result!.doc.name).toBe('LOWERCASE');
      expect(result!.doc.id).toBe('converted');

      // The token from a converter read is accepted on the (raw) write path.
      await repo.update('converted', { value: 2 }, { lastUpdateTime: result!.updateTime });
      expect((await repo.getById('converted'))?.value).toBe(2);

      await repo.delete('converted');
    });
  });
});
