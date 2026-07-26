/**
 * Strategy: unit tests for conditional-write forwarding at the Firestore boundary (issue #33).
 *
 * Modeled on `repository-transaction-options.unit.test.ts`: start from `createMockFirestoreDb`, spy
 * the document/batch/transaction methods, and assert what the ORM hands the SDK. Behavioral
 * correctness of preconditions is owned by the emulator integration suite; what this file pins is
 * the *call shape*, which the emulator cannot distinguish:
 *
 *   1. TRAP T1 REGRESSION GUARD — a write with no `lastUpdateTime` must reach `update()` with
 *      EXACTLY ONE argument. `update` also has an alternating field/value overload, so an explicit
 *      `undefined` precondition is parsed as a field argument and throws "Input is not an object".
 *      Passing the precondition unconditionally would therefore break every existing update call in
 *      the library. Each `.length === 1` assertion below fails if that branch is ever removed.
 *   2. a write WITH `lastUpdateTime` forwards `{ lastUpdateTime }` as the trailing precondition.
 *   3. create-only surfaces use `create()` / `batch.create()` — never `set()` or `add()`.
 *   4. `bulkCreateWithIds` writes the caller's ids, one batch op per entry, and rejects duplicate
 *      ids before touching the batch at all.
 */
import { FirestoreRepository } from '../../core/FirestoreRepository.js';
import { createMockFirestoreDb } from '../shared/mocks/firestore.mocks.js';

/**
 * A `Timestamp`-shaped token. The mocked boundary never calls into the Admin SDK, so the value only
 * has to round-trip by reference — real `Timestamp` instance validation is an emulator concern and
 * is covered by the integration suite.
 */
const lastUpdateTime = {
  seconds: 1700000000,
  nanoseconds: 0,
} as unknown as FirebaseFirestore.Timestamp;

interface TestUser {
  name: string;
}

/**
 * Builds a repository over a fully spied Firestore boundary.
 *
 * Document references are memoized per id so that a method which resolves the same id twice (e.g.
 * `delete`, which reads through `readCol()` and then deletes on that same ref) is observed on one
 * set of spies.
 */
function createConditionalWriteHarness() {
  const docRefs = new Map<string, any>();

  const makeDocRef = (id: string) => {
    if (!docRefs.has(id)) {
      docRefs.set(id, {
        id,
        get: jest.fn().mockResolvedValue({
          exists: true,
          id,
          data: () => ({ name: 'Ada' }),
          updateTime: lastUpdateTime,
        }),
        create: jest.fn().mockResolvedValue({}),
        set: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
        delete: jest.fn().mockResolvedValue({}),
      });
    }
    return docRefs.get(id);
  };

  const doc = jest.fn((id?: string) => makeDocRef(id ?? 'auto-id'));
  const add = jest.fn(async (data: unknown) => {
    const ref = makeDocRef('auto-id');
    void data;
    return ref;
  });

  const { db, collectionRef } = createMockFirestoreDb({
    withConverter: jest.fn(),
    doc,
    // `add` is not part of MockCollectionRef's declared shape; it is attached so the
    // "createWithId never calls add" assertion has a real spy to check.
    add,
  } as any);

  const batch = {
    create: jest.fn(),
    set: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    commit: jest.fn().mockResolvedValue([]),
  };
  (db as { batch: () => typeof batch }).batch = jest.fn(() => batch);

  const stubTx = {
    get: jest.fn().mockResolvedValue({
      exists: true,
      id: 'doc-1',
      data: () => ({ name: 'Ada' }),
    }),
    create: jest.fn(),
    set: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };

  const repo = new FirestoreRepository<TestUser>(db, 'users');

  return {
    repo,
    db,
    collectionRef,
    batch,
    add,
    stubTx: stubTx as unknown as FirebaseFirestore.Transaction & typeof stubTx,
    getDocRef: makeDocRef,
  };
}

