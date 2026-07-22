/**
 * Strategy: emulator-backed coverage for the v3 identity model (ADR-0018) and the review fixes it
 * carries.
 *
 * Verification points:
 *  - B1: a slash-containing (or otherwise illegal) id is rejected BEFORE any read/write, on every
 *    public id-taking surface, so it can never escape the repository's collection.
 *  - B2: a `beforeBulkDelete` hook cannot redirect a delete by mutating a document's `id` (the
 *    documents are frozen and the delete targets are captured from snapshots before the hook runs).
 *  - B4: document-name queries use `whereId` / `orderById` (`FieldPath.documentId()`), not a stored
 *    `id` field.
 *  - A7: `repo.id()` / `repo.newId()` are validating id boundaries, and `whereId` validates its
 *    operands with the same InvalidDocumentIdError boundary as CRUD ids.
 *  - A5: `allowLegacyDatastoreIds` is an explicit opt-in — the `__id[0-9]+__` Datastore-import form
 *    round-trips only when enabled; the default repository rejects it.
 *  - A6: after-create hooks observe the PARSED write output (transforms applied), not the raw input.
 *  - A1: a hook cannot repoint or drop bulk create/update/delete writes by reordering, splicing, or
 *    id-swapping the payload it receives — the runtime iterates a stable pre-hook work list and takes
 *    targets from captured ids / snapshot refs, never from the hook-handed value.
 */
import { z } from 'zod';
import { FirestoreRepository } from '../../core/FirestoreRepository.js';
import { makeValidator } from '../../core/Validation.js';
import { InvalidDocumentIdError } from '../../core/Errors.js';
import {
  createUserRepoHarness,
  getIntegrationDb,
  type User,
} from './helpers/firestoreIntegrationHarness.js';

