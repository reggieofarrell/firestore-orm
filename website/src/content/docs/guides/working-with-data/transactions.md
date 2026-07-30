---
title: 'Transactions'
description: 'runInTransaction, runReadOnlyAt, and transaction-scoped repository methods.'
---

Run atomic multi-document reads and writes through a transaction-scoped, hook-aware repository.

Transactions ensure atomic operations across multiple documents. Use them when consistency is
critical (e.g., transferring balances, inventory management): either every write in the callback
commits together, or none of them do.

## Running a transaction

Call `runInTransaction` on a repository. The callback receives two arguments:

- `tx` — the underlying Firestore transaction handle, passed to each transaction write helper.
- `repo` — a **transaction-scoped repository**. Prefer its `*InTransaction` helpers for reads and
  writes inside the callback so that `before*` hooks and validation still run, and so reads stay
  inside the transaction (and inside any `readTime` snapshot).

  Non-transactional methods on a full repo (`getById`, `getAll`, `query()`, `create()`, …) perform
  I/O **outside** the transaction — and outside `readTime`. When `readOnly: true`, the callback
  `repo` is narrowed to `ReadOnlyTransactionalRepository` so those methods are absent from the type;
  a read-write callback still receives the full repository and relies on you not calling them.

  Prefer `*InTransaction` helpers so `before*` hooks and validation still run. Raw `tx.set` /
  `tx.update` / `tx.delete` bypass repository validation and hooks entirely.

### Transaction hook context and retries

`before*` hooks fired from `*InTransaction` receive `HookContext` with
`execution: 'transaction'`, `retryable: true`, and an `attempt` field:

- Inside `runInTransaction`, `attempt` is a **1-based** count of how many times the ORM wrapper has
  entered the Admin SDK callback for this logical call (contention may re-enter).
- When you call `*InTransaction` with a **caller-managed** raw `db.runTransaction` handle, `attempt`
  is `null` — the ORM cannot observe the outer callback.
- `attempt` is **diagnostic only**. Do not use it as an idempotency or deduplication key.

