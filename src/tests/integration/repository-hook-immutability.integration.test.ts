/**
 * Strategy: emulator-backed coverage for hook-event immutability (ADR-0018 Decision 7 / review R2).
 *
 * The stable pre-hook work list already prevents a hook from redirecting the WRITE (covered by
 * repository-identity's A1 block). This suite covers the remaining contract: a hook must not be able
 * to forge the identity/accounting that a LATER hook (or an audit/outbox consumer) observes. Every
 * before-payload's `id` is non-writable and every after-event envelope is frozen, while documented
 * DATA-field mutation on before-hooks still reaches the persisted write.
 *
 * Each tampering hook uses try/catch because mutating a frozen/non-writable property throws in strict
 * mode (the intended hardening); a second hook then asserts it still observes the authoritative value.
 */
import { createUserRepoHarness } from './helpers/firestoreIntegrationHarness.js';

describe('hook event immutability (integration, review R2)', () => {
  let harness: ReturnType<typeof createUserRepoHarness>;

  beforeEach(() => {
    harness = createUserRepoHarness('test_hook_immutability');
  });

  afterEach(async () => {
    await harness.cleanupCollection();
  });

  describe('delete() — before and after events are frozen and independent', () => {
    it('a beforeDelete hook cannot forge the id a later afterDelete hook observes', async () => {
      const { userRepo, trackUser } = harness;
      await userRepo.upsert('real', { name: 'Real' });
      trackUser('real');

      const observed: string[] = [];
      userRepo.on('beforeDelete', doc => {
        expect(Object.isFrozen(doc)).toBe(true);
        try {
          (doc as { id: string }).id = 'tampered';
        } catch {
          /* frozen — expected */
        }
        observed.push(`before:${doc.id}`);
      });
      userRepo.on('afterDelete', doc => {
        observed.push(`after:${doc.id}`);
      });

      await userRepo.delete('real');

      // Both hooks observed the authoritative id, never the forged one.
      expect(observed).toEqual(['before:real', 'after:real']);
      expect(await userRepo.getById('real')).toBeNull();
    });
  });

  describe('afterBulkUpdate — the { ids } envelope is frozen', () => {
    it('one afterBulkUpdate hook cannot replace the ids array a later hook observes (repo bulkPatch)', async () => {
      const { userRepo, trackUser } = harness;
      await userRepo.upsert('a', { name: 'A' });
      await userRepo.upsert('b', { name: 'B' });
      trackUser('a');
      trackUser('b');

      const seen: number[] = [];
      userRepo.on('afterBulkUpdate', event => {
        expect(Object.isFrozen(event)).toBe(true);
        try {
          (event as { ids: readonly string[] }).ids = [];
        } catch {
          /* frozen — expected */
        }
        seen.push(event.ids.length);
      });
      userRepo.on('afterBulkUpdate', event => {
        seen.push(event.ids.length);
      });

      await userRepo.bulkPatch([
        { id: 'a', data: { name: 'A2' } },
        { id: 'b', data: { name: 'B2' } },
      ]);

      // Both hooks saw the authoritative count of 2 — the forged empty array never took hold.
      expect(seen).toEqual([2, 2]);
    });

    it('one afterBulkUpdate hook cannot replace the ids array (query update)', async () => {
      const { userRepo, trackUser } = harness;
      await userRepo.upsert('q1', { name: 'q1' });
      await userRepo.upsert('q2', { name: 'q2' });
      trackUser('q1');
      trackUser('q2');

      const seen: number[] = [];
      userRepo.on('afterBulkUpdate', event => {
        try {
          (event as { ids: readonly string[] }).ids = [];
        } catch {
          /* frozen — expected */
        }
        seen.push(event.ids.length);
      });

      const count = await userRepo.query().whereId('in', ['q1', 'q2']).update({ name: 'X' });
      expect(count).toBe(2);
      expect(seen).toEqual([2]);
    });
  });

  describe('afterCreate / afterUpdate — frozen envelopes', () => {
    it('an afterCreate hook cannot forge the id a later hook observes', async () => {
      const { userRepo, trackUser } = harness;
      const seen: string[] = [];
      userRepo.on('afterCreate', data => {
        expect(Object.isFrozen(data)).toBe(true);
        try {
          (data as { id: string }).id = 'forged';
        } catch {
          /* frozen — expected */
        }
        seen.push(data.id);
      });
      userRepo.on('afterCreate', data => seen.push(data.id));

      const { id } = await userRepo.create({ name: 'Ada' });
      trackUser(id);
      expect(seen).toEqual([id, id]);
    });

    it('an afterUpdate hook cannot forge the id a later hook observes', async () => {
      const { userRepo, trackUser } = harness;
      await userRepo.upsert('u1', { name: 'U1' });
      trackUser('u1');

      const seen: string[] = [];
      userRepo.on('afterUpdate', data => {
        try {
          (data as { id: string }).id = 'forged';
        } catch {
          /* frozen — expected */
        }
        seen.push(data.id);
      });
      userRepo.on('afterUpdate', data => seen.push(data.id));

      await userRepo.update('u1', { name: 'U1b' });
      expect(seen).toEqual(['u1', 'u1']);
    });
  });

  describe('before-hook payloads — non-writable id, mutable data', () => {
    it('a beforeUpdate hook cannot repoint id but its data mutation still persists', async () => {
      const { userRepo, trackUser } = harness;
      await userRepo.upsert('doc', { name: 'orig' });
      trackUser('doc');

      const seen: string[] = [];
      userRepo.on('beforeUpdate', data => {
        try {
          (data as { id: string }).id = 'elsewhere';
        } catch {
          /* non-writable — expected */
        }
        seen.push(data.id);
        // Documented DATA mutation is still honored.
        (data as { name?: string }).name = 'hook-set';
      });

      await userRepo.update('doc', { name: 'caller-set' });
      expect(seen).toEqual(['doc']);
      const doc = await userRepo.getById('doc');
      expect(doc?.name).toBe('hook-set'); // the hook's data mutation reached the write
    });

    it('a beforeCreate hook on upsert() cannot repoint id but its data mutation persists', async () => {
      const { userRepo, trackUser } = harness;
      trackUser('up1');
      const observed: string[] = [];
      userRepo.on('beforeCreate', data => {
        // The id property is non-writable (locks the withReadonlyId source fix — reverting to a
        // plain `{ ...data, id }` would make this writable:true and fail the assertion).
        expect(Object.getOwnPropertyDescriptor(data, 'id')?.writable).toBe(false);
        try {
          (data as { id?: string }).id = 'elsewhere';
        } catch {
          /* non-writable — expected */
        }
        (data as { name?: string }).name = 'hook-set';
      });
      // A second before-hook must still observe the authoritative id.
      userRepo.on('beforeCreate', data => observed.push((data as { id: string }).id));

      await userRepo.upsert('up1', { name: 'caller-set' });
      expect(observed).toEqual(['up1']);
      const doc = await userRepo.getById('up1');
      expect(doc?.id).toBe('up1'); // written under the requested id, not the forged one
      expect(doc?.name).toBe('hook-set');
    });
  });

  describe('before-bulk arrays — frozen membership, non-writable ids, mutable data', () => {
    it('beforeBulkCreate: array is frozen and ids locked, but data mutation flows to the write', async () => {
      const { userRepo, trackUser } = harness;
      userRepo.on('beforeBulkCreate', drafts => {
        expect(Object.isFrozen(drafts)).toBe(true);
        try {
          (drafts as unknown as unknown[]).push({});
        } catch {
          /* frozen array — expected */
        }
        try {
          (drafts[0] as { id: string }).id = 'forged';
        } catch {
          /* non-writable id — expected */
        }
        // Documented per-draft data mutation is honored.
        (drafts[0] as { name?: string }).name = 'hook-set-0';
      });

      const created = await userRepo.bulkCreate([{ name: 'a' }, { name: 'b' }]);
      created.forEach(c => trackUser(c.id));

      expect(created).toHaveLength(2);
      expect(created.some(c => c.id === 'forged')).toBe(false);
      expect((await userRepo.getById(created[0].id))?.name).toBe('hook-set-0');
      expect((await userRepo.getById(created[1].id))?.name).toBe('b');
    });

    it('beforeBulkUpdate: array is frozen and entry ids locked, but data mutation flows', async () => {
      const { userRepo, trackUser } = harness;
      await userRepo.upsert('bu1', { name: 'one' });
      await userRepo.upsert('bu2', { name: 'two' });
      trackUser('bu1');
      trackUser('bu2');

      userRepo.on('beforeBulkUpdate', entries => {
        expect(Object.isFrozen(entries)).toBe(true);
        try {
          (entries[0] as { id: string }).id = 'bu2';
        } catch {
          /* non-writable — expected */
        }
        (entries[0] as { data: { name?: string } }).data.name = 'patched-one';
      });

      await userRepo.bulkPatch([
        { id: 'bu1', data: { name: 'x' } },
        { id: 'bu2', data: { name: 'y' } },
      ]);

      expect((await userRepo.getById('bu1'))?.name).toBe('patched-one');
      expect((await userRepo.getById('bu2'))?.name).toBe('y');
    });
  });

  describe('transactional before-hooks', () => {
    it('createInTransaction / updateInTransaction / deleteInTransaction lock identity', async () => {
      const { userRepo, trackUser } = harness;
      await userRepo.upsert('tx-existing', { name: 'existing' });
      trackUser('tx-existing');

      userRepo.on('beforeCreate', data => {
        // createInTransaction locks the id non-writable (locks the withReadonlyId source fix).
        expect(Object.getOwnPropertyDescriptor(data, 'id')?.writable).toBe(false);
        expect(() => {
          (data as { id?: string }).id = 'forged';
        }).toThrow();
      });
      userRepo.on('beforeUpdate', data => {
        expect(() => {
          (data as { id: string }).id = 'forged';
        }).toThrow();
      });
      userRepo.on('beforeDelete', doc => {
        expect(Object.isFrozen(doc)).toBe(true);
      });

      const createdId = await userRepo.runInTransaction(async (tx, txRepo) => {
        const { id } = await txRepo.createInTransaction(tx, { name: 'tx-created' });
        await txRepo.updateInTransaction(tx, 'tx-existing', { name: 'tx-updated' });
        return id;
      });
      trackUser(createdId);

      expect((await userRepo.getById(createdId))?.name).toBe('tx-created');
      expect((await userRepo.getById('tx-existing'))?.name).toBe('tx-updated');

      await userRepo.runInTransaction(async (tx, txRepo) => {
        await txRepo.deleteInTransaction(tx, 'tx-existing');
      });
      expect(await userRepo.getById('tx-existing')).toBeNull();
    });
  });

  describe('bulk delete — deep-frozen documents prevent nested-data forge (review R2)', () => {
    it('query delete: a beforeBulkDelete hook cannot forge NESTED data the afterBulkDelete hook observes', async () => {
      const { userRepo, trackUser } = harness;
      await userRepo.upsert('nd1', { name: 'n1', address: { city: 'Portland' } });
      trackUser('nd1');

      const cities: (string | undefined)[] = [];
      userRepo.on('beforeBulkDelete', ({ documents }) => {
        try {
          // Nested mutation must throw — documents are DEEP-frozen (a shallow freeze would let this
          // through and the afterBulkDelete hook would observe 'HACKED').
          (documents[0] as { address?: { city?: string } }).address!.city = 'HACKED';
        } catch {
          /* deep-frozen — expected */
        }
        cities.push((documents[0] as { address?: { city?: string } }).address?.city);
      });
      userRepo.on('afterBulkDelete', ({ documents }) => {
        cities.push((documents[0] as { address?: { city?: string } }).address?.city);
      });

      await userRepo.query().whereId('==', 'nd1').delete();
      expect(cities).toEqual(['Portland', 'Portland']);
    });

    it('repository bulkDelete: same nested-forge protection across before/after', async () => {
      const { userRepo, trackUser } = harness;
      await userRepo.upsert('nd2', { name: 'n2', address: { city: 'Seattle' } });
      trackUser('nd2');

      const cities: (string | undefined)[] = [];
      userRepo.on('beforeBulkDelete', ({ documents }) => {
        try {
          (documents[0] as { address?: { city?: string } }).address!.city = 'HACKED';
        } catch {
          /* deep-frozen — expected */
        }
        cities.push((documents[0] as { address?: { city?: string } }).address?.city);
      });
      userRepo.on('afterBulkDelete', ({ documents }) => {
        cities.push((documents[0] as { address?: { city?: string } }).address?.city);
      });

      await userRepo.bulkDelete(['nd2']);
      expect(cities).toEqual(['Seattle', 'Seattle']);
    });
  });

  describe('bulk update — data replacement rejected, in-place mutation honored (review S3)', () => {
    it('repo bulkPatch: replacing entry.data throws (frozen wrapper); in-place mutation reaches the write', async () => {
      const { userRepo, trackUser } = harness;
      await userRepo.upsert('s3a', { name: 'orig-a' });
      await userRepo.upsert('s3b', { name: 'orig-b' });
      trackUser('s3a');
      trackUser('s3b');

      userRepo.on('beforeBulkUpdate', entries => {
        // Wholesale replacement of the payload throws (the wrapper is frozen) — it would otherwise be
        // silently dropped by the write, so it is rejected rather than misleading.
        expect(() => {
          (entries[0] as { data: unknown }).data = { name: 'REPLACED' };
        }).toThrow();
        // In-place field mutation is the supported contract and DOES reach the write.
        (entries[1] as { data: { name?: string } }).data.name = 'in-place-b';
      });

      await userRepo.bulkPatch([
        { id: 's3a', data: { name: 'patch-a' } },
        { id: 's3b', data: { name: 'patch-b' } },
      ]);

      // s3a kept its original patch payload (replacement did not take); s3b got the in-place value.
      expect((await userRepo.getById('s3a'))?.name).toBe('patch-a');
      expect((await userRepo.getById('s3b'))?.name).toBe('in-place-b');
    });

    it('repo bulkUpdate (replace mode): same contract as bulkPatch — replacement throws, in-place persists', async () => {
      const { userRepo, trackUser } = harness;
      await userRepo.upsert('s3r', { name: 'orig-r' });
      trackUser('s3r');

      userRepo.on('beforeBulkUpdate', entries => {
        expect(() => {
          (entries[0] as { data: unknown }).data = { name: 'REPLACED' };
        }).toThrow();
        (entries[0] as { data: { name?: string } }).data.name = 'in-place-r';
      });

      // bulkUpdate is merge=false (replace) — distinct from bulkPatch (merge=true), same wrapper freeze.
      await userRepo.bulkUpdate([{ id: 's3r', data: { name: 'update-r' } }]);
      expect((await userRepo.getById('s3r'))?.name).toBe('in-place-r');
    });

    it('query update: same contract — replacing entry.data throws, in-place mutation reaches the write', async () => {
      const { userRepo, trackUser } = harness;
      await userRepo.upsert('s3q', { name: 'orig-q' });
      trackUser('s3q');

      userRepo.on('beforeBulkUpdate', entries => {
        expect(() => {
          (entries[0] as { data: unknown }).data = { name: 'REPLACED' };
        }).toThrow();
        (entries[0] as { data: { name?: string } }).data.name = 'in-place-q';
      });

      await userRepo.query().whereId('==', 's3q').update({ name: 'query-set' });
      // In-place mutation reached the write; the (rejected) replacement did not.
      expect((await userRepo.getById('s3q'))?.name).toBe('in-place-q');
    });
  });
});