describe('v3 identity model (integration)', () => {
  let harness: ReturnType<typeof createUserRepoHarness>;

  beforeEach(() => {
    harness = createUserRepoHarness('test_identity');
  });

  afterEach(async () => {
    await harness.cleanupCollection();
  });

  describe('B1 — slash / illegal ids are rejected before any I/O', () => {
    it('rejects a slash-containing id on getById (does not escape the collection)', async () => {
      const { userRepo } = harness;
      await expect(userRepo.getById('alice/private/secret')).rejects.toBeInstanceOf(
        InvalidDocumentIdError,
      );
    });

    it('rejects slash ids across update/upsert/delete', async () => {
      const { userRepo } = harness;
      await expect(userRepo.update('a/b', { name: 'x' })).rejects.toBeInstanceOf(
        InvalidDocumentIdError,
      );
      await expect(userRepo.upsert('a/b', { name: 'x' })).rejects.toBeInstanceOf(
        InvalidDocumentIdError,
      );
      await expect(userRepo.delete('a/b')).rejects.toBeInstanceOf(InvalidDocumentIdError);
    });

    it('rejects a slash-containing parent id on subcollection()', () => {
      const { userRepo } = harness;
      expect(() =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (userRepo as any).subcollection('a/b', 'orders', undefined),
      ).toThrow(InvalidDocumentIdError);
    });

    it('rejects an illegal id in a bulk operation before any delete', async () => {
      const { userRepo } = harness;
      await expect(userRepo.bulkDelete(['ok-id', 'bad/id'])).rejects.toBeInstanceOf(
        InvalidDocumentIdError,
      );
    });
  });

  describe('B2 — a hook cannot redirect a bulk delete', () => {
    it('deletes only the requested document even if a hook mutates the payload id', async () => {
      const { userRepo, trackUser } = harness;
      await userRepo.upsert('doc-a', { name: 'A' });
      await userRepo.upsert('doc-b', { name: 'B' });
      trackUser('doc-a');
      trackUser('doc-b');

      userRepo.on('beforeBulkDelete', ({ documents }) => {
        // The documents are frozen; attempting to repoint identity must not redirect the delete.
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (documents[0] as any).id = 'doc-b';
        } catch {
          /* frozen — expected */
        }
        expect(Object.isFrozen(documents[0])).toBe(true);
      });

      const deleted = await userRepo.bulkDelete(['doc-a']);
      expect(deleted).toBe(1);

      // doc-a is gone; doc-b (the id the hook tried to redirect to) survives.
      expect(await userRepo.getById('doc-a')).toBeNull();
      expect(await userRepo.getById('doc-b')).not.toBeNull();
    });
  });

  describe('B4 — document-name queries via whereId / orderById', () => {
    it('whereId matches by the native document name', async () => {
      const { userRepo, trackUser } = harness;
      await userRepo.upsert('alpha', { name: 'Alpha' });
      await userRepo.upsert('beta', { name: 'Beta' });
      trackUser('alpha');
      trackUser('beta');

      const one = await userRepo.query().whereId('==', 'alpha').getOne();
      expect(one?.id).toBe('alpha');
      expect(one?.name).toBe('Alpha');

      const many = await userRepo.query().whereId('in', ['alpha', 'beta']).get();
      expect(many.map(u => u.id).sort()).toEqual(['alpha', 'beta']);
    });

    it('orderById returns documents ordered by the native document name', async () => {
      const { userRepo, trackUser } = harness;
      await userRepo.upsert('c', { name: 'C' });
      await userRepo.upsert('a', { name: 'A' });
      await userRepo.upsert('b', { name: 'B' });
      ['a', 'b', 'c'].forEach(trackUser);

      const ordered = await userRepo.query().orderById().get();
      expect(ordered.map(u => u.id)).toEqual(['a', 'b', 'c']);
    });
  });

  describe('A7 — id()/newId() boundary + whereId operand validation', () => {
    it('id() returns a valid id unchanged and throws on a malformed one', () => {
      const { userRepo } = harness;
      expect(userRepo.id('user-123')).toBe('user-123');
      expect(() => userRepo.id('a/b')).toThrow(InvalidDocumentIdError);
    });

    it('newId() returns a fresh, valid id without writing a document', async () => {
      const { userRepo } = harness;
      const id = userRepo.newId();
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);
      // It is only an id — nothing was written under it.
      expect(await userRepo.getById(id)).toBeNull();
    });

    it('whereId validates its operands synchronously, before any Firestore call', () => {
      const { userRepo } = harness;
      expect(() => userRepo.query().whereId('==', 'a/b')).toThrow(InvalidDocumentIdError);
      expect(() => userRepo.query().whereId('in', ['ok', 'a/b'])).toThrow(InvalidDocumentIdError);
    });
  });

  describe('A5 / R7 — allowLegacyDatastoreIds opt-in via the named raw() factory', () => {
    it('rejects a __id__ id by default but round-trips it when opted in via FirestoreRepository.raw()', async () => {
      const db = getIntegrationDb();
      const collection = `test_identity_legacy_${Date.now()}_${Math.random().toString(36).slice(2)}`;

      // Default raw repository: the reserved __id7__ form is rejected before any I/O.
      const strictRepo = FirestoreRepository.raw<User>(db, collection);
      await expect(strictRepo.upsert('__id7__', { name: 'legacy' })).rejects.toBeInstanceOf(
        InvalidDocumentIdError,
      );

      // Opt-in via the discoverable named factory (review R7): the __id[0-9]+__ Datastore-import
      // document name is accepted end-to-end.
      const legacyRepo = FirestoreRepository.raw<User>(db, collection, {
        allowLegacyDatastoreIds: true,
      });
      await legacyRepo.upsert('__id7__', { name: 'legacy' });
      const read = await legacyRepo.getById('__id7__');
      expect(read?.id).toBe('__id7__');
      expect(read?.name).toBe('legacy');
      await legacyRepo.delete('__id7__');
    });
  });

  describe('A6 — after-create hooks receive the parsed write output', () => {
    it('afterCreate sees the transformed (output) value, not the raw string input', async () => {
      const db = getIntegrationDb();
      const collection = `test_identity_transform_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const readSchema = z.object({ score: z.number() });
      // Write overlay whose INPUT (string) differs from its OUTPUT (number).
      const writeSchema = z.object({ score: z.string().transform(s => Number(s)) });
      const repo = FirestoreRepository.withSchema(db, collection, readSchema, { writeSchema });

      let seen: unknown;
      repo.on('afterCreate', data => {
        seen = data.score;
      });

      const { id } = await repo.create({ score: '42' });
      // The hook observed the PARSED number, never the pre-transform string.
      expect(seen).toBe(42);
      expect(typeof seen).toBe('number');
      await repo.delete(id);
    });

    it('also holds on a direct-constructor makeValidator repo (low-level input/output split)', async () => {
      const db = getIntegrationDb();
      const collection = `test_identity_lowlevel_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      // makeValidator carries z.input (string) and z.output (number); the four-generic constructor
      // threads them, so the after-create hook observes the parsed output on the low-level path too.
      const validator = makeValidator(z.object({ count: z.string().transform(s => Number(s)) }));
      const repo = new FirestoreRepository<
        { count: number },
        { count: string },
        { count: number },
        { count: number }
      >(db, collection, validator);

      let seen: unknown;
      repo.on('afterCreate', data => {
        seen = data.count;
      });

      const { id } = await repo.create({ count: '7' });
      // review S1: the after-create hook AND the persisted document both match the parsed output WO
      // (number 7) — a validator genuinely produces the WO the type promises, so W !== WO is sound
      // here precisely because a parser exists.
      expect(seen).toBe(7);
      expect(typeof seen).toBe('number');
      const persisted = await repo.getById(id);
      expect(persisted?.count).toBe(7);
      expect(typeof persisted?.count).toBe('number');
      await repo.delete(id);
    });

    it('afterBulkCreate observes the parsed number output for every row (review R4)', async () => {
      const db = getIntegrationDb();
      const collection = `test_identity_bulk_transform_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const readSchema = z.object({ score: z.number() });
      const writeSchema = z.object({ score: z.string().transform(s => Number(s)) });
      const repo = FirestoreRepository.withSchema(db, collection, readSchema, { writeSchema });

      let seen: unknown[] = [];
      repo.on('afterBulkCreate', rows => {
        seen = rows.map(r => r.score);
      });

      const created = await repo.bulkCreate([{ score: '1' }, { score: '2' }]);
      expect(seen).toEqual([1, 2]); // parsed numbers, not the '1'/'2' string inputs
      expect(seen.every(s => typeof s === 'number')).toBe(true);
      await repo.bulkDelete(created.map(c => c.id));
    });
  });

  describe('S2/T1 — a repository with a compatible custom update schema consumes the declared update input', () => {
    it('repo.update() accepts the shared write input and persists a value within WO', async () => {
      const db = getIntegrationDb();
      const collection = `test_identity_custom_update_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      // A coercion update schema: input accepts the shared numeric input, output is the same number.
      const validator = makeValidator(
        z.object({ score: z.number() }),
        z.object({ score: z.coerce.number() }),
      );
      const repo = new FirestoreRepository<{ score: number }>(db, collection, validator);

      await repo.upsert('cu1', { score: 1 });
      // The value the repository's update() TYPE exposes (a number) is consumed by the update schema
      // and persisted — the accepted custom update schema is honest against the declared input (T1).
      await repo.update('cu1', { score: 7 });

      const persisted = await repo.getById('cu1');
      expect(persisted?.score).toBe(7);
      expect(typeof persisted?.score).toBe('number');
      await repo.delete('cu1');
    });
  });

  describe('R9 — newId() is independent of the id a later create() generates', () => {
    it('newId() returns a fresh id that differs from a subsequent create()', async () => {
      const { userRepo, trackUser } = harness;
      const reserved = userRepo.newId();
      expect(typeof reserved).toBe('string');
      expect(reserved.length).toBeGreaterThan(0);

      const { id: created } = await userRepo.create({ name: 'independent' });
      trackUser(created);

      // create() (via add()) generated its OWN id — newId() did not preallocate it.
      expect(created).not.toBe(reserved);
      // Nothing was written under the reserved id.
      expect(await userRepo.getById(reserved)).toBeNull();

      // …but the reserved id can be used explicitly via upsert.
      await userRepo.upsert(reserved, { name: 'reserved-write' });
      trackUser(reserved);
      expect((await userRepo.getById(reserved))?.name).toBe('reserved-write');
    });
  });

  describe('A1 — hooks cannot repoint or drop bulk writes/updates/deletes', () => {
    it('bulkCreate: reorder/splice/id-swap in a before-hook cannot repoint writes', async () => {
      const { userRepo, trackUser } = harness;
      userRepo.on('beforeBulkCreate', docs => {
        // The runtime built its write work list before this hook ran; adversarially reorder, drop,
        // and repoint entries. Post-R2 the array is frozen and each id is non-writable, so these
        // attempts throw (caught here) — and even if they didn't, the write list is independent.
        const arr = docs as Array<{ id: string; name: string }>;
        try {
          arr.reverse();
        } catch {
          /* frozen — expected */
        }
        try {
          (arr[0] as { id: string }).id = 'HIJACKED';
        } catch {
          /* non-writable — expected */
        }
        try {
          arr.pop();
        } catch {
          /* frozen — expected */
        }
      });

      const created = await userRepo.bulkCreate([{ name: 'one' }, { name: 'two' }]);
      created.forEach(c => trackUser(c.id));

      // Both docs created, in draft order, at their captured auto-ids (never 'HIJACKED').
      expect(created).toHaveLength(2);
      expect(created.some(c => c.id === 'HIJACKED')).toBe(false);
      expect((await userRepo.getById(created[0].id))?.name).toBe('one');
      expect((await userRepo.getById(created[1].id))?.name).toBe('two');
    });

    it('bulkPatch: an id-swap in a before-hook cannot redirect the write', async () => {
      const { userRepo, trackUser } = harness;
      await userRepo.upsert('doc-a', { name: 'A' });
      await userRepo.upsert('doc-b', { name: 'B' });
      trackUser('doc-a');
      trackUser('doc-b');

      userRepo.on('beforeBulkUpdate', entries => {
        // Attempt to repoint the doc-a update onto doc-b (post-R2 the entry id is non-writable).
        try {
          (entries[0] as { id: string }).id = 'doc-b';
        } catch {
          /* non-writable — expected */
        }
      });

      const result = await userRepo.bulkPatch([{ id: 'doc-a', data: { name: 'A-updated' } }]);
      expect(result).toEqual([{ id: 'doc-a' }]);

      // doc-a received the update; doc-b (the redirect target) is untouched.
      expect((await userRepo.getById('doc-a'))?.name).toBe('A-updated');
      expect((await userRepo.getById('doc-b'))?.name).toBe('B');
    });

    it('query update: mutating the hook payload cannot redirect or drop writes', async () => {
      const { userRepo, trackUser } = harness;
      await userRepo.upsert('q1', { name: 'q1' });
      await userRepo.upsert('q2', { name: 'q2' });
      trackUser('q1');
      trackUser('q2');

      userRepo.on('beforeBulkUpdate', entries => {
        // Post-R2 the array is frozen and each entry id is non-writable, so these attempts throw
        // (caught) — and the write iterates the independent, pre-captured work list regardless.
        const arr = entries as Array<{ id: string; data: { name?: string } }>;
        try {
          arr.reverse();
        } catch {
          /* frozen — expected */
        }
        try {
          arr.pop();
        } catch {
          /* frozen — expected */
        }
        try {
          (arr[0] as { id: string }).id = 'HIJACKED';
        } catch {
          /* non-writable — expected */
        }
      });

      const count = await userRepo.query().whereId('in', ['q1', 'q2']).update({ name: 'UPDATED' });

      // Both matched docs were written despite the pop()/reverse()/id-swap.
      expect(count).toBe(2);
      expect((await userRepo.getById('q1'))?.name).toBe('UPDATED');
      expect((await userRepo.getById('q2'))?.name).toBe('UPDATED');
    });

    it('query delete: a frozen hook payload cannot redirect or suppress the delete', async () => {
      const { userRepo, trackUser } = harness;
      await userRepo.upsert('d1', { name: 'd1' });
      await userRepo.upsert('d2', { name: 'd2' });
      await userRepo.upsert('keep', { name: 'keep' });
      ['d1', 'd2', 'keep'].forEach(trackUser);

      userRepo.on('beforeBulkDelete', ({ ids, documents }) => {
        expect(Object.isFrozen(ids)).toBe(true);
        expect(Object.isFrozen(documents)).toBe(true);
        try {
          (documents[0] as { id: string }).id = 'keep';
        } catch {
          /* frozen — expected */
        }
        try {
          (ids as string[]).pop();
        } catch {
          /* frozen — expected */
        }
      });

      const count = await userRepo.query().whereId('in', ['d1', 'd2']).delete();
      expect(count).toBe(2);
      expect(await userRepo.getById('d1')).toBeNull();
      expect(await userRepo.getById('d2')).toBeNull();
      // The id the hook tried to repoint onto survives.
      expect(await userRepo.getById('keep')).not.toBeNull();
    });
  });
});