`after*` hooks do **not** run inside a transaction (the write is not committed until the callback
returns). For non-durable side effects, return data from the callback and run them after success —
or use a durable outbox when available ([#80](https://github.com/reggieofarrell/firestore-orm/issues/80)).

Calling a normal `create()` / `update()` on the transaction-scoped `repo` is still a **direct**
write (outside the transaction); its hooks report `execution: 'direct'`.

```typescript
await accountRepo.runInTransaction(async (tx, repo) => {
  const from = await repo.getInTransaction(tx, 'account-1');
  const to = await repo.getInTransaction(tx, 'account-2');

  if (!from || from.balance < 100) {
    throw new Error('Insufficient funds');
  }

  await repo.updateInTransaction(tx, from.id, {
    balance: from.balance - 100,
  });

  await repo.updateInTransaction(tx, to.id, {
    balance: to.balance + 100,
  });
});
```

The value returned from the callback becomes the resolved value of `runInTransaction`, which lets
you hand data back to the surrounding code (see
[post-transaction side effects](#solution-for-post-transaction-side-effects)).

## Transaction options

`runInTransaction` accepts an optional second argument that is forwarded verbatim to the Admin SDK's
`db.runTransaction(fn, options)`:

| Options shape                                          | Callback `repo` type              | Notes                                                                                                          |
| ------------------------------------------------------ | --------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| omitted / `{ maxAttempts?: number; readOnly?: false }` | full `FirestoreRepository`        | Default retries (SDK default is 5). `maxAttempts` must be an integer ≥ 1 — the SDK validates this client-side. |
| `{ readOnly: true; readTime?: Timestamp }`             | `ReadOnlyTransactionalRepository` | No document locks; not retried. Optional `readTime` for a consistent / PITR snapshot.                          |

```typescript
// Cap contention retries
await counterRepo.runInTransaction(
  async (tx, repo) => {
    const counter = await repo.getInTransaction(tx, 'global-counter');
    await repo.updateInTransaction(tx, 'global-counter', {
      value: (counter?.value || 0) + 1,
    });
  },
  { maxAttempts: 3 },
);
```

**Options-object typing.** Prefer an inline literal (or `as const` /
`satisfies FirebaseFirestore.ReadOnlyTransactionOptions`). Two shapes that do **not** match the
overloads (`TS2769`):

- `const opts = { readOnly: true }` — `readOnly` widens to `boolean`.
- a variable typed as the SDK's `ReadOnlyTransactionOptions | ReadWriteTransactionOptions` union
  (including `declare`d parameters, helper return values, and ternary-built options). Narrow before
  the call, or pass a single-constituent literal / `satisfies` value.

A `const` annotated as the union **with an initializer** can be control-flow-narrowed to that
initializer (so `const opts: RO | RW = { readOnly: true }` may appear to work) — that is not the
union being accepted.

## Read-only transactions

Pass `{ readOnly: true }` when you need a consistent snapshot without taking locks (and without
retries). The callback `repo` is `ReadOnlyTransactionalRepository` — only the read-safe member set:

- `getInTransaction(tx, id)` — transaction-scoped read (lock-free in this mode)
- `getManyInTransaction(tx, ids, options?)` — batched transaction-scoped read (lock-free in this mode)
- `fromSnapshot(snapshot)` — map a `tx.get(query)` / trigger snapshot into the read model
- `validate` / `id` / `newId` / `getCollectionPath` — pure helpers
- `readSchema` / `schemas` — schema accessors

Write helpers and non-transactional reads are **absent from the type**. At runtime the SDK still
rejects a write attempted through the raw `tx` handle with a plain `Error` whose message matches
`Firestore read-only transactions cannot execute writes.` (no `code`).

```typescript
const snapshot = await accountRepo.runInTransaction(
  async (tx, repo) => repo.getInTransaction(tx, 'account-1'),
  { readOnly: true },
);
```

## PITR reads

Point-in-time reads go through a **read-only** transaction with `readTime`. Prefer the convenience:

```typescript
const historical = await accountRepo.runReadOnlyAt(readTime, async (tx, repo) => {
  return repo.getInTransaction(tx, 'account-1');
});
```

Equivalent options form: `runInTransaction(fn, { readOnly: true, readTime })`.

**`readTime` window.** Without PITR retention enabled on the database, Firestore accepts a
`readTime` within about the last 60 seconds. With
[PITR](https://firebase.google.com/docs/firestore/enterprise/pitr) enabled, you can read within the
configured retention window (minute granularity). Enabling PITR is a control-plane concern and stays
out of the ORM.

**Emulator note.** The Firestore emulator accepts a `readTime` well past the 60s window without
error, where production rejects it absent PITR retention. Local success is **not** proof the
production call will succeed. Time-travel itself _is_ honored on the emulator (including through
`tx.get(query)`).

### Query-shaped PITR (escape hatch)

There is no ORM query-in-transaction API yet. For a filtered PITR read, use the Admin SDK query on
`tx` and map with `fromSnapshot` (available on the read-only callback repo):

```typescript
await userRepo.runReadOnlyAt(readTime, async (tx, repo) => {
  const snap = await tx.get(
    db.collection(repo.getCollectionPath()).where('status', '==', 'active'),
  );
  return snap.docs.map(d => repo.fromSnapshot(d));
});
```

## Transaction write helpers

All reads and writes inside the callback go through the transaction-scoped `repo` and take the `tx`
handle as their first argument:

| Method                                        | Behavior                                                                                                                                                                        |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `getInTransaction(tx, id)`                    | Reads a document inside the transaction; returns the document (with `id`) or `null` if it is absent. Takes a lock in a read-write transaction; lock-free when `readOnly: true`. |
| `createInTransaction(tx, data)`               | Creates a document with an auto-generated Firestore id                                                                                                                          |
| `createWithIdInTransaction(tx, id, data)`     | Create-only under a caller-supplied id; a collision raises `ConflictError`                                                                                                      |
| `updateInTransaction(tx, id, data, options?)` | Updates the document identified by `id`; options are `{ merge?, lastUpdateTime? }`                                                                                              |
| `patchInTransaction(tx, id, data, options?)`  | Merge-patches the document identified by `id` (always merges); options are `{ lastUpdateTime? }`                                                                                |
| `deleteInTransaction(tx, id, options?)`       | Deletes the document identified by `id`; options are `{ lastUpdateTime? }`                                                                                                      |

Notes:

- Firestore requires that **all reads happen before any writes** within a transaction. Do your
  `getInTransaction` reads first, then perform writes.
- `id` is always stripped from write payloads. The document id comes from the auto-generated
  Firestore id for `createInTransaction`, and from the `id` argument for
  `createWithIdInTransaction`, `updateInTransaction`, `patchInTransaction`, and
  `deleteInTransaction`.
- `patchInTransaction` always merges. Unlike the non-transaction `patch`, it has no `returnDoc`
  option (a transaction cannot read a document back after writing it); it does accept
  `{ lastUpdateTime? }` for optimistic concurrency.
- A failed `lastUpdateTime` precondition (or a create-only collision) does **not** trigger a
  transaction retry — Firestore retries on contention, not on a rejected precondition. The callback
  runs once and the whole transaction fails with `PreconditionFailedError` / `ConflictError`. Inside
  a read-write transaction the transaction's own lock is usually the better tool; a precondition is
  for a token read _outside_ the transaction. See
  [Conditional writes](/firestore-orm/guides/working-with-data/crud-operations/#conditional-writes).
- `getByIdWithUpdateTime` is deliberately **absent** from the transaction helpers (and from
  `ReadOnlyTransactionalRepository`): it performs non-transactional I/O and would bypass both the
  transaction and any `readTime`. Plain `getMany` is absent for the same reason — use
  `getManyInTransaction` inside the callback instead.
- Write helpers are unavailable on the typed surface of a read-only / `runReadOnlyAt` callback.

## Hooks inside transactions

Hooks fire inside a transaction **only** when writes go through the transaction-scoped `repo` passed
into the callback. See [Lifecycle hooks](/firestore-orm/guides/concepts/lifecycle-hooks/) for the
full event list.

### No `after*` hooks on transaction write helpers

`createInTransaction`, `updateInTransaction`, `patchInTransaction`, and `deleteInTransaction` run
their `before*` hooks (before validation and the write) but skip the corresponding `after*` hooks by
design, so side effects stay outside the atomic transaction commit.

```typescript
// WORKS - beforeUpdate runs before the transaction commits
orderRepo.on('beforeUpdate', data => {
  if (data.quantity < 0) {
    throw new Error('Negative quantity not allowed');
  }
});

// DOES NOT WORK - afterUpdate won't run in a transaction
orderRepo.on('afterUpdate', async ({ id }) => {
  await sendEmailByUserId(id); // This will NOT execute
});
```

Hooks registered on the repository apply when you use the transaction-scoped `repo` from
`runInTransaction`; a `before*` hook that throws aborts the transaction before it commits, which is
what makes it a good place for validation and invariant checks.

### Solution for post-transaction side effects

Because `after*` hooks do not run inside a transaction, perform side effects after
`runInTransaction` resolves. Return whatever you need from the callback and act on it once the
commit has succeeded:

```typescript
const result = await accountRepo.runInTransaction(async (tx, repo) => {
  // ... transaction logic
  return { from, to };
});

// Run side effects AFTER the transaction succeeds
await auditLog.record('transfer_completed', result);
await sendEmail(result.from.email);
```

This guarantees the side effects only run when the transaction actually committed — if the
transaction throws or is aborted, `runInTransaction` rejects and the side-effect code never runs.
