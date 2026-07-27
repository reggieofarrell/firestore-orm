/**
 * Strategy: emulator integration tests for `getMany` / `getManyInTransaction` and the D3
 * `bulkDelete` rewire (issue #35).
 *
 * Verifies against the real Admin SDK + emulator:
 *   I-1  Order preserved with misses interleaved; nulls land in the right slots.
 *   I-2  Wholly absent id → null (not a throw, not an omission); length === input length.
 *   I-3  Field mask returns only selected fields + id; unselected siblings are undefined.
 *   I-4  Empty mask → `{ id }` only; missing stays null.
 *   I-5  Duplicates allowed: one entry per position, distinct objects.
 *   I-6  Empty input → [] without contacting Firestore.
 *   I-7  Invalid id → InvalidDocumentIdError before I/O.
 *   I-8  readConverter applies to found entries; missing never invokes the converter.
 *   I-9  bulkDelete([]) returns 0 and does not throw (T1 guard).
 *   I-10 bulkDelete still counts existing docs, skips already-deleted, hooks get frozen payload.
 *   I-11 getManyInTransaction in a read-write tx, then a write commits.
 *   I-12 Same read inside { readOnly: true }.
 *   I-13 PITR: readTime before docs existed → all nulls.
 *   I-14 Subcollection repository.
 *   I-15 Identity invariant: stored field named `id` loses to the document name.
 *   I-16 Converter + mask hazard (T2): dereferencing a masked-out field throws raw TypeError.
 */
import { Timestamp } from 'firebase-admin/firestore';
import { z } from 'zod';
import { FirestoreRepository, ReadConverter } from '../../core/FirestoreRepository.js';
import { InvalidDocumentIdError } from '../../core/Errors.js';
import { createTestUserInput } from '../shared/factories/user.factory.js';
import { resetTestFactoryCounters } from '../shared/factories/counters.js';
import { createUserRepoHarness, getIntegrationDb } from './helpers/firestoreIntegrationHarness.js';

const profileSchema = z.object({
  name: z.string(),
  score: z.number(),
  address: z.object({ city: z.string(), zip: z.string() }),
});
type Profile = z.infer<typeof profileSchema>;

