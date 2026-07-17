# Transactions

Run atomic multi-document reads and writes through a transaction-scoped, hook-aware repository.

[← Documentation index](./README.md) · [Project README](../../README.md)

Transactions ensure atomic operations across multiple documents. Use them when consistency is
critical (e.g., transferring balances, inventory management): either every write in the callback
commits together, or none of them do.

## Running a transaction

Call `runInTransaction` on a repository. The callback receives two arguments:

- `tx` — the underlying Firestore transaction handle, passed to each transaction write helper.
- `repo` — a **transaction-scoped repository**. Use it for all reads and writes inside the callback
  so that `before*` hooks and validation still run.

```typescript
await accountRepo.runInTransaction(async (tx, repo) => {
  const from = await repo.getForUpdateInTransaction(tx, 'account-1');
  const to = await repo.getForUpdateInTransaction(tx, 'account-2');

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

## Transaction write helpers

All reads and writes inside the callback go through the transaction-scoped `repo` and take the `tx`
handle as their first argument:

| Method                                        | Behavior                                                                                |
| --------------------------------------------- | --------------------------------------------------------------------------------------- |
| `getForUpdateInTransaction(tx, id)`           | Reads a document for update; returns the document (with `id`) or `null` if it is absent |
| `createInTransaction(tx, data)`               | Creates a document with an auto-generated Firestore id                                  |
| `updateInTransaction(tx, id, data, options?)` | Updates the document identified by `id`                                                 |
| `patchInTransaction(tx, id, data)`            | Merge-patches the document identified by `id` (always merges; takes **no** options)     |
| `deleteInTransaction(tx, id)`                 | Deletes the document identified by `id`                                                 |

Notes:

- Firestore requires that **all reads happen before any writes** within a transaction. Do your
  `getForUpdateInTransaction` reads first, then perform writes.
- `id` is always stripped from write payloads. The document id comes from the auto-generated
  Firestore id for `createInTransaction`, and from the `id` argument for `updateInTransaction`,
  `patchInTransaction`, and `deleteInTransaction`.
- `patchInTransaction` always merges and, unlike the non-transaction `patch`, takes no options
  argument.

## Hooks inside transactions

Hooks fire inside a transaction **only** when writes go through the transaction-scoped `repo` passed
into the callback. See [Lifecycle hooks](./lifecycle-hooks.md) for the full event list.

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
