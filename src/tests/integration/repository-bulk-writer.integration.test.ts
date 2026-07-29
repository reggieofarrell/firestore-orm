/**
 * Strategy: emulator integration coverage for the BulkWriter-backed high-throughput write path
 * (`bulkWrite`) and the explicit destructive `recursiveDelete`.
 *
 * Verification points:
 * - `bulkWrite` applies all five verbs and returns POSITIONAL per-item results with `writeTime`.
 * - Failure isolation: a failing item does not stop its siblings (BulkWriter is not atomic), and the
 *   backend statuses normalize to the same library errors as every other write path
 *   (5 → NotFoundError, 6 → ConflictError, 9 → PreconditionFailedError).
 * - Input errors (bad id, schema rejection, empty update payload, dot-notation on create, unknown
 *   `op` from a JS/`as any` bypass) are per-item results, never whole-call throws — and never leave
 *   a hole in the results array that would make `filter(!ok)` silently under-report.
 * - The no-hooks contract is enforced loudly, and `skipHooks` really does skip.
 * - `recursiveDelete` removes a whole subtree, spares siblings, is idempotent, and runs no hooks.
 */
import { Timestamp } from 'firebase-admin/firestore';
import { z } from 'zod';
import {
  ConflictError,
  InvalidDocumentIdError,
  NotFoundError,
  PreconditionFailedError,
  ValidationError,
} from '../../core/Errors.js';
import { FirestoreRepository } from '../../core/FirestoreRepository.js';
import type { BulkWriteResult } from '../../core/FirestoreRepository.js';
import { createTestUserInput } from '../shared/factories/user.factory.js';
import { resetTestFactoryCounters } from '../shared/factories/counters.js';
import {
  createUserRepoHarness,
  createValidatedRepo,
  getIntegrationDb,
  type User,
} from './helpers/firestoreIntegrationHarness.js';

/** Narrowing helper: fails the test loudly instead of returning a wrong-branch union member. */
function expectOk(result: BulkWriteResult) {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(`expected ok at index ${result.index}: ${result.error.message}`);
  return result;
}

function expectFailed(result: BulkWriteResult) {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error(`expected failure at index ${result.index}`);
  return result;
}