describe('FirestoreRepository conditional-write forwarding (issue #33)', () => {
  describe('create-only surfaces use create(), never set()/add()', () => {
    it('createWithId calls docRef.create with the validated payload', async () => {
      const { repo, getDocRef, add } = createConditionalWriteHarness();

      await repo.createWithId('user-1', { name: 'Ada' });

      const docRef = getDocRef('user-1');
      expect(docRef.create).toHaveBeenCalledTimes(1);
      expect(docRef.create).toHaveBeenCalledWith({ name: 'Ada' });
      // Create-only semantics come from `create()`; `set()`/`add()` would silently overwrite.
      expect(docRef.set).not.toHaveBeenCalled();
      expect(add).not.toHaveBeenCalled();
    });

    it('createWithIdInTransaction calls tx.create, never tx.set', async () => {
      const { repo, stubTx, getDocRef } = createConditionalWriteHarness();

      await repo.createWithIdInTransaction(stubTx, 'user-1', { name: 'Ada' });

      expect(stubTx.create).toHaveBeenCalledTimes(1);
      expect(stubTx.create).toHaveBeenCalledWith(getDocRef('user-1'), { name: 'Ada' });
      expect(stubTx.set).not.toHaveBeenCalled();
    });

    it('bulkCreateWithIds calls batch.create once per entry with the caller ids', async () => {
      const { repo, batch, getDocRef } = createConditionalWriteHarness();

      await repo.bulkCreateWithIds([
        { id: 'user-1', data: { name: 'Ada' } },
        { id: 'user-2', data: { name: 'Grace' } },
      ]);

      expect(batch.create).toHaveBeenCalledTimes(2);
      expect(batch.set).not.toHaveBeenCalled();
      expect(batch.create).toHaveBeenNthCalledWith(1, getDocRef('user-1'), { name: 'Ada' });
      expect(batch.create).toHaveBeenNthCalledWith(2, getDocRef('user-2'), { name: 'Grace' });
    });

    it('bulkCreateWithIds rejects duplicate ids before any batch call', async () => {
      const { repo, batch, db } = createConditionalWriteHarness();

      await expect(
        repo.bulkCreateWithIds([
          { id: 'user-1', data: { name: 'Ada' } },
          { id: 'user-1', data: { name: 'Grace' } },
        ]),
      ).rejects.toThrow(/duplicate document id/i);

      expect(batch.create).not.toHaveBeenCalled();
      expect(batch.commit).not.toHaveBeenCalled();
      expect((db as { batch: jest.Mock }).batch).not.toHaveBeenCalled();
    });
  });

  describe('T1 — an omitted precondition never reaches the SDK as an explicit undefined', () => {
    it('update without lastUpdateTime calls docRef.update with exactly one argument', async () => {
      const { repo, getDocRef } = createConditionalWriteHarness();

      await repo.update('user-1', { name: 'Ada' });

      const update = getDocRef('user-1').update as jest.Mock;
      expect(update).toHaveBeenCalledTimes(1);
      // The whole point of T1: a second `undefined` argument here would throw at runtime.
      expect(update.mock.calls[0]).toHaveLength(1);
      expect(update.mock.calls[0][0]).toEqual({ name: 'Ada' });
    });

    it('delete without lastUpdateTime calls docRef.delete with no arguments', async () => {
      const { repo, getDocRef } = createConditionalWriteHarness();

      await repo.delete('user-1');

      const del = getDocRef('user-1').delete as jest.Mock;
      expect(del).toHaveBeenCalledTimes(1);
      expect(del.mock.calls[0]).toHaveLength(0);
    });

    it('bulkUpdate without lastUpdateTime calls batch.update with exactly two arguments', async () => {
      const { repo, batch, getDocRef } = createConditionalWriteHarness();

      await repo.bulkUpdate([{ id: 'user-1', data: { name: 'Ada' } }]);

      expect(batch.update.mock.calls[0]).toHaveLength(2);
      expect(batch.update.mock.calls[0][0]).toBe(getDocRef('user-1'));
      expect(batch.update.mock.calls[0][1]).toEqual({ name: 'Ada' });
    });

    it('bulkDelete without lastUpdateTime calls batch.delete with exactly one argument', async () => {
      const { repo, batch, getDocRef } = createConditionalWriteHarness();

      await repo.bulkDelete(['user-1']);

      expect(batch.delete.mock.calls[0]).toHaveLength(1);
      expect(batch.delete.mock.calls[0][0]).toBe(getDocRef('user-1'));
    });

    it('updateInTransaction without lastUpdateTime calls tx.update with exactly two arguments', async () => {
      const { repo, stubTx, getDocRef } = createConditionalWriteHarness();

      await repo.updateInTransaction(stubTx, 'user-1', { name: 'Ada' });

      expect(stubTx.update.mock.calls[0]).toHaveLength(2);
      expect(stubTx.update.mock.calls[0][0]).toBe(getDocRef('user-1'));
    });

    it('deleteInTransaction without lastUpdateTime calls tx.delete with exactly one argument', async () => {
      const { repo, stubTx, getDocRef } = createConditionalWriteHarness();

      await repo.deleteInTransaction(stubTx, 'user-1');

      expect(stubTx.delete.mock.calls[0]).toHaveLength(1);
      expect(stubTx.delete.mock.calls[0][0]).toBe(getDocRef('user-1'));
    });

    it('patchInTransaction without options calls tx.update with exactly two arguments', async () => {
      // patchInTransaction forwards `lastUpdateTime: undefined` through the ORM-owned options bag;
      // the branch in updateInTransaction is what keeps that from reaching the SDK.
      const { repo, stubTx } = createConditionalWriteHarness();

      await repo.patchInTransaction(stubTx, 'user-1', { name: 'Ada' });

      expect(stubTx.update.mock.calls[0]).toHaveLength(2);
    });

    it('patch without options calls docRef.update with exactly one argument', async () => {
      const { repo, getDocRef } = createConditionalWriteHarness();

      await repo.patch('user-1', { name: 'Ada' });

      const update = getDocRef('user-1').update as jest.Mock;
      expect(update.mock.calls[0]).toHaveLength(1);
    });
  });

  describe('a supplied precondition is forwarded as the trailing argument', () => {
    it('update forwards { lastUpdateTime } to docRef.update', async () => {
      const { repo, getDocRef } = createConditionalWriteHarness();

      await repo.update('user-1', { name: 'Ada' }, { lastUpdateTime });

      const update = getDocRef('user-1').update as jest.Mock;
      expect(update.mock.calls[0]).toHaveLength(2);
      expect(update).toHaveBeenCalledWith({ name: 'Ada' }, { lastUpdateTime });
    });

    it('patch forwards { lastUpdateTime } to docRef.update', async () => {
      const { repo, getDocRef } = createConditionalWriteHarness();

      await repo.patch('user-1', { name: 'Ada' }, { lastUpdateTime });

      const update = getDocRef('user-1').update as jest.Mock;
      expect(update.mock.calls[0][1]).toEqual({ lastUpdateTime });
    });

    it('delete forwards { lastUpdateTime } to docRef.delete', async () => {
      const { repo, getDocRef } = createConditionalWriteHarness();

      await repo.delete('user-1', { lastUpdateTime });

      const del = getDocRef('user-1').delete as jest.Mock;
      expect(del).toHaveBeenCalledWith({ lastUpdateTime });
    });

    it('bulkUpdate forwards per-entry preconditions to batch.update', async () => {
      const { repo, batch, getDocRef } = createConditionalWriteHarness();

      await repo.bulkUpdate([
        { id: 'user-1', data: { name: 'Ada' }, lastUpdateTime },
        // Second entry is deliberately unguarded — a mixed batch must not leak a precondition onto
        // the entry that did not ask for one.
        { id: 'user-2', data: { name: 'Grace' } },
      ]);

      expect(batch.update).toHaveBeenNthCalledWith(
        1,
        getDocRef('user-1'),
        { name: 'Ada' },
        { lastUpdateTime },
      );
      expect(batch.update.mock.calls[1]).toHaveLength(2);
    });

    it('bulkPatch forwards per-entry preconditions to batch.update', async () => {
      const { repo, batch } = createConditionalWriteHarness();

      await repo.bulkPatch([{ id: 'user-1', data: { name: 'Ada' }, lastUpdateTime }]);

      expect(batch.update.mock.calls[0]).toHaveLength(3);
      expect(batch.update.mock.calls[0][2]).toEqual({ lastUpdateTime });
    });

    it('bulkDelete forwards per-entry preconditions to batch.delete', async () => {
      const { repo, batch, getDocRef } = createConditionalWriteHarness();

      await repo.bulkDelete([{ id: 'user-1', lastUpdateTime }, { id: 'user-2' }]);

      expect(batch.delete).toHaveBeenNthCalledWith(1, getDocRef('user-1'), { lastUpdateTime });
      expect(batch.delete.mock.calls[1]).toHaveLength(1);
    });

    it('bulkDelete accepts the plain string-array overload unchanged', async () => {
      const { repo, batch, getDocRef } = createConditionalWriteHarness();

      await repo.bulkDelete(['user-1', 'user-2']);

      expect(batch.delete).toHaveBeenCalledTimes(2);
      expect(batch.delete).toHaveBeenNthCalledWith(1, getDocRef('user-1'));
      expect(batch.delete).toHaveBeenNthCalledWith(2, getDocRef('user-2'));
    });

    it('updateInTransaction forwards { lastUpdateTime } to tx.update', async () => {
      const { repo, stubTx } = createConditionalWriteHarness();

      await repo.updateInTransaction(stubTx, 'user-1', { name: 'Ada' }, { lastUpdateTime });

      expect(stubTx.update.mock.calls[0]).toHaveLength(3);
      expect(stubTx.update.mock.calls[0][2]).toEqual({ lastUpdateTime });
    });

    it('patchInTransaction forwards { lastUpdateTime } to tx.update', async () => {
      const { repo, stubTx } = createConditionalWriteHarness();

      await repo.patchInTransaction(stubTx, 'user-1', { name: 'Ada' }, { lastUpdateTime });

      expect(stubTx.update.mock.calls[0]).toHaveLength(3);
      expect(stubTx.update.mock.calls[0][2]).toEqual({ lastUpdateTime });
    });

    it('deleteInTransaction forwards { lastUpdateTime } to tx.delete', async () => {
      const { repo, stubTx, getDocRef } = createConditionalWriteHarness();

      await repo.deleteInTransaction(stubTx, 'user-1', { lastUpdateTime });

      expect(stubTx.delete).toHaveBeenCalledWith(getDocRef('user-1'), { lastUpdateTime });
    });
  });

  describe('getByIdWithUpdateTime', () => {
    it('returns the document paired with the snapshot updateTime', async () => {
      const { repo } = createConditionalWriteHarness();

      const result = await repo.getByIdWithUpdateTime('user-1');

      expect(result).toEqual({ doc: { name: 'Ada', id: 'user-1' }, updateTime: lastUpdateTime });
    });

    it('returns null when the document does not exist', async () => {
      const { repo, getDocRef } = createConditionalWriteHarness();
      getDocRef('missing').get.mockResolvedValue({ exists: false, id: 'missing' });

      await expect(repo.getByIdWithUpdateTime('missing')).resolves.toBeNull();
    });
  });
});
