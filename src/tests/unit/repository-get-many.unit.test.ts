/**
 * Strategy: unit tests for `getMany` / `bulkDelete` call-shape contracts (issue #35).
 *
 * The emulator cannot distinguish these shapes — they assert HOW the repository talks to the
 * Admin SDK mock:
 *   U-1: getMany(ids) calls db.getAll once with exactly N refs and no trailing options.
 *   U-2: getMany(ids, { fieldMask }) passes { fieldMask } as the LAST argument (the SDK detects
 *        ReadOptions positionally via isPlainObject on the final argument).
 *   U-3: getMany([]) does not call db.getAll at all (T1 short-circuit).
 *   U-4: bulkDelete(ids) calls db.getAll once — NOT Promise.all of per-ref get() (D3 / T3).
 *   U-5: .data() is called exactly once per snapshot (T6 converter-laziness contract).
 *
 * Mock at the Firestore boundary via createMockFirestoreDb; never reimplement ORM logic here.
 */
import { FieldPath } from 'firebase-admin/firestore';
import { FirestoreRepository } from '../../core/FirestoreRepository.js';
import { createMockFirestoreDb } from '../shared/mocks/firestore.mocks.js';

interface TestUser {
  name: string;
  score: number;
}

/**
 * Build a harness whose doc refs carry controllable snapshots and whose db.getAll is a spy.
 *
 * WHAT: each id maps to a DocumentReference-like object with a jest-mocked `get` and a snapshot
 * whose `.data()` is itself a jest spy (so U-5 can count calls).
 * WHY: getMany / bulkDelete both go through db.getAll; the spy must resolve refs the same way the
 * conditional-writes harness does, filtering trailing ReadOptions that lack `.get`.
 */
function createGetManyHarness() {
  const docRefs = new Map<string, any>();
  const dataSpies = new Map<string, jest.Mock>();

  const makeDocRef = (id: string) => {
    if (!docRefs.has(id)) {
      const data = jest.fn(() => ({ name: 'Ada', score: 1 }));
      dataSpies.set(id, data);
      const snapshot = { exists: true, id, data };
      docRefs.set(id, {
        id,
        get: jest.fn().mockResolvedValue(snapshot),
        // Direct snapshot handle so getAll can resolve WITHOUT calling get() — that lets U-4
        // prove bulkDelete no longer does Promise.all(ids.map(id => doc(id).get())).
        __snapshot: snapshot,
      });
    }
    return docRefs.get(id);
  };

  const doc = jest.fn((id?: string) => makeDocRef(id ?? 'auto-id'));
  const { db } = createMockFirestoreDb({
    withConverter: jest.fn(),
    doc,
  } as any);

  const batch = {
    create: jest.fn(),
    set: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    commit: jest.fn().mockResolvedValue([]),
  };
  (db as { batch: () => typeof batch }).batch = jest.fn(() => batch);

  // Prefer __snapshot when present so per-ref get() spies stay clean for U-4; fall back to get()
  // for refs that only expose the SDK-shaped API.
  const getAll = jest.fn(async (...refs: any[]) =>
    Promise.all(
      refs
        .filter(ref => typeof ref?.get === 'function')
        .map(ref => (ref.__snapshot !== undefined ? ref.__snapshot : ref.get())),
    ),
  );
  (db as { getAll: typeof getAll }).getAll = getAll;

  const repo = new FirestoreRepository<TestUser>(db, 'users');

  return {
    repo,
    db,
    batch,
    getAll,
    getDocRef: makeDocRef,
    getDataSpy: (id: string) => dataSpies.get(id)!,
  };
}

