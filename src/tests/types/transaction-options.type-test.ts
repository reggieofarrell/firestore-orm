/**
 * Type-level tests for transaction options / read-only narrowing (issue #32), checked by
 * `npm run test:types` via tsc (NOT jest). This file is never executed.
 *
 * The contract this pins:
 *  - `{ readOnly: true }` narrows the callback `repo` to ReadOnlyTransactionalRepository — write
 *    helpers AND non-transactional reads (`getById` / `getAll` / `query`) are ABSENT FROM THE TYPE.
 *  - Non-transactional writes / bulk helpers / hooks (`create` / `update` / `upsert` / `bulk*` /
 *    `on`) and `safeValidate` are likewise ABSENT (same footgun class as `getById`).
 *  - `getInTransaction`, `fromSnapshot`, `validate`, `id` / `newId`, `getCollectionPath`, and
 *    schema accessors remain.
 *  - The old name `getForUpdateInTransaction` is gone on both RW and RO callbacks (rename guard).
 *  - The documented `tx.get(query)` → `fromSnapshot` escape hatch type-checks verbatim.
 *  - Read-write / `maxAttempts` callbacks still allow write helpers.
 *  - Options-object widening (`{ readOnly: boolean }`) matches NEITHER overload (`TS2769`) —
 *    deliberate; pin so the diagnostic stays a contract, not an accident.
 *  - A genuinely union-typed options value (`ReadOnly | ReadWrite` via `declare const`, or a
 *    ternary that builds either constituent) is REJECTED with `TS2769` at the call site — pin that.
 *    Do NOT use a CFA-narrowed `const opts: RO | RW = { readOnly: true }` as a "union accepted"
 *    probe: control-flow analysis narrows that `opts` to plain `ReadOnlyTransactionOptions`.
 *  - `FirestoreRepository` is assignable TO `ReadOnlyTransactionalRepository` (interface⇄class
 *    satisfaction); the reverse remains rejected.
 *
 * Each `@ts-expect-error` FAILS the type-check if the line below it stops being an error; every
 * un-annotated call must type-check.
 */
import { z } from 'zod';
import { FirestoreRepository } from '../../index.js';
import type { ReadOnlyTransactionalRepository } from '../../index.js';

declare const db: FirebaseFirestore.Firestore;
declare const readTime: FirebaseFirestore.Timestamp;
/**
 * Genuinely union-typed options — no initializer, so CFA cannot narrow away the union. Used by
 * `sdkTrueUnionOptionsRejectedAtCallSite` to pin the real `TS2769` (not the vacuous CFA-narrowed
 * `const opts: RO | RW = { readOnly: true }` shape).
 */
declare const trueUnionOptions:
  FirebaseFirestore.ReadOnlyTransactionOptions | FirebaseFirestore.ReadWriteTransactionOptions;

const userSchema = z.object({
  name: z.string(),
  status: z.string(),
  balance: z.number(),
});
const users = FirestoreRepository.withSchema(db, 'users', userSchema);

// ---------------------------------------------------------------------------
// Read-only overload — writes and non-transactional reads are absent
// ---------------------------------------------------------------------------

export async function readOnlyCallbackExcludesWriteHelpers() {
  await users.runInTransaction(
    async (tx, repo) => {
      // Allowed: transaction-scoped read.
      const doc = await repo.getInTransaction(tx, 'u1');

      // @ts-expect-error read-only callback has no createInTransaction
      await repo.createInTransaction(tx, { name: 'x', status: 'a', balance: 0 });
      // @ts-expect-error read-only callback has no updateInTransaction
      await repo.updateInTransaction(tx, 'u1', { balance: 1 });
      // @ts-expect-error read-only callback has no patchInTransaction
      await repo.patchInTransaction(tx, 'u1', { balance: 1 });
      // @ts-expect-error read-only callback has no deleteInTransaction
      await repo.deleteInTransaction(tx, 'u1');

      return doc;
    },
    { readOnly: true },
  );
}

export async function readOnlyCallbackExcludesNonTransactionalReads() {
  await users.runInTransaction(
    async (_tx, repo) => {
      // @ts-expect-error getById bypasses the transaction and readTime — absent from the RO type
      await repo.getById('u1');
      // @ts-expect-error getAll bypasses the transaction and readTime — absent from the RO type
      await repo.getAll();
      // @ts-expect-error query() bypasses the transaction and readTime — absent from the RO type
      repo.query();
    },
    { readOnly: true },
  );
}

