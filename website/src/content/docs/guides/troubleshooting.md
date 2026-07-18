---
title: 'Troubleshooting'
description: 'Common FirestoreORM errors and how to fix them.'
---

Common errors, gotchas, and their fixes when working with the repository, query builder,
transactions, and subcollections.

## 1. Composite Index Required

**Error:** `Query requires a Firestore index`

The library surfaces this as a `FirestoreIndexError` (see [Error handling](./error-handling/)),
whose message includes the console URL Firestore generated for the missing index.

**Solution:** Click the URL in the error message to create the index, then wait 1–2 minutes for it
to build before retrying the query.

## 2. Hooks in Transactions

Hooks behave differently inside transactions, and this trips people up. The second argument passed
to your `runInTransaction` callback is a **transaction-scoped repository** — you must use that
`repo`, not the outer one, for every write helper inside the callback.

```typescript
// beforeCreate DOES fire on the tx-scoped repo; after* hooks do NOT fire in transactions
await repo.runInTransaction(async (tx, repo) => {
  await repo.createInTransaction(tx, data);
  // beforeCreate ran; afterCreate will NOT run here
});
```

The distinction:

- **`before*` hooks** (`beforeCreate`, `beforeUpdate`, `beforeDelete`) **do** fire on the tx-scoped
  `repo`'s transaction helpers (`createInTransaction`, `updateInTransaction` / `patchInTransaction`,
  `deleteInTransaction`).
- **`after*` hooks** (`afterCreate`, `afterUpdate`, `afterDelete`) do **not** fire inside
  transactions. The transaction hasn't committed yet while the callback runs, so post-commit side
  effects belong outside it.

**Solution:** Return what you need from the transaction and run side effects after it resolves:

```typescript
const result = await repo.runInTransaction(async (tx, repo) => {
  const doc = await repo.createInTransaction(tx, data);
  return doc;
});

// Now run side effects (the transaction has committed)
await sendEmail(result.email);
```

> Note: `query().update()` and `query().delete()` never run hooks either — hooks only run through
> the repository's own write methods (and, for `before*`, the tx-scoped helpers above). See
> [Lifecycle hooks](./lifecycle-hooks/) and [Transactions](./transactions/).

## 3. "in" Query Limit (30 values)

```typescript
// Firestore allows at most 30 values in an `in` / `not-in` / `array-contains-any` filter
await userRepo
  .query()
  .where('id', 'in', arrayOf50Ids) // ERROR
  .get();
```

**Solution:** Chunk your queries into batches of 30 or fewer:

```typescript
const chunks = chunkArray(ids, 30);
const results = [];

for (const chunk of chunks) {
  const users = await userRepo.query().where('id', 'in', chunk).get();
  results.push(...users);
}
```

## 4. Query Ordering Requires Index

```typescript
// This requires a composite index
await repo
  .query()
  .where('status', '==', 'active')
  .orderBy('createdAt', 'desc') // Different field from the where clause
  .get();
```

**Solution:** Create the composite index via the link in the error message, or order by the same
field you filter on. See [Queries](./queries/) for the full query-builder surface.

## 5. Subcollection Parent ID Lost

When querying a subcollection, the parent document ID isn't automatically included in the returned
documents.

**Solution:** Read it from the repository with `getParentId()`:

```typescript
const ordersRepo = userRepo.subcollection('user-123', 'orders');
const parentId = ordersRepo.getParentId(); // 'user-123'
```

`getParentId()` returns the parent ID for a subcollection repository, or `null` for a top-level
repository. See [Subcollections](./subcollections/) for more.

## 6. Dot Notation in Transactions

**Issue:** Your transaction logic needs the current document state before it can compute an update.

**Solution:** Read inside the transaction with `getForUpdateInTransaction()` only when your business
rules actually need the prior state, then apply a dot-notation update:

```typescript
await repo.runInTransaction(async (tx, repo) => {
  const doc = await repo.getForUpdateInTransaction(tx, 'doc-123');
  if (!doc) throw new Error('Document not found');
  await repo.updateInTransaction(tx, 'doc-123', {
    'nested.field': 'value',
  } as any);
});
```

See [Dot-notation nested updates](./dot-notation/) and [Transactions](./transactions/) for details.
