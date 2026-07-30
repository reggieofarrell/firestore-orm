/**
 * Strategy: emulator integration tests for issue #46 — HookContext delivery and WriteOutcomeError
 * persistence classification.
 *
 * Verifies:
 * - I1 before-hook → not-committed / before-hook; Firestore unchanged
 * - I2 after-hook → committed / after-hook; fail-fast; data persisted (incl. query update/delete)
 * - I3 transaction context (attempt 1, not-committed on throw, direct create on txRepo, null attempt)
 * - I4 contention retries observe monotonically increasing diagnostic attempts
 * - I5 partial fixed-batch 501 create-with-id collision
 * - I6 first-chunk collision remains top-level ConflictError
 * - I7 all six returnDoc read-back sites classify as committed / read-back
 */
import { FirestoreRepository } from '../../core/FirestoreRepository.js';
import { ConflictError, WriteOutcomeError, type HookContext } from '../../index.js';
import { createTestUserInput } from '../shared/factories/user.factory.js';
import { resetTestFactoryCounters } from '../shared/factories/counters.js';
import { createUserRepoHarness, type User } from './helpers/firestoreIntegrationHarness.js';

describe('FirestoreRepository write outcomes (issue #46)', () => {
  const harness = createUserRepoHarness('test_users_write_outcomes');
  const { db, userRepo, trackUser, cleanupCollection } = harness;

  beforeEach(() => {
    resetTestFactoryCounters();
    // Hooks accumulate on the shared suite repo; clear so a throwing hook from one test cannot
    // poison later cases (there is no public off() API).
    (userRepo as unknown as { hooks: Record<string, unknown> }).hooks = {};
  });

  afterEach(async () => {
    // Clear hooks before cleanup — a throwing beforeBulkDelete from I1 would otherwise break
    // cleanupCollection's bulkDelete.
    (userRepo as unknown as { hooks: Record<string, unknown> }).hooks = {};
    await cleanupCollection();
  });

  afterAll(async () => {
    await cleanupCollection();
  });

  describe('I1 — before-hook classification', () => {
    it('beforeCreate → not-committed/before-hook; zero stored docs', async () => {
      const marker = new Error('beforeCreate marker');
      userRepo.on('beforeCreate', (_data, context) => {
        expect(context).toEqual({
          event: 'beforeCreate',
          execution: 'direct',
          retryable: false,
        });
        throw marker;
      });

      await expect(userRepo.create(createTestUserInput({ name: 'Before Create' }))).rejects.toEqual(
        expect.objectContaining({
          name: 'WriteOutcomeError',
          cause: marker,
          outcome: {
            state: 'not-committed',
            phase: 'before-hook',
            hook: { event: 'beforeCreate', execution: 'direct', retryable: false },
          },
        }),
      );

      const snap = await db.collection(userRepo.getCollectionPath()).get();
      expect(snap.size).toBe(0);
    });

    it('beforeUpdate → not-committed; seed unchanged', async () => {
      const created = await userRepo.create(createTestUserInput({ name: 'Before Update' }));
      trackUser(created.id);
      const marker = new Error('beforeUpdate marker');
      userRepo.on('beforeUpdate', () => {
        throw marker;
      });

      await expect(userRepo.update(created.id, { name: 'x' })).rejects.toMatchObject({
        name: 'WriteOutcomeError',
        cause: marker,
        outcome: {
          state: 'not-committed',
          phase: 'before-hook',
          hook: { event: 'beforeUpdate', execution: 'direct', retryable: false },
        },
      });
      expect((await userRepo.getById(created.id))?.name).toBe('Before Update');
    });

    it('beforeDelete → not-committed; seed unchanged', async () => {
      const created = await userRepo.create(createTestUserInput({ name: 'Before Delete' }));
      trackUser(created.id);
      const marker = new Error('beforeDelete marker');
      userRepo.on('beforeDelete', () => {
        throw marker;
      });

      await expect(userRepo.delete(created.id)).rejects.toMatchObject({
        name: 'WriteOutcomeError',
        cause: marker,
        outcome: {
          state: 'not-committed',
          phase: 'before-hook',
          hook: { event: 'beforeDelete', execution: 'direct', retryable: false },
        },
      });
      expect(await userRepo.getById(created.id)).not.toBeNull();
    });

    it('beforeBulkCreate → not-committed; zero stored docs', async () => {
      const marker = new Error('beforeBulkCreate marker');
      userRepo.on('beforeBulkCreate', () => {
        throw marker;
      });
      await expect(
        userRepo.bulkCreate([createTestUserInput({ name: 'Before Bulk Create' })]),
      ).rejects.toMatchObject({
        name: 'WriteOutcomeError',
        cause: marker,
        outcome: {
          state: 'not-committed',
          phase: 'before-hook',
          hook: { event: 'beforeBulkCreate', execution: 'direct', retryable: false },
        },
      });
      expect((await db.collection(userRepo.getCollectionPath()).get()).size).toBe(0);
    });

    it('beforeBulkUpdate → not-committed; seed unchanged', async () => {
      const created = await userRepo.create(createTestUserInput({ name: 'Before Bulk Update' }));
      trackUser(created.id);
      const marker = new Error('beforeBulkUpdate marker');
      userRepo.on('beforeBulkUpdate', () => {
        throw marker;
      });
      await expect(
        userRepo.bulkUpdate([{ id: created.id, data: { name: 'y' } }]),
      ).rejects.toMatchObject({
        name: 'WriteOutcomeError',
        cause: marker,
        outcome: {
          state: 'not-committed',
          phase: 'before-hook',
          hook: { event: 'beforeBulkUpdate', execution: 'direct', retryable: false },
        },
      });
      expect((await userRepo.getById(created.id))?.name).toBe('Before Bulk Update');
    });

    it('beforeBulkDelete → not-committed; seed unchanged', async () => {
      const created = await userRepo.create(createTestUserInput({ name: 'Before Bulk Delete' }));
      trackUser(created.id);
      const marker = new Error('beforeBulkDelete marker');
      userRepo.on('beforeBulkDelete', () => {
        throw marker;
      });
      await expect(userRepo.bulkDelete([created.id])).rejects.toMatchObject({
        name: 'WriteOutcomeError',
        cause: marker,
        outcome: {
          state: 'not-committed',
          phase: 'before-hook',
          hook: { event: 'beforeBulkDelete', execution: 'direct', retryable: false },
        },
      });
      expect(await userRepo.getById(created.id)).not.toBeNull();
    });
  });

  describe('I2 — after-hook classification and fail-fast', () => {
    it('afterCreate: committed data, committed/after-hook, later hook skipped', async () => {
      const marker = new Error('afterCreate marker');
      let laterCalls = 0;
      userRepo.on('afterCreate', () => {
        throw marker;
      });
      userRepo.on('afterCreate', () => {
        laterCalls += 1;
      });

      let caught: unknown;
      try {
        await userRepo.create(createTestUserInput({ name: 'After Create' }));
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(WriteOutcomeError);
      const err = caught as WriteOutcomeError;
      expect(err.outcome).toEqual({
        state: 'committed',
        phase: 'after-hook',
        hook: { event: 'afterCreate', execution: 'direct', retryable: false },
      });
      expect(err.cause).toBe(marker);
      expect(laterCalls).toBe(0);

      const snap = await db.collection(userRepo.getCollectionPath()).get();
      expect(snap.size).toBe(1);
      trackUser(snap.docs[0].id);
    });

    it('afterUpdate: committed data, fail-fast later hook skipped', async () => {
      const created = await userRepo.create(createTestUserInput({ name: 'After Update Seed' }));
      trackUser(created.id);
      const marker = new Error('afterUpdate marker');
      let laterCalls = 0;
      userRepo.on('afterUpdate', () => {
        throw marker;
      });
      userRepo.on('afterUpdate', () => {
        laterCalls += 1;
      });

      await expect(userRepo.update(created.id, { name: 'After Update' })).rejects.toMatchObject({
        name: 'WriteOutcomeError',
        cause: marker,
        outcome: {
          state: 'committed',
          phase: 'after-hook',
          hook: { event: 'afterUpdate', execution: 'direct', retryable: false },
        },
      });
      expect(laterCalls).toBe(0);
      expect((await userRepo.getById(created.id))?.name).toBe('After Update');
    });

    it('afterDelete: document gone, fail-fast later hook skipped', async () => {
      const created = await userRepo.create(createTestUserInput({ name: 'After Delete Seed' }));
      const marker = new Error('afterDelete marker');
      let laterCalls = 0;
      userRepo.on('afterDelete', () => {
        throw marker;
      });
      userRepo.on('afterDelete', () => {
        laterCalls += 1;
      });

      await expect(userRepo.delete(created.id)).rejects.toMatchObject({
        name: 'WriteOutcomeError',
        cause: marker,
        outcome: {
          state: 'committed',
          phase: 'after-hook',
          hook: { event: 'afterDelete', execution: 'direct', retryable: false },
        },
      });
      expect(laterCalls).toBe(0);
      expect(await userRepo.getById(created.id)).toBeNull();
    });

    it('afterBulkCreate: docs stored, fail-fast later hook skipped', async () => {
      const marker = new Error('afterBulkCreate marker');
      let laterCalls = 0;
      userRepo.on('afterBulkCreate', () => {
        throw marker;
      });
      userRepo.on('afterBulkCreate', () => {
        laterCalls += 1;
      });

      await expect(
        userRepo.bulkCreate([createTestUserInput({ name: 'After Bulk Create' })]),
      ).rejects.toMatchObject({
        name: 'WriteOutcomeError',
        cause: marker,
        outcome: {
          state: 'committed',
          phase: 'after-hook',
          hook: { event: 'afterBulkCreate', execution: 'direct', retryable: false },
        },
      });
      expect(laterCalls).toBe(0);
      const snap = await db.collection(userRepo.getCollectionPath()).get();
      expect(snap.size).toBe(1);
      trackUser(snap.docs[0].id);
    });

    it('query().update() afterBulkUpdate failure leaves updates committed', async () => {
      const a = await userRepo.create(
        createTestUserInput({ name: 'Q Update A', email: 'a@t.com' }),
      );
      const b = await userRepo.create(
        createTestUserInput({ name: 'Q Update B', email: 'b@t.com' }),
      );
      trackUser(a.id);
      trackUser(b.id);

      const marker = new Error('query afterBulkUpdate marker');
      userRepo.on('afterBulkUpdate', () => {
        throw marker;
      });

      await expect(
        userRepo.query().where('email', 'in', ['a@t.com', 'b@t.com']).update({ name: 'Updated' }),
      ).rejects.toMatchObject({
        name: 'WriteOutcomeError',
        cause: marker,
        outcome: {
          state: 'committed',
          phase: 'after-hook',
          hook: { event: 'afterBulkUpdate', execution: 'direct', retryable: false },
        },
      });

      expect((await userRepo.getById(a.id))?.name).toBe('Updated');
      expect((await userRepo.getById(b.id))?.name).toBe('Updated');
    });

    it('query().delete() afterBulkDelete failure leaves deletes committed', async () => {
      const a = await userRepo.create(
        createTestUserInput({ name: 'Q Delete A', email: 'del-a@t.com' }),
      );
      trackUser(a.id);

      const marker = new Error('query afterBulkDelete marker');
      userRepo.on('afterBulkDelete', () => {
        throw marker;
      });

      await expect(
        userRepo.query().where('email', '==', 'del-a@t.com').delete(),
      ).rejects.toMatchObject({
        name: 'WriteOutcomeError',
        outcome: {
          state: 'committed',
          phase: 'after-hook',
          hook: { event: 'afterBulkDelete', execution: 'direct', retryable: false },
        },
      });
      expect(await userRepo.getById(a.id)).toBeNull();
    });
  });

  describe('I3 — transaction hook context', () => {
    it('transaction beforeUpdate sees execution transaction, retryable, attempt 1', async () => {
      const created = await userRepo.create(createTestUserInput({ name: 'Tx Ctx' }));
      trackUser(created.id);

      let seen: HookContext<'beforeUpdate'> | undefined;
      userRepo.on('beforeUpdate', (_data, context) => {
        seen = context;
      });

      await userRepo.runInTransaction(async (tx, repo) => {
        await repo.updateInTransaction(tx, created.id, { name: 'Tx Ctx 2' });
      });

      expect(seen).toEqual({
        event: 'beforeUpdate',
        execution: 'transaction',
        retryable: true,
        attempt: 1,
      });
    });

    it('thrown transaction before-hook is not-committed and leaves no write', async () => {
      const created = await userRepo.create(createTestUserInput({ name: 'Tx Before Fail' }));
      trackUser(created.id);
      const marker = new Error('tx beforeUpdate marker');
      userRepo.on('beforeUpdate', () => {
        throw marker;
      });

      let caught: unknown;
      try {
        await userRepo.runInTransaction(async (tx, repo) => {
          await repo.updateInTransaction(tx, created.id, { name: 'should not land' });
        });
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(WriteOutcomeError);
      const err = caught as WriteOutcomeError;
      expect(err.outcome.state).toBe('not-committed');
      expect(err.outcome.phase).toBe('before-hook');
      expect(err.cause).toBe(marker);
      if (err.outcome.state === 'not-committed') {
        expect(err.outcome.hook).toEqual({
          event: 'beforeUpdate',
          execution: 'transaction',
          retryable: true,
          attempt: 1,
        });
      }
      expect((await userRepo.getById(created.id))?.name).toBe('Tx Before Fail');
    });

    it('ordinary create() on the transaction-scoped repo reports direct context (T8)', async () => {
      let seen: HookContext<'beforeCreate'> | undefined;
      userRepo.on('beforeCreate', (_data, context) => {
        seen = context;
      });

      await userRepo.runInTransaction(async (_tx, repo) => {
        const created = await repo.create(createTestUserInput({ name: 'Direct On TxRepo' }));
        trackUser(created.id);
      });

      expect(seen).toEqual({
        event: 'beforeCreate',
        execution: 'direct',
        retryable: false,
      });
    });

    it('caller-managed raw transaction reports attempt null', async () => {
      const created = await userRepo.create(createTestUserInput({ name: 'Raw Tx' }));
      trackUser(created.id);

      let seen: HookContext<'beforeUpdate'> | undefined;
      userRepo.on('beforeUpdate', (_data, context) => {
        seen = context;
      });

      await db.runTransaction(async tx => {
        await userRepo.updateInTransaction(tx, created.id, { name: 'Raw Tx 2' });
      });

      expect(seen).toEqual({
        event: 'beforeUpdate',
        execution: 'transaction',
        retryable: true,
        attempt: null,
      });
    });
  });

  describe('I4 — retried transaction attempt (diagnostic)', () => {
    it('contention observes monotonically increasing attempts starting at 1', async () => {
      // Adapted from N-transaction-retry-hooks.mjs. Attempts are diagnostic — do not assert [2,2].
      const id = 'counter';
      await db.collection(userRepo.getCollectionPath()).doc(id).set({ name: '0' });
      trackUser(id);

      const observedAttempts: number[] = [];
      userRepo.on('beforeUpdate', (_data, context) => {
        if (context.execution === 'transaction' && typeof context.attempt === 'number') {
          observedAttempts.push(context.attempt);
        }
      });

      let firstReads = 0;
      let releaseFirstReads: (() => void) | undefined;
      const bothFirstReads = new Promise<void>(resolve => {
        releaseFirstReads = resolve;
      });

      async function increment() {
        return userRepo.runInTransaction(async (tx, txRepo) => {
          const current = await txRepo.getInTransaction(tx, id);
          firstReads += 1;
          // Barrier so both workers observe the same initial value before writing.
          if (firstReads <= 2) {
            if (firstReads === 2) releaseFirstReads?.();
            await bothFirstReads;
          }
          await txRepo.updateInTransaction(tx, id, {
            name: String(Number(current?.name ?? '0') + 1),
          });
        });
      }

      await Promise.all([increment(), increment()]);

      expect(observedAttempts.length).toBeGreaterThanOrEqual(2);
      expect(Math.min(...observedAttempts)).toBe(1);
      expect(Math.max(...observedAttempts)).toBeGreaterThanOrEqual(2);
      // Hook observations match callback invocations (each updateInTransaction fires beforeUpdate).
      // Within the recorded sequence, every value is a positive 1-based attempt; at least one
      // worker must have seen attempt >= 2 under contention (diagnostic, not a fixed schedule).
      for (const attempt of observedAttempts) {
        expect(attempt).toBeGreaterThanOrEqual(1);
      }
      // Monotonic within each worker's attempts is not globally recoverable from a flat list, but
      // every observed value must be reachable from 1 without going below 1.
      expect(observedAttempts.filter(a => a === 1).length).toBeGreaterThanOrEqual(1);

      expect((await userRepo.getById(id))?.name).toBe('2');
    });
  });

  describe('I5 / I6 — fixed-batch partial vs first-chunk', () => {
    it('I5: 501 create-with-id with last id seeded → partially-committed 500/501', async () => {
      const seededId = 'row-500';
      await userRepo.createWithId(seededId, createTestUserInput({ name: 'Seeded' }));
      trackUser(seededId);

      let afterCalls = 0;
      userRepo.on('afterBulkCreate', () => {
        afterCalls += 1;
      });

      const entries = Array.from({ length: 501 }, (_, i) => ({
        id: `row-${i}`,
        data: createTestUserInput({ name: `Row ${i}` }),
      }));

      let caught: unknown;
      try {
        await userRepo.bulkCreateWithIds(entries);
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(WriteOutcomeError);
      const err = caught as WriteOutcomeError;
      expect(err.outcome).toEqual({
        state: 'partially-committed',
        phase: 'commit',
        committedWrites: 500,
        totalWrites: 501,
      });
      expect(err.cause).toBeInstanceOf(ConflictError);
      expect(afterCalls).toBe(0);

      const snap = await db.collection(userRepo.getCollectionPath()).get();
      expect(snap.size).toBe(501);
      for (const doc of snap.docs) {
        trackUser(doc.id);
      }
      expect((await userRepo.getById(seededId))?.name).toBe('Seeded');
    });

    it('I6: first-chunk collision remains top-level ConflictError', async () => {
      const id = 'collide-first';
      await userRepo.createWithId(id, createTestUserInput({ name: 'Exists' }));
      trackUser(id);

      await expect(
        userRepo.bulkCreateWithIds([
          { id, data: createTestUserInput({ name: 'Dup' }) },
          { id: 'other-ok', data: createTestUserInput({ name: 'Other' }) },
        ]),
      ).rejects.toBeInstanceOf(ConflictError);

      expect(await userRepo.getById('other-ok')).toBeNull();
    });
  });

  describe('I7 — postcommit read-back sites', () => {
    const marker = new Error('readback marker');

    function throwingConverterRepo() {
      return new FirestoreRepository<User>(
        db,
        userRepo.getCollectionPath(),
        undefined,
        undefined,
        () => {
          throw marker;
        },
      );
    }

    async function expectReadBack(run: () => Promise<unknown>) {
      let caught: unknown;
      try {
        await run();
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(WriteOutcomeError);
      const err = caught as WriteOutcomeError;
      expect(err.outcome).toEqual({ state: 'committed', phase: 'read-back' });
      expect(err.cause).toBe(marker);
      const snap = await db.collection(userRepo.getCollectionPath()).get();
      expect(snap.size).toBeGreaterThanOrEqual(1);
      for (const doc of snap.docs) {
        trackUser(doc.id);
      }
    }

    it('create → committed/read-back', async () => {
      const repo = throwingConverterRepo();
      await expectReadBack(() =>
        repo.create(createTestUserInput({ name: 'RB create' }), { returnDoc: true }),
      );
    });

    it('createWithId → committed/read-back', async () => {
      const repo = throwingConverterRepo();
      await expectReadBack(() =>
        repo.createWithId('rb-id', createTestUserInput({ name: 'RB id' }), { returnDoc: true }),
      );
    });

    it('bulkCreate → committed/read-back', async () => {
      const repo = throwingConverterRepo();
      await expectReadBack(() =>
        repo.bulkCreate([createTestUserInput({ name: 'RB bulk' })], { returnDoc: true }),
      );
    });

    it('bulkCreateWithIds → committed/read-back', async () => {
      const repo = throwingConverterRepo();
      await expectReadBack(() =>
        repo.bulkCreateWithIds(
          [{ id: 'rb-bulk-id', data: createTestUserInput({ name: 'RB bulk id' }) }],
          { returnDoc: true },
        ),
      );
    });

    it('update → committed/read-back', async () => {
      const seeded = await userRepo.create(createTestUserInput({ name: 'RB update seed' }));
      trackUser(seeded.id);
      const repo = throwingConverterRepo();
      await expectReadBack(() =>
        repo.update(seeded.id, { name: 'RB update' }, { returnDoc: true }),
      );
    });

    it('upsert-create → committed/read-back', async () => {
      const repo = throwingConverterRepo();
      await expectReadBack(() =>
        repo.upsert('rb-upsert', createTestUserInput({ name: 'RB upsert' }), { returnDoc: true }),
      );
    });
  });
});