/**
 * Non-transactional writes / bulk helpers / hooks also bypass the transaction and `readTime`.
 * The ADR footgun story is "anything that does I/O outside the transaction" — pin the write half
 * the same way we pin `getById`, so widening the RO interface toward the full repo fails the type
 * gate instead of silently regressing.
 */
export async function readOnlyCallbackExcludesNonTransactionalWritesAndHooks() {
  await users.runInTransaction(
    async (_tx, repo) => {
      // @ts-expect-error create bypasses the transaction — absent from the RO type
      await repo.create({ name: 'x', status: 'a', balance: 0 });
      // @ts-expect-error update bypasses the transaction — absent from the RO type
      await repo.update('u1', { balance: 1 });
      // @ts-expect-error upsert bypasses the transaction — absent from the RO type
      await repo.upsert('u1', { name: 'x', status: 'a', balance: 0 });
      // @ts-expect-error bulkCreate bypasses the transaction — absent from the RO type
      await repo.bulkCreate([{ name: 'x', status: 'a', balance: 0 }]);
      // @ts-expect-error bulkUpdate bypasses the transaction — absent from the RO type
      await repo.bulkUpdate([{ id: 'u1', data: { balance: 1 } }]);
      // @ts-expect-error bulkDelete bypasses the transaction — absent from the RO type
      await repo.bulkDelete(['u1']);
      // @ts-expect-error on() mutates repo hook state outside the tx contract — absent from RO
      repo.on('beforeCreate', () => {});
      // @ts-expect-error safeValidate is intentionally outside the settled RO member set
      repo.safeValidate({ id: 'u1', name: 'x', status: 'a', balance: 0 });
    },
    { readOnly: true },
  );
}

export async function readOnlyCallbackAllowsReadSafeMembers() {
  await users.runInTransaction(
    async (tx, repo) => {
      const id = repo.id('u1');
      const fresh = repo.newId();
      // Pure path accessor — required so tx.get(query) can be built without an outer repo.
      const path = repo.getCollectionPath();
      const doc = await repo.getInTransaction(tx, id);
      if (doc) {
        const validated = repo.validate(doc);
        const schema = repo.readSchema;
        const schemas = repo.schemas;
        return [validated, schema, schemas, fresh, path] as const;
      }
      return null;
    },
    { readOnly: true },
  );
}

/**
 * The documented query-shaped PITR escape hatch must compile verbatim — this is the regression
 * guard for the missing-`fromSnapshot` defect the plan review caught. Prefer building the
 * collection reference from the callback repo's `getCollectionPath()` (not an outer repo).
 */
export async function fromSnapshotEscapeHatchCompilesVerbatim() {
  await users.runReadOnlyAt(readTime, async (tx, repo) => {
    const snap = await tx.get(
      db.collection(repo.getCollectionPath()).where('status', '==', 'active'),
    );
    return snap.docs.map(d => repo.fromSnapshot(d));
  });
}

// ---------------------------------------------------------------------------
// Old name is gone (rename regression guard)
// ---------------------------------------------------------------------------

export async function oldGetForUpdateNameIsGoneOnReadWrite() {
  await users.runInTransaction(async (tx, repo) => {
    // @ts-expect-error getForUpdateInTransaction was renamed to getInTransaction
    await repo.getForUpdateInTransaction(tx, 'u1');
  });
}

export async function oldGetForUpdateNameIsGoneOnReadOnly() {
  await users.runInTransaction(
    async (tx, repo) => {
      // @ts-expect-error getForUpdateInTransaction was renamed to getInTransaction
      await repo.getForUpdateInTransaction(tx, 'u1');
    },
    { readOnly: true },
  );
}

// ---------------------------------------------------------------------------
// Read-write / maxAttempts — writes still allowed
// ---------------------------------------------------------------------------

export async function readWriteCallbackAllowsWrites() {
  await users.runInTransaction(async (tx, repo) => {
    const doc = await repo.getInTransaction(tx, 'u1');
    if (doc) {
      await repo.updateInTransaction(tx, doc.id, { balance: doc.balance + 1 });
    }
  });
}