describe('FirestoreRepository.getMany (issue #35)', () => {
  const db = getIntegrationDb();
  const collection = `test_get_many_${Date.now()}`;
  const repo = FirestoreRepository.withSchema(db, collection, profileSchema);

  const made: string[] = [];

  beforeEach(() => {
    resetTestFactoryCounters();
  });

  afterAll(async () => {
    if (made.length > 0) {
      await repo.bulkDelete(made).catch(() => undefined);
    }
  });

  /** Seed one profile and track its id for cleanup. */
  async function seed(name: string, city = 'Austin', zip = '78701'): Promise<string> {
    const { id } = await repo.create({
      name,
      score: name.length,
      address: { city, zip },
    });
    made.push(id);
    return id;
  }

  // I-1 — order + interleaved misses
  it('I-1: preserves input order with misses interleaved as null', async () => {
    const a = await seed('alpha');
    const b = await seed('beta');
    const c = await seed('gamma');
    const d = await seed('delta');
    const e = await seed('epsilon');

    const requested = [d, 'GHOST-1', a, c, 'GHOST-2', b, e];
    const rows = await repo.getMany(requested);

    expect(rows).toHaveLength(requested.length);
    expect(rows.map(r => (r === null ? null : r.id))).toEqual([d, null, a, c, null, b, e]);
    expect(rows[0]?.name).toBe('delta');
    expect(rows[2]?.name).toBe('alpha');
  });

  // I-2 — wholly absent
  it('I-2: a wholly absent id returns null; length always equals input length', async () => {
    const rows = await repo.getMany(['totally-absent-1', 'totally-absent-2']);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toBeNull();
    expect(rows[1]).toBeNull();
  });

  // I-3 — field mask
  it('I-3: field mask returns only selected fields plus id', async () => {
    const id = await seed('masked', 'Dallas', '75201');
    const [row] = await repo.getMany([id], { fieldMask: ['name', 'address.city'] });

    expect(row).not.toBeNull();
    expect(row!.id).toBe(id);
    expect(row!.name).toBe('masked');
    expect(row!.address?.city).toBe('Dallas');
    // Unselected sibling zip and top-level score are absent from the projection.
    expect(row!.address?.zip).toBeUndefined();
    expect((row as Profile | null)?.score).toBeUndefined();
  });

  // I-4 — empty mask (ID-only)
  it('I-4: empty field mask yields { id } only; missing stays null', async () => {
    const id = await seed('id-only');
    const rows = await repo.getMany([id, 'GHOST-EMPTY'], { fieldMask: [] });

    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ id });
    expect(Object.keys(rows[0]!)).toEqual(['id']);
    expect(rows[1]).toBeNull();
  });

  // I-5 — duplicates
  it('I-5: duplicate ids return one entry per position as distinct objects', async () => {
    const a = await seed('dup-a');
    const b = await seed('dup-b');
    const requested = [a, a, 'GHOST', 'GHOST', b];
    const rows = await repo.getMany(requested);

    expect(rows).toHaveLength(5);
    expect(rows[0]?.id).toBe(a);
    expect(rows[1]?.id).toBe(a);
    expect(rows[0]).not.toBe(rows[1]); // distinct object references
    expect(rows[2]).toBeNull();
    expect(rows[3]).toBeNull();
    expect(rows[4]?.id).toBe(b);
  });

  // I-6 — empty input, no Firestore call
  it('I-6: empty input returns [] without calling Firestore', async () => {
    const getAllSpy = jest.spyOn(db, 'getAll');
    try {
      const rows = await repo.getMany([]);
      expect(rows).toEqual([]);
      expect(getAllSpy).not.toHaveBeenCalled();
    } finally {
      getAllSpy.mockRestore();
    }
  });

  // I-7 — invalid id before I/O
  it('I-7: invalid id throws InvalidDocumentIdError before any I/O', async () => {
    const id = await seed('valid-before-bad');
    const getAllSpy = jest.spyOn(db, 'getAll');
    try {
      await expect(repo.getMany([id, 'bad/id'])).rejects.toBeInstanceOf(InvalidDocumentIdError);
      expect(getAllSpy).not.toHaveBeenCalled();
    } finally {
      getAllSpy.mockRestore();
    }
  });

  // I-8 — readConverter
  it('I-8: readConverter applies to found entries; missing does not invoke it', async () => {
    const converterCalls: string[] = [];
    const readConverter: ReadConverter<Profile> = snapshot => {
      const data = snapshot.data() as Profile;
      converterCalls.push(String(data.name));
      return { ...data, name: String(data.name).toUpperCase() };
    };
    const convCollection = `${collection}_conv`;
    const convRepo = FirestoreRepository.withSchema(db, convCollection, profileSchema, {
      readConverter,
      storedSchema: profileSchema,
    });
    const { id } = await convRepo.create({
      name: 'alpha',
      score: 5,
      address: { city: 'Austin', zip: '78701' },
    });
    made.push(id); // best-effort; different collection — clean below
    try {
      converterCalls.length = 0;
      const rows = await convRepo.getMany([id, 'GHOST-CONV']);
      expect(rows[0]?.name).toBe('ALPHA');
      expect(rows[1]).toBeNull();
      // Converter ran once for the found doc, never for the miss (Q3).
      expect(converterCalls).toEqual(['alpha']);
    } finally {
      await convRepo.bulkDelete([id]).catch(() => undefined);
    }
  });

  // I-9 — bulkDelete([]) guard
  it('I-9: bulkDelete([]) returns 0 and does not throw', async () => {
    const getAllSpy = jest.spyOn(db, 'getAll');
    try {
      await expect(repo.bulkDelete([])).resolves.toBe(0);
      expect(getAllSpy).not.toHaveBeenCalled();
    } finally {
      getAllSpy.mockRestore();
    }
  });

  // I-10 — D3 behavior preservation (dedicated repo so hooks do not leak into other cases)
  it('I-10: bulkDelete counts existing docs, skips missing, hooks receive frozen payload', async () => {
    const delCollection = `${collection}_bulkdel`;
    const delRepo = FirestoreRepository.withSchema(db, delCollection, profileSchema);
    const a = await delRepo.create({
      name: 'del-a',
      score: 1,
      address: { city: 'A', zip: '1' },
    });
    const b = await delRepo.create({
      name: 'del-b',
      score: 2,
      address: { city: 'B', zip: '2' },
    });
    const beforePayloads: Array<{ ids: readonly string[]; documents: readonly Profile[] }> = [];
    const afterPayloads: Array<{ ids: readonly string[]; documents: readonly Profile[] }> = [];

    delRepo.on('beforeBulkDelete', event => {
      beforePayloads.push(event as { ids: readonly string[]; documents: readonly Profile[] });
    });
    delRepo.on('afterBulkDelete', event => {
      afterPayloads.push(event as { ids: readonly string[]; documents: readonly Profile[] });
    });

    const count = await delRepo.bulkDelete([a.id, 'already-gone', b.id]);
    expect(count).toBe(2);
    expect(beforePayloads).toHaveLength(1);
    expect(afterPayloads).toHaveLength(1);
    expect([...beforePayloads[0].ids].sort()).toEqual([a.id, b.id].sort());
    expect(beforePayloads[0].documents).toHaveLength(2);
    // Document contents (not just length/frozen) — a mapping bug that freezes empty docs would
    // still pass length + isFrozen alone (adversarial F4).
    const byId = new Map(beforePayloads[0].documents.map(d => [d.id, d]));
    expect(byId.get(a.id)?.name).toBe('del-a');
    expect(byId.get(b.id)?.name).toBe('del-b');
    expect(byId.get(a.id)?.score).toBe(1);
    expect(byId.get(b.id)?.score).toBe(2);
    // Frozen: mutating the hook payload must throw / be a no-op on the frozen arrays.
    expect(Object.isFrozen(beforePayloads[0].ids)).toBe(true);
    expect(Object.isFrozen(beforePayloads[0].documents)).toBe(true);

    expect(await delRepo.getById(a.id)).toBeNull();
    expect(await delRepo.getById(b.id)).toBeNull();
  });

  // I-17 — T1 third short-circuit: getManyInTransaction([]) (adversarial F1)
  it('I-17: getManyInTransaction([]) returns [] without calling tx.getAll', async () => {
    await repo.runInTransaction(async (tx, r) => {
      const getAllSpy = jest.spyOn(tx, 'getAll');
      try {
        const rows = await r.getManyInTransaction(tx, []);
        expect(rows).toEqual([]);
        expect(getAllSpy).not.toHaveBeenCalled();
      } finally {
        getAllSpy.mockRestore();
      }
    });
  });

  // I-11 — read-write transaction
  it('I-11: getManyInTransaction in a read-write tx, then a write commits', async () => {
    const a = await seed('tx-rw-a');
    const b = await seed('tx-rw-b');

    await repo.runInTransaction(async (tx, r) => {
      const [docA, ghost, docB] = await r.getManyInTransaction(tx, [a, 'GHOST-TX', b]);
      expect(docA?.name).toBe('tx-rw-a');
      expect(ghost).toBeNull();
      expect(docB?.name).toBe('tx-rw-b');
      await r.updateInTransaction(tx, a, { score: 99 });
    });

    expect((await repo.getById(a))?.score).toBe(99);
  });

  // I-12 — read-only transaction
  it('I-12: getManyInTransaction works inside { readOnly: true }', async () => {
    const a = await seed('tx-ro-a');
    const rows = await repo.runInTransaction(
      async (tx, r) => r.getManyInTransaction(tx, [a, 'GHOST-RO']),
      { readOnly: true },
    );
    expect(rows[0]?.name).toBe('tx-ro-a');
    expect(rows[1]).toBeNull();
  });

  // I-13 — PITR before docs existed
  it('I-13: runReadOnlyAt before docs existed yields all nulls', async () => {
    // Capture a readTime NOW, then create docs after it — historical snapshot must miss them.
    const readTime = Timestamp.now();
    // Ensure wall clock advances past readTime so the subsequent create is strictly after.
    const deadline = Date.now() + 5_000;
    while (Timestamp.now().toMillis() <= readTime.toMillis() && Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 5));
    }
    const a = await seed('pitr-a');
    const b = await seed('pitr-b');

    const rows = await repo.runReadOnlyAt(readTime, async (tx, r) =>
      r.getManyInTransaction(tx, [a, b]),
    );
    expect(rows).toEqual([null, null]);
  });

  // I-14 — subcollection
  it('I-14: getMany works on a subcollection repository', async () => {
    const harness = createUserRepoHarness('test_get_many_sub');
    const { userRepo, trackUser, cleanupTrackedUsers, cleanupCollection } = harness;
    try {
      const parent = await userRepo.create(createTestUserInput({ name: 'Parent' }));
      trackUser(parent.id);
      const orderSchema = z.object({ total: z.number(), status: z.string() });
      const orderRepo = userRepo.subcollection(parent.id, 'orders', orderSchema);
      const o1 = await orderRepo.create({ total: 10, status: 'pending' });
      const o2 = await orderRepo.create({ total: 20, status: 'shipped' });

      const rows = await orderRepo.getMany([o2.id, 'GHOST-SUB', o1.id]);
      expect(rows[0]?.total).toBe(20);
      expect(rows[1]).toBeNull();
      expect(rows[2]?.total).toBe(10);

      await orderRepo.bulkDelete([o1.id, o2.id]);
    } finally {
      await cleanupTrackedUsers();
      await cleanupCollection();
    }
  });

  // I-15 — identity invariant
  it('I-15: a stored field literally named id loses to the document name', async () => {
    // Write raw so we can plant a spoofed `id` field in the stored document.
    const docRef = db.collection(collection).doc();
    await docRef.set({
      name: 'spoof',
      score: 1,
      address: { city: 'X', zip: '0' },
      id: 'SPOOFED',
    });
    made.push(docRef.id);

    const [row] = await repo.getMany([docRef.id]);
    expect(row).not.toBeNull();
    // ADR-0018: repository overlays snapshot.id — the stored field never wins.
    expect(row!.id).toBe(docRef.id);
    expect(row!.id).not.toBe('SPOOFED');
  });

  // I-16 — converter + mask hazard (T2)
  it('I-16: converter dereferencing a masked-out field throws raw TypeError', async () => {
    const hazardCollection = `${collection}_hazard`;
    // Converter touches address.city unconditionally — will throw when the mask omits address.
    const readConverter: ReadConverter<Profile> = snapshot => {
      const data = snapshot.data() as Profile;
      // Deliberately non-defensive: this is the documented T2 failure mode.
      return {
        ...data,
        name: `${data.name}:${data.address.city}`,
      };
    };
    const hazardRepo = FirestoreRepository.withSchema(db, hazardCollection, profileSchema, {
      readConverter,
      storedSchema: profileSchema,
    });
    const { id } = await hazardRepo.create({
      name: 'hazard',
      score: 1,
      address: { city: 'Austin', zip: '78701' },
    });
    try {
      // Mask omits address — converter's data.address is undefined → TypeError.
      // Assert the raw TypeError surfaces (parseFirestoreError must not reclassify it).
      let thrown: unknown;
      try {
        await hazardRepo.getMany([id], { fieldMask: ['name'] });
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(TypeError);
      expect((thrown as TypeError).name).toBe('TypeError');
    } finally {
      // Cleanup via raw delete — getMany may be broken for this converter+mask combo.
      await db.collection(hazardCollection).doc(id).delete();
    }
  });
});