describe('FirestoreRepository.bulkWrite — happy path and result shape', () => {
  const harness = createUserRepoHarness('test_users_bulk_writer');
  const { userRepo, cleanupCollection } = harness;

  beforeEach(() => {
    resetTestFactoryCounters();
  });

  afterAll(async () => {
    await cleanupCollection();
  });

  it('applies all five verbs and returns positional results with writeTime', async () => {
    const toUpdate = await userRepo.create(createTestUserInput({ name: 'To Update' }));
    const toPatch = await userRepo.create(
      createTestUserInput({ name: 'To Patch', profile: { verified: false } } as any),
    );
    const toDelete = await userRepo.create(createTestUserInput({ name: 'To Delete' }));

    const results = await userRepo.bulkWrite([
      { op: 'create', data: createTestUserInput({ name: 'Auto Id' }) },
      { op: 'create', id: 'bw-explicit', data: createTestUserInput({ name: 'Explicit Id' }) },
      { op: 'set', id: 'bw-set', data: createTestUserInput({ name: 'Set' }) },
      { op: 'update', id: toUpdate.id, data: { name: 'Updated' } },
      { op: 'patch', id: toPatch.id, data: { 'profile.verified': true } as any },
      { op: 'delete', id: toDelete.id },
    ]);

    expect(results).toHaveLength(6);
    results.forEach((result, index) => {
      const ok = expectOk(result);
      expect(ok.index).toBe(index);
      expect(ok.writeTime).toBeInstanceOf(Timestamp);
    });
    expect(results.map(result => result.op)).toEqual([
      'create',
      'create',
      'set',
      'update',
      'patch',
      'delete',
    ]);

    // Auto-generated id is echoed back and really was used as the write target.
    const autoId = results[0].id;
    expect(autoId).toHaveLength(20);
    expect((await userRepo.getById(autoId))?.name).toBe('Auto Id');

    expect(results[1].id).toBe('bw-explicit');
    expect((await userRepo.getById('bw-explicit'))?.name).toBe('Explicit Id');
    expect((await userRepo.getById('bw-set'))?.name).toBe('Set');
    expect((await userRepo.getById(toUpdate.id))?.name).toBe('Updated');
    expect((await userRepo.getById(toPatch.id))?.profile?.verified).toBe(true);
    expect(await userRepo.getById(toDelete.id)).toBeNull();
  });

  it('returns [] for empty input without touching Firestore', async () => {
    await expect(userRepo.bulkWrite([])).resolves.toEqual([]);
  });

  it('rejects two operations targeting the same explicit id, before any write', async () => {
    // Two writes to one document are dispatched in separate batches whose commits RACE (the SDK's
    // ordering chain is global, not per-document), so the call is refused rather than resolved
    // non-deterministically. This is a whole-call throw, not a per-item result.
    await expect(
      userRepo.bulkWrite([
        { op: 'set', id: 'bw-dup', data: createTestUserInput({ name: 'First' }) },
        { op: 'update', id: 'bw-dup', data: { name: 'Second' } },
      ]),
    ).rejects.toThrow(/bulkWrite\(\) received duplicate document id\(s\): bw-dup/);

    // Nothing was written — the guard runs before the writer is even created.
    expect(await userRepo.getById('bw-dup')).toBeNull();
  });

  it('does not treat generated create ids as duplicates', async () => {
    const results = await userRepo.bulkWrite([
      { op: 'create', data: createTestUserInput({ name: 'Gen A' }) },
      { op: 'create', data: createTestUserInput({ name: 'Gen B' }) },
    ]);

    results.forEach(result => expectOk(result));
    expect(new Set(results.map(result => result.id)).size).toBe(2);
  });

  it('reports a delete of an already-absent document as ok (SDK semantics)', async () => {
    const results = await userRepo.bulkWrite([{ op: 'delete', id: 'bw-never-existed' }]);
    expectOk(results[0]);
  });

  it('accepts a throttling override', async () => {
    const results = await userRepo.bulkWrite(
      [{ op: 'set', id: 'bw-throttled', data: createTestUserInput({ name: 'Throttled' }) }],
      { throttling: { initialOpsPerSecond: 5, maxOpsPerSecond: 10 } },
    );
    expectOk(results[0]);
  });

  it('sustains a write set larger than the 500-op fixed-batch limit', async () => {
    const results = await userRepo.bulkWrite(
      Array.from({ length: 600 }, (_, index) => ({
        op: 'set' as const,
        id: `bw-scale-${index}`,
        data: createTestUserInput({ name: `Scale ${index}` }),
      })),
    );

    expect(results).toHaveLength(600);
    expect(results.every(result => result.ok)).toBe(true);
  });
});