export async function maxAttemptsCallbackAllowsWrites() {
  await users.runInTransaction(
    async (tx, repo) => {
      await repo.createInTransaction(tx, { name: 'a', status: 'active', balance: 0 });
    },
    { maxAttempts: 3 },
  );
}

export async function runReadOnlyAtExcludesWrites() {
  await users.runReadOnlyAt(readTime, async (tx, repo) => {
    const doc = await repo.getInTransaction(tx, 'u1');
    // @ts-expect-error runReadOnlyAt callback has no updateInTransaction
    await repo.updateInTransaction(tx, 'u1', { balance: 1 });
    return doc;
  });
}

// ---------------------------------------------------------------------------
// Assignability — interface ⇄ class contract
// ---------------------------------------------------------------------------

/**
 * Pin the direction that overload 1 relies on: a full FirestoreRepository must be assignable TO
 * ReadOnlyTransactionalRepository. Without this, renaming/removing a RO member on the class can
 * leave overload 1 promising a method that is a runtime TypeError with no compile error anywhere.
 * (Call sites only check the *callback* against the interface; the implementation signature types
 * `fn` as accepting the full class, so that path never asks whether the class satisfies it.)
 */
export const fullRepositorySatisfiesReadOnlyInterface: ReadOnlyTransactionalRepository<{
  balance: number;
}> = users;

export function readOnlyRepoIsNotFullRepository(
  ro: ReadOnlyTransactionalRepository<{ name: string }>,
) {
  // @ts-expect-error ReadOnlyTransactionalRepository is not assignable to FirestoreRepository
  const full: FirestoreRepository<{ name: string }> = ro;
  return full;
}

// ---------------------------------------------------------------------------
// Options-widening / true-union guards
// ---------------------------------------------------------------------------

export async function widenedBooleanReadOnlyDoesNotMatchOverloads() {
  // `readOnly` widens to `boolean`, assignable to neither `true` nor `false | undefined`.
  const opts = { readOnly: true };
  // @ts-expect-error widened { readOnly: boolean } matches neither overload — use `as const`
  await users.runInTransaction(async () => null, opts);
}

/**
 * A genuinely union-typed options value is REJECTED (`TS2769`) — TypeScript does not resolve
 * overloads per-constituent for a true union. `trueUnionOptions` is a module-level `declare const`
 * (no initializer) so CFA cannot narrow the union away; the prior CFA-narrowed
 * `const opts: RO | RW = { readOnly: true }` probe was vacuous (opts was plain
 * ReadOnlyTransactionOptions at the call site).
 */
export async function sdkTrueUnionOptionsRejectedAtCallSite() {
  // @ts-expect-error true RO|RW union matches neither overload (TS2769)
  await users.runInTransaction(async () => null, trueUnionOptions);
}

/**
 * Realistic forwarding-helper shape: a ternary that builds either constituent is still a union at
 * the call site and must also be rejected (`TS2769`). Pin both shapes so neither regresses into a
 * silent "accepted via CFA" false green.
 */
export async function sdkTernaryUnionOptionsRejectedAtCallSite(readOnly: boolean) {
  const opts = readOnly
    ? ({ readOnly: true } as FirebaseFirestore.ReadOnlyTransactionOptions)
    : ({ maxAttempts: 3 } as FirebaseFirestore.ReadWriteTransactionOptions);
  // @ts-expect-error ternary-built RO|RW union matches neither overload (TS2769)
  await users.runInTransaction(async () => null, opts);
}

/**
 * Document the CFA caveat so a future maintainer does not "fix" the true-union rejection by
 * reintroducing an initialized `const opts: RO | RW = { readOnly: true }` and claiming the union
 * is accepted. This probe pins that such an `opts` *is* narrowed to RO (assignable to RO alone).
 */
export function cfaNarrowedUnionInitializerIsNotATrueUnion() {
  const optsNarrowed:
    FirebaseFirestore.ReadOnlyTransactionOptions | FirebaseFirestore.ReadWriteTransactionOptions = {
    readOnly: true,
  };
  // Compiles ⇒ CFA narrowed optsNarrowed to ReadOnlyTransactionOptions (not the full union).
  const isNarrowedToReadOnly: FirebaseFirestore.ReadOnlyTransactionOptions = optsNarrowed;
  return isNarrowedToReadOnly;
}
