---
title: 'Troubleshooting'
description: 'Common FirestoreORM errors and how to fix them.'
---

Common errors, gotchas, and their fixes when working with the repository, query builder,
transactions, and subcollections.

## 1. Composite Index Required

**Error:** `Query requires a Firestore index`

The library surfaces this as a `FirestoreIndexError` (see
[Error handling](/firestore-orm/reference/errors/)), whose message includes the console URL
Firestore generated for the missing index.

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

> Note: `query().update()` and `query().delete()` **do** run the bulk hooks
> (`beforeBulkUpdate`/`afterBulkUpdate`, `beforeBulkDelete`/`afterBulkDelete`) — they do not run the
> per-document `before/afterUpdate` / `before/afterDelete` hooks. Inside transactions, only
> `before*` hooks run (via the tx-scoped helpers above). See
> [Lifecycle hooks](/firestore-orm/guides/concepts/lifecycle-hooks/) and
> [Transactions](/firestore-orm/guides/working-with-data/transactions/).

## 3. "in" Query Limit (30 values)

```typescript
// Firestore allows at most 30 values in an `in` / `not-in` / `array-contains-any` filter
await userRepo
  .query()
  .whereId('in', arrayOf50Ids) // ERROR: too many values
  .get();
```

**Solution:** Chunk your queries into batches of 30 or fewer:

```typescript
const chunks = chunkArray(ids, 30);
const results = [];

for (const chunk of chunks) {
  const users = await userRepo.query().whereId('in', chunk).get();
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
field you filter on. See [Queries](/firestore-orm/guides/working-with-data/queries/) for the full
query-builder surface.

## 5. Subcollection Parent ID Lost

When querying a subcollection, the parent document ID isn't automatically included in the returned
documents.

**Solution:** Read it from the repository with `getParentId()`:

```typescript
import { z } from 'zod';

const orderSchema = z.object({ total: z.number() });
const ordersRepo = userRepo.subcollection('user-123', 'orders', orderSchema);
const parentId = ordersRepo.getParentId(); // 'user-123'
```

`getParentId()` returns the parent ID for a subcollection repository, or `null` for a top-level
repository. See [Subcollections](/firestore-orm/guides/working-with-data/subcollections/) for more.

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
  });
});
```

See [Dot-notation nested updates](/firestore-orm/guides/working-with-data/dot-notation/) and
[Transactions](/firestore-orm/guides/working-with-data/transactions/) for details.

## 7. Composite Filter Limits (OR queries)

Firestore normalizes a composite filter into a disjunctive form and enforces three limits on the
**server**, so they arrive as `INVALID_ARGUMENT` rather than a local error:

```typescript
// Too many disjunctions after normalization. Result had 31 disjunctions which is
// more than the maximum of 30
await postRepo
  .query()
  .whereFilter(f => f.or(...thirtyOneConditions))
  .get();

// 'NOT_IN' cannot be used in the same query with 'IN', 'ARRAY_CONTAINS_ANY' or 'OR'
await postRepo
  .query()
  .whereFilter(f => f.or(f.where('status', 'not-in', ['draft']), f.where('pinned', '==', true)))
  .get();

// Only a single 'NOT_EQUAL' … filter allowed per query
await postRepo
  .query()
  .whereFilter(f => f.or(f.where('status', '!=', 'draft'), f.where('visibility', '!=', 'public')))
  .get();
```

Watch for the multiplication: an `in` with N values _inside_ an OR branch expands to N disjunctions,
so a few branches can cross the cap of 30 quickly.

**Solution:** Chunk and merge, the same pattern as the `in` limit above — run one query per group of
branches and dedupe by `id`:

```typescript
const groups = chunkArray(conditions, 10);
const byId = new Map<string, Post>();

for (const group of groups) {
  const rows = await postRepo
    .query()
    .whereFilter(f => f.or(...group.map(c => c(f))))
    .get();
  rows.forEach(row => byId.set(row.id, row));
}

const posts = [...byId.values()];
```

Because Firestore normalizes the filter and evaluates each disjunct, a composite query can also
require composite index coverage for more than one branch — one `whereFilter()` may surface several
successive `FirestoreIndexError`s. Create the index from each error's link until every branch is
covered.

**Note:** the ORM deliberately does not pre-check these limits locally. A local copy of the server's
normalization rules would risk rejecting a query Firestore would happily accept, would drift as the
backend changes, and could not see clauses added outside the callback anyway. The one thing the ORM
_does_ reject locally is an **empty** `f.or()` / `f.and()` group, because Firestore silently drops
it and matches every document instead of failing.

## 8. OR Query Returns Fewer Rows Than One of Its Branches

**Issue:** a `whereFilter(f => f.or(...))` query returns fewer documents than one of its own
disjuncts returns on its own.

**Cause:** an inequality (`<`, `<=`, `>`, `>=`, `!=`, `not-in`) anywhere in the filter tree makes
Firestore add an implicit `orderBy` on that field, and a document missing an ordered field cannot
appear in the results — even if it matched a completely different branch.

```typescript
// Three documents have kind: 'x'; two of them have no `score` field.
await postRepo.query().where('kind', '==', 'x').get(); // → 3 documents
await postRepo
  .query()
  .whereFilter(f => f.or(f.where('score', '>', 5), f.where('kind', '==', 'x')))
  .get(); // → 1 document
```

`count()` reports the same reduced number, and the `update()` / `delete()` terminals silently skip
the excluded documents.

**Solution:** keep inequalities out of `or()` branches. Use equality, `in`, or `array-contains` /
`array-contains-any` inside a disjunction; `f.whereId(...)` with a comparison operator is also safe
(Firestore skips `documentId()` when adding implicit orders, and a document name always exists).
Otherwise, guarantee the field is always written, or run the branches as separate queries and merge
by `id`.