describe('FirestoreRepository.bulkWrite — per-item failure isolation', () => {
  const harness = createUserRepoHarness('test_users_bulk_writer_failures');
  const { userRepo, cleanupCollection } = harness;

  afterAll(async () => {
    await cleanupCollection();
  });

  it('fails one item and still writes its siblings (non-atomic)', async () => {
    const results = await userRepo.bulkWrite([
      { op: 'update', id: 'bw-fail-missing', data: { name: 'nope' } },
      { op: 'set', id: 'bw-fail-sibling', data: createTestUserInput({ name: 'Sibling' }) },
    ]);

    const failure = expectFailed(results[0]);
    expect(failure.error).toBeInstanceOf(NotFoundError);
    expect(failure.id).toBe('bw-fail-missing');
    expect(failure.op).toBe('update');
    expect(failure.failedAttempts).toBe(1);

    expectOk(results[1]);
    // The sibling landed even though its neighbor failed — the contract difference from bulkUpdate.
    expect((await userRepo.getById('bw-fail-sibling'))?.name).toBe('Sibling');
  });

  it('normalizes a create collision to ConflictError', async () => {
    await userRepo.bulkWrite([
      { op: 'set', id: 'bw-taken', data: createTestUserInput({ name: 'Taken' }) },
    ]);

    const results = await userRepo.bulkWrite([
      { op: 'create', id: 'bw-taken', data: createTestUserInput({ name: 'Collides' }) },
    ]);

    expect(expectFailed(results[0]).error).toBeInstanceOf(ConflictError);
    // The colliding write did not overwrite the stored document.
    expect((await userRepo.getById('bw-taken'))?.name).toBe('Taken');
  });

  it('normalizes a stale lastUpdateTime to PreconditionFailedError on update and delete', async () => {
    const created = await userRepo.create(createTestUserInput({ name: 'Precondition' }));
    const stale = await userRepo.getByIdWithUpdateTime(created.id);
    expect(stale).not.toBeNull();
    await userRepo.update(created.id, { name: 'Moved On' });

    // Separate calls: two operations on one document in a single call are refused as duplicates.
    const updateResults = await userRepo.bulkWrite([
      {
        op: 'update',
        id: created.id,
        data: { name: 'Too Late' },
        lastUpdateTime: stale!.updateTime,
      },
    ]);
    const deleteResults = await userRepo.bulkWrite([
      { op: 'delete', id: created.id, lastUpdateTime: stale!.updateTime },
    ]);

    expect(expectFailed(updateResults[0]).error).toBeInstanceOf(PreconditionFailedError);
    expect(expectFailed(deleteResults[0]).error).toBeInstanceOf(PreconditionFailedError);
    // Neither guarded write was applied.
    expect((await userRepo.getById(created.id))?.name).toBe('Moved On');
  });

  it('honors a lastUpdateTime that still matches', async () => {
    const created = await userRepo.create(createTestUserInput({ name: 'Fresh' }));
    const current = await userRepo.getByIdWithUpdateTime(created.id);

    const results = await userRepo.bulkWrite([
      {
        op: 'update',
        id: created.id,
        data: { name: 'Guarded Write' },
        lastUpdateTime: current!.updateTime,
      },
    ]);

    expectOk(results[0]);
    expect((await userRepo.getById(created.id))?.name).toBe('Guarded Write');
  });

  it('reports a malformed id as a per-item InvalidDocumentIdError without a whole-call throw', async () => {
    const results = await userRepo.bulkWrite([
      { op: 'delete', id: 'nested/slash' },
      { op: 'set', id: 'bw-id-sibling', data: createTestUserInput({ name: 'Id Sibling' }) },
    ]);

    const failure = expectFailed(results[0]);
    expect(failure.error).toBeInstanceOf(InvalidDocumentIdError);
    expect(failure.id).toBe('nested/slash');
    // No write was attempted, so there is no attempt count.
    expect(failure.failedAttempts).toBeUndefined();
    expectOk(results[1]);
  });

  it('reports an empty update payload as a per-item ValidationError', async () => {
    const created = await userRepo.create(createTestUserInput({ name: 'Empty Payload' }));
    const results = await userRepo.bulkWrite([{ op: 'update', id: created.id, data: {} as any }]);

    expect(expectFailed(results[0]).error).toBeInstanceOf(ValidationError);
  });

  it('reports an unknown op as a per-item failure without leaving a results hole', async () => {
    // Mimic a JavaScript / `as any` caller typo'ing the verb. Without a `default:` arm the slot at
    // index 1 stays an unassigned hole, and `results.filter(r => !r.ok)` would silently under-report
    // it as a success (Array.prototype.filter skips holes).
    const results = await userRepo.bulkWrite([
      { op: 'set', id: 'bw-unknown-sibling', data: createTestUserInput({ name: 'Sibling' }) },
      { op: 'delet', id: 'bw-unknown' } as any,
    ]);

    expect(results).toHaveLength(2);
    // The hole is gone — `results[1]` is a real object, not `undefined`.
    expect(results[1]).toBeDefined();
    const failure = expectFailed(results[1]);
    expect(failure.error.message).toMatch(/unknown operation ["']delet["']/);
    expect(failure.op).toBe('delet');
    // No write was attempted, so there is no attempt count.
    expect(failure.failedAttempts).toBeUndefined();

    expectOk(results[0]);
    expect((await userRepo.getById('bw-unknown-sibling'))?.name).toBe('Sibling');
    expect(await userRepo.getById('bw-unknown')).toBeNull();

    // The documented JSDoc idiom must see exactly one failure — not skip a hole.
    const failed = results.filter(result => !result.ok);
    expect(failed).toHaveLength(1);
    expect(results.length - failed.length).toBe(1);
  });

  it('reports dot-notation keys on create as a per-item failure', async () => {
    const results = await userRepo.bulkWrite([
      { op: 'create', id: 'bw-dotted', data: { 'profile.verified': true } as any },
    ]);

    const failure = expectFailed(results[0]);
    expect(failure.error.message).toMatch(/Dot-notation keys are not supported/);
    expect(await userRepo.getById('bw-dotted')).toBeNull();
  });
});

describe('FirestoreRepository.bulkWrite — schema validation is per item', () => {
  it('rejects one invalid row and writes the rest', async () => {
    const repo = createValidatedRepo(getIntegrationDb());
    try {
      const results = await repo.bulkWrite([
        { op: 'create', data: { name: 'Valid', score: 1, createdAt: new Date().toISOString() } },
        // score must be >= 0 — this row alone must fail.
        { op: 'create', data: { name: 'Invalid', score: -5, createdAt: new Date().toISOString() } },
        {
          op: 'create',
          data: { name: 'Also Valid', score: 2, createdAt: new Date().toISOString() },
        },
      ]);

      expectOk(results[0]);
      expect(expectFailed(results[1]).error).toBeInstanceOf(ValidationError);
      expectOk(results[2]);

      // The two valid rows were written; the invalid one was never attempted.
      const stored = await repo.query().get();
      expect(stored.map(doc => doc.name).sort()).toEqual(['Also Valid', 'Valid']);
    } finally {
      const remaining = await repo.query().get();
      if (remaining.length > 0) await repo.bulkDelete(remaining.map(doc => doc.id));
    }
  });
});

describe('FirestoreRepository.bulkWrite — the no-hooks contract', () => {
  const harness = createUserRepoHarness('test_users_bulk_writer_hooks');
  const { db, userRepo, cleanupCollection } = harness;

  afterAll(async () => {
    await cleanupCollection();
  });

  it('throws when a bulk hook is registered and skipHooks is not set', async () => {
    const hookRepo = new FirestoreRepository<User>(db, userRepo.getCollectionPath());
    hookRepo.on('afterBulkDelete', () => {});

    await expect(hookRepo.bulkWrite([{ op: 'delete', id: 'bw-hooked' }])).rejects.toThrow(
      /runs no lifecycle hooks/,
    );
  });

  it('proceeds with skipHooks: true and does not fire the hook', async () => {
    const hookRepo = new FirestoreRepository<User>(db, userRepo.getCollectionPath());
    const fired: string[] = [];
    hookRepo.on('beforeBulkCreate', () => {
      fired.push('beforeBulkCreate');
    });
    hookRepo.on('afterBulkCreate', () => {
      fired.push('afterBulkCreate');
    });

    const results = await hookRepo.bulkWrite(
      [{ op: 'set', id: 'bw-skip-hooks', data: createTestUserInput({ name: 'Skipped' }) }],
      { skipHooks: true },
    );

    expectOk(results[0]);
    expect(fired).toEqual([]);
    expect((await hookRepo.getById('bw-skip-hooks'))?.name).toBe('Skipped');
  });

  it('runs without a guard when only single-document hooks are registered', async () => {
    const hookRepo = new FirestoreRepository<User>(db, userRepo.getCollectionPath());
    const fired: string[] = [];
    hookRepo.on('afterCreate', () => {
      fired.push('afterCreate');
    });

    const results = await hookRepo.bulkWrite([
      { op: 'set', id: 'bw-single-hook', data: createTestUserInput({ name: 'Single' }) },
    ]);

    expectOk(results[0]);
    // Consistent with bulkCreate, which also never runs the single-document hooks.
    expect(fired).toEqual([]);
  });
});

describe('FirestoreRepository.recursiveDelete', () => {
  const harness = createUserRepoHarness('test_users_recursive_delete');
  const { db, userRepo, cleanupCollection } = harness;

  afterAll(async () => {
    await cleanupCollection();
  });

  const seedSubtree = async (id: string) => {
    await userRepo.bulkWrite([{ op: 'set', id, data: createTestUserInput({ name: id }) }]);
    const docRef = db.collection(userRepo.getCollectionPath()).doc(id);
    await docRef.collection('posts').doc('p1').set({ title: 'first' });
    await docRef.collection('posts').doc('p2').set({ title: 'second' });
    await docRef.collection('posts').doc('p1').collection('comments').doc('c1').set({ body: 'hi' });
    await docRef.collection('tags').doc('t1').set({ label: 'x' });
    return docRef;
  };

  it('deletes the document and every descendant, sparing siblings', async () => {
    const targetRef = await seedSubtree('rd-target');
    const siblingRef = await seedSubtree('rd-sibling');

    await userRepo.recursiveDelete('rd-target');

    expect((await targetRef.get()).exists).toBe(false);
    expect((await targetRef.collection('posts').get()).size).toBe(0);
    expect((await targetRef.collection('posts').doc('p1').collection('comments').get()).size).toBe(
      0,
    );
    expect((await targetRef.collection('tags').get()).size).toBe(0);

    // Everything under the sibling survives.
    expect((await siblingRef.get()).exists).toBe(true);
    expect((await siblingRef.collection('posts').get()).size).toBe(2);
    expect((await siblingRef.collection('posts').doc('p1').collection('comments').get()).size).toBe(
      1,
    );

    await userRepo.recursiveDelete('rd-sibling');
  });

  it('resolves for a document that does not exist, and is idempotent', async () => {
    await expect(userRepo.recursiveDelete('rd-never-existed')).resolves.toBeUndefined();
    const targetRef = await seedSubtree('rd-idempotent');
    await userRepo.recursiveDelete('rd-idempotent');
    await expect(userRepo.recursiveDelete('rd-idempotent')).resolves.toBeUndefined();
    expect((await targetRef.get()).exists).toBe(false);
  });

  it('throws InvalidDocumentIdError for a malformed id before any delete', async () => {
    await expect(userRepo.recursiveDelete('nested/slash')).rejects.toThrow(InvalidDocumentIdError);
  });

  it('runs no delete hooks', async () => {
    const hookRepo = new FirestoreRepository<User>(db, userRepo.getCollectionPath());
    const fired: string[] = [];
    hookRepo.on('beforeDelete', () => {
      fired.push('beforeDelete');
    });
    hookRepo.on('afterDelete', () => {
      fired.push('afterDelete');
    });
    hookRepo.on('beforeBulkDelete', () => {
      fired.push('beforeBulkDelete');
    });

    await seedSubtree('rd-hooks');
    await hookRepo.recursiveDelete('rd-hooks');

    expect(fired).toEqual([]);
    expect(await hookRepo.getById('rd-hooks')).toBeNull();
  });

  it('scopes the subtree to the document when called from a subcollection repository', async () => {
    const parentRef = await seedSubtree('rd-parent');
    const postRepo = userRepo.subcollection('rd-parent', 'posts', z.object({ title: z.string() }));

    await postRepo.recursiveDelete('p1');

    expect((await parentRef.collection('posts').doc('p1').get()).exists).toBe(false);
    expect((await parentRef.collection('posts').doc('p1').collection('comments').get()).size).toBe(
      0,
    );
    // The parent document and the sibling post are untouched.
    expect((await parentRef.get()).exists).toBe(true);
    expect((await parentRef.collection('posts').doc('p2').get()).exists).toBe(true);

    await userRepo.recursiveDelete('rd-parent');
  });
});