describe('getMany / bulkDelete call shapes (issue #35)', () => {
  // U-1 — getMany(ids) → one getAll with N refs, no trailing options
  it('U-1: getMany(ids) calls db.getAll once with exactly N refs and no trailing options', async () => {
    const { repo, getAll, getDocRef } = createGetManyHarness();

    await repo.getMany(['a', 'b', 'c']);

    expect(getAll).toHaveBeenCalledTimes(1);
    const args = getAll.mock.calls[0];
    expect(args).toHaveLength(3);
    expect(args[0]).toBe(getDocRef('a'));
    expect(args[1]).toBe(getDocRef('b'));
    expect(args[2]).toBe(getDocRef('c'));
    // No trailing ReadOptions object — every arg is a doc ref.
    for (const arg of args) {
      expect(typeof arg.get).toBe('function');
    }
  });

  // U-2 — fieldMask is the LAST argument
  it('U-2: getMany(ids, { fieldMask }) passes { fieldMask } as the last argument', async () => {
    const { repo, getAll, getDocRef } = createGetManyHarness();
    const mask = ['name'] as const;

    await repo.getMany(['a', 'b'], { fieldMask: [...mask] });

    expect(getAll).toHaveBeenCalledTimes(1);
    const args = getAll.mock.calls[0];
    expect(args).toHaveLength(3);
    expect(args[0]).toBe(getDocRef('a'));
    expect(args[1]).toBe(getDocRef('b'));
    // Last argument is ReadOptions — misplaced options would be silently parsed as a doc ref.
    expect(args[2]).toEqual({ fieldMask: ['name'] });
  });

  it('U-2b: FieldPath instances in the mask are forwarded unchanged', async () => {
    const { repo, getAll } = createGetManyHarness();
    const path = new FieldPath('name');

    await repo.getMany(['a'], { fieldMask: [path] });

    expect(getAll.mock.calls[0][1]).toEqual({ fieldMask: [path] });
  });

  // U-2c — tx.getAll fieldMask last-arg shape (adversarial F2)
  it('U-2c: getManyInTransaction passes { fieldMask } as the last tx.getAll argument', async () => {
    const { repo, getDocRef } = createGetManyHarness();
    const getAll = jest.fn(async (...refs: any[]) =>
      Promise.all(
        refs
          .filter(ref => typeof ref?.get === 'function')
          .map(ref => (ref.__snapshot !== undefined ? ref.__snapshot : ref.get())),
      ),
    );
    const stubTx = { getAll } as unknown as FirebaseFirestore.Transaction;

    await repo.getManyInTransaction(stubTx, ['a', 'b'], { fieldMask: ['name'] });

    expect(getAll).toHaveBeenCalledTimes(1);
    const args = getAll.mock.calls[0];
    expect(args).toHaveLength(3);
    expect(args[0]).toBe(getDocRef('a'));
    expect(args[1]).toBe(getDocRef('b'));
    expect(args[2]).toEqual({ fieldMask: ['name'] });
  });

  // U-3b — getManyInTransaction([]) short-circuit (adversarial F1 twin)
  it('U-3b: getManyInTransaction([]) does not call tx.getAll at all', async () => {
    const { repo } = createGetManyHarness();
    const getAll = jest.fn();
    const stubTx = { getAll } as unknown as FirebaseFirestore.Transaction;

    const rows = await repo.getManyInTransaction(stubTx, []);

    expect(rows).toEqual([]);
    expect(getAll).not.toHaveBeenCalled();
  });

  // U-3 — empty input short-circuits
  it('U-3: getMany([]) does not call db.getAll at all', async () => {
    const { repo, getAll } = createGetManyHarness();

    const rows = await repo.getMany([]);

    expect(rows).toEqual([]);
    expect(getAll).not.toHaveBeenCalled();
  });

  // U-4 — bulkDelete uses getAll, not per-ref get
  it('U-4: bulkDelete(ids) calls db.getAll once and does not call per-ref get()', async () => {
    const { repo, getAll, getDocRef, batch } = createGetManyHarness();

    await repo.bulkDelete(['a', 'b']);

    expect(getAll).toHaveBeenCalledTimes(1);
    expect(getAll.mock.calls[0]).toHaveLength(2);
    // D3 regression: the old Promise.all(ids.map(id => doc(id).get())) path must stay gone.
    expect(getDocRef('a').get).not.toHaveBeenCalled();
    expect(getDocRef('b').get).not.toHaveBeenCalled();
    expect(batch.delete).toHaveBeenCalledTimes(2);
  });

  it('U-4b: bulkDelete([]) returns 0 without calling getAll', async () => {
    const { repo, getAll, batch } = createGetManyHarness();

    const count = await repo.bulkDelete([]);

    expect(count).toBe(0);
    expect(getAll).not.toHaveBeenCalled();
    expect(batch.commit).not.toHaveBeenCalled();
  });

  // U-5 — .data() exactly once per snapshot (T6)
  it('U-5: .data() is called exactly once per existing snapshot', async () => {
    const { repo, getDataSpy } = createGetManyHarness();

    await repo.getMany(['a', 'b']);

    expect(getDataSpy('a')).toHaveBeenCalledTimes(1);
    expect(getDataSpy('b')).toHaveBeenCalledTimes(1);
  });

  it('U-5b: missing snapshots never call .data()', async () => {
    // Custom harness so the ghost snapshot still exposes a data() spy we can assert was never called.
    const docRefs = new Map<string, any>();
    const dataSpies = new Map<string, jest.Mock>();
    const makeDocRef = (id: string) => {
      if (!docRefs.has(id)) {
        const data = jest.fn(() => ({ name: 'Ada', score: 1 }));
        dataSpies.set(id, data);
        docRefs.set(id, {
          id,
          get: jest.fn().mockResolvedValue({
            exists: id !== 'ghost',
            id,
            data,
          }),
        });
      }
      return docRefs.get(id);
    };
    const { db } = createMockFirestoreDb({
      withConverter: jest.fn(),
      doc: jest.fn((id?: string) => makeDocRef(id ?? 'auto-id')),
    } as any);
    const getAll = jest.fn(async (...refs: any[]) =>
      Promise.all(refs.filter(ref => typeof ref?.get === 'function').map(ref => ref.get())),
    );
    (db as { getAll: typeof getAll }).getAll = getAll;
    const repo = new FirestoreRepository<TestUser>(db, 'users');

    const rows = await repo.getMany(['a', 'ghost']);

    expect(rows[0]).toEqual({ name: 'Ada', score: 1, id: 'a' });
    expect(rows[1]).toBeNull();
    expect(dataSpies.get('a')).toHaveBeenCalledTimes(1);
    // Missing docs must not invoke data() — fromFirestore never runs for a miss (Q3).
    expect(dataSpies.get('ghost')).not.toHaveBeenCalled();
  });
});
