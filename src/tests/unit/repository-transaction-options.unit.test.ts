/**
 * Strategy: unit tests for transaction-options forwarding (issue #32).
 *
 * Mock `db.runTransaction` at the Firestore boundary (via `createMockFirestoreDb` + spy) and assert:
 *   1. `runInTransaction(fn)` forwards `options === undefined` (existing one-arg callers unchanged);
 *   2. `{ maxAttempts }`, `{ readOnly: false, maxAttempts }`, `{ readOnly: true }`, and
 *      `{ readOnly: true, readTime }` pass through verbatim as the second argument to
 *      `db.runTransaction`;
 *   3. `runReadOnlyAt(readTime, fn)` is a thin wrapper that forwards
 *      `{ readOnly: true, readTime }`;
 *   4. the callback still receives a repo whose `getInTransaction` is callable (spy `tx.get`).
 *
 * Coverage of FirestoreRepository.ts itself is integration-gated; these tests lock the options
 * contract without needing the emulator.
 */
import { FirestoreRepository } from '../../core/FirestoreRepository.js';
import { createMockFirestoreDb } from '../shared/mocks/firestore.mocks.js';

describe('FirestoreRepository transaction options forwarding (issue #32)', () => {
  /**
   * Build a minimal repo whose `db.runTransaction` records `(fn, options)` and immediately
   * invokes `fn` with a stub transaction whose `get` resolves an existing document.
   *
   * Starts from `createMockFirestoreDb()` (test-guardrails Firestore boundary) and attaches the
   * `runTransaction` spy the stock mock does not provide — options capture is what this suite owns.
   */
  function createRepoWithRunTransactionSpy() {
    const txGet = jest.fn().mockResolvedValue({
      exists: true,
      id: 'doc-1',
      data: () => ({ name: 'Ada' }),
    });
    const stubTx = { get: txGet } as unknown as FirebaseFirestore.Transaction;

    const runTransaction = jest.fn(
      async (fn: (tx: FirebaseFirestore.Transaction) => Promise<unknown>, _options?: unknown) => {
        // Invoke the callback so we can also assert the cloned repo's getInTransaction path.
        return fn(stubTx);
      },
    );

    // Collection stub must support readCol()/writeCol()/doc() used by getInTransaction and newId.
    const { db, collectionRef } = createMockFirestoreDb({
      withConverter: jest.fn(),
      doc: jest.fn((id?: string) => ({
        id: id ?? 'auto-id',
        get: jest.fn(),
        set: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      })),
    });
    // Options-forwarding under test — attach after the shared mock factory returns.
    (db as { runTransaction: typeof runTransaction }).runTransaction = runTransaction;

    const repo = new FirestoreRepository<{ name: string }>(db, 'users');
    return { repo, runTransaction, txGet, stubTx, collectionRef };
  }

  it('runInTransaction(fn) forwards options as undefined', async () => {
    const { repo, runTransaction } = createRepoWithRunTransactionSpy();

    await repo.runInTransaction(async () => 'ok');

    expect(runTransaction).toHaveBeenCalledTimes(1);
    expect(runTransaction.mock.calls[0][1]).toBeUndefined();
  });

  it('runInTransaction(fn, { maxAttempts: 2 }) forwards maxAttempts', async () => {
    const { repo, runTransaction } = createRepoWithRunTransactionSpy();

    await repo.runInTransaction(async () => 'ok', { maxAttempts: 2 });

    expect(runTransaction.mock.calls[0][1]).toEqual({ maxAttempts: 2 });
  });

  it('runInTransaction(fn, { readOnly: false, maxAttempts: 2 }) forwards both', async () => {
    // Symmetric to the read-only cases: explicit read-write discriminant + retry ceiling.
    const { repo, runTransaction } = createRepoWithRunTransactionSpy();

    await repo.runInTransaction(async () => 'ok', { readOnly: false, maxAttempts: 2 });

    expect(runTransaction.mock.calls[0][1]).toEqual({ readOnly: false, maxAttempts: 2 });
  });

  it('runInTransaction(fn, { readOnly: true }) forwards readOnly', async () => {
    const { repo, runTransaction } = createRepoWithRunTransactionSpy();

    await repo.runInTransaction(async () => 'ok', { readOnly: true });

    expect(runTransaction.mock.calls[0][1]).toEqual({ readOnly: true });
  });

  it('runInTransaction(fn, { readOnly: true, readTime }) forwards both', async () => {
    const { repo, runTransaction } = createRepoWithRunTransactionSpy();
    // Timestamp shape only needs to round-trip through the options bag — the mock does not call SDK.
    const readTime = { seconds: 1, nanoseconds: 0 } as unknown as FirebaseFirestore.Timestamp;

    await repo.runInTransaction(async () => 'ok', { readOnly: true, readTime });

    expect(runTransaction.mock.calls[0][1]).toEqual({ readOnly: true, readTime });
  });

  it('runReadOnlyAt(readTime, fn) forwards { readOnly: true, readTime }', async () => {
    const { repo, runTransaction } = createRepoWithRunTransactionSpy();
    const readTime = { seconds: 42, nanoseconds: 7 } as unknown as FirebaseFirestore.Timestamp;

    await repo.runReadOnlyAt(readTime, async () => 'ok');

    expect(runTransaction.mock.calls[0][1]).toEqual({ readOnly: true, readTime });
  });

  it('callback repo getInTransaction is callable (spies tx.get)', async () => {
    const { repo, txGet } = createRepoWithRunTransactionSpy();

    const doc = await repo.runInTransaction(async (tx, txRepo) => {
      return txRepo.getInTransaction(tx, 'doc-1');
    });

    expect(txGet).toHaveBeenCalled();
    expect(doc).toEqual({ name: 'Ada', id: 'doc-1' });
  });
});
