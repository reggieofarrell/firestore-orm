---
title: 'Queries'
description: 'Query builder, aggregations, streaming, and real-time subscriptions.'
---

Build type-safe reads, aggregations, streams, and real-time subscriptions with the fluent query
builder.

## Query builder

Call `repo.query()` to get a `FirestoreQueryBuilder<T, W, S>`. It exposes a fluent, type-safe
interface for composing filters, ordering, projections, aggregations, pagination, streaming, and
real-time listeners. Chain the builder methods and then call a terminal method (`get()`, `getOne()`,
`exists()`, `count()`, `paginate()`, and so on) to execute the query.

```typescript
const results = await orderRepo
  .query()
  .where('status', '==', 'pending')
  .where('total', '>', 100)
  .where('createdAt', '>=', startOfMonth)
  .orderBy('total', 'desc')
  .limit(50)
  .get();
```

The chainable builder methods are:

- `where(field, op, value)` — add a filter clause. `where('id', …)` is a compile error — the
  synthetic `id` is not a queryable field path; use `whereId(...)` instead.
- `whereId(op, value)` — query by document name. Scalar operators take a `string`; `in`/`not-in`
  take a `readonly string[]`.
- `select(...fields)` — project only the named fields.
- `orderBy(field, dir = 'asc')` — sort results (required before `paginate()`).
- `orderById(dir = 'asc')` — order by document name.
- `limit(n)` — cap the number of documents returned.

Terminal methods that execute the query include `get()`, `getOne()`, `exists()`, `count()`,
`collectionCount()`, `sum()`, `average()`, `distinctValues()`, `paginate()`, `offsetPaginate()`,
`paginateWithCount()`, `stream()`, `onSnapshot()`, `update()`, and `delete()`. There is no public
`.startAfter()` chaining — cursor pagination is handled entirely through
`paginate(pageSize, cursor)`.

**Performance note:** Firestore charges per document read. Use `limit()` and pagination to control
costs on large collections — see [Performance](./performance/) for the full cost model.

## Filtering

Stack `where()` clauses to narrow results. All standard Firestore operators are supported, including
`in`, `array-contains`, and range comparisons.

```typescript
const results = await userRepo
  .query()
  .where('age', '>', 18)
  .where('status', 'in', ['active', 'verified'])
  .where('tags', 'array-contains', 'premium')
  .get();
```

## Sorting

Chain `orderBy()` calls to sort by one or more fields. The direction defaults to `'asc'`.

```typescript
const sorted = await productRepo.query().orderBy('price', 'desc').orderBy('name', 'asc').get();
```

## Pagination

`paginate(pageSize, cursor?)` performs cursor-based pagination and returns
`{ items, nextCursor, hasMore }`. It **requires** at least one prior `orderBy()` call for a stable
cursor and **throws** if `pageSize` is less than or equal to `0`. Pass the previous page's
`nextCursor` to fetch the next page.

```typescript
// Cursor-based pagination (recommended)
// orderBy() is required for stable cursor pagination
const { items, nextCursor, hasMore } = await userRepo
  .query()
  .orderBy('createdAt', 'desc')
  .paginate(20);

// Next page
const nextPage = await userRepo.query().orderBy('createdAt', 'desc').paginate(20, nextCursor);
```

Use `offsetPaginate(page, pageSize)` for offset-based pagination. It is simpler but less efficient
on large datasets, since Firestore must scan and discard the skipped documents.

```typescript
// Offset pagination (less efficient for large datasets)
const page2 = await userRepo.query().orderBy('createdAt', 'desc').offsetPaginate(2, 20);
```

`paginateWithCount(pageSize, cursor?)` combines `paginate()` and `count()` in a single call,
returning the same `{ items, nextCursor, hasMore }` plus a `total` count of all matching documents.
It performs an extra aggregation read.

```typescript
const { items, nextCursor, hasMore, total } = await productRepo
  .query()
  .where('inStock', '==', true)
  .orderBy('createdAt', 'desc')
  .paginateWithCount(20, lastCursor);

console.log(`Showing ${items.length} of ${total} products`);
```

## Aggregations

Aggregations run server-side and are billed at a reduced rate compared to reading every matching
document.

```typescript
// Sum a numeric field across matching documents
const totalRevenue = await orderRepo.query().where('status', '==', 'completed').sum('total');

// Average a numeric field — returns null (not 0) when there are no numeric values
const avgRating = await reviewRepo.query().where('productId', '==', 'prod-123').average('rating');

// Count matching documents
const activeCount = await userRepo.query().where('status', '==', 'active').count();

// Total collection count — ignores any accumulated where() clauses
const totalUsers = await userRepo.query().where('status', '==', 'active').collectionCount();

// Existence check
const hasOrders = await orderRepo.query().where('userId', '==', 'user-123').exists();

// Distinct values for a field — drops undefined but preserves stored null
const categories = await productRepo.query().distinctValues('category');
```

`count()` respects the query's filters, whereas `collectionCount()` counts the entire collection and
ignores any `where()` clauses on the builder. `sum(field)` and `average(field)` operate on numeric
fields; `average(field)` returns `number | null`, yielding `null` (distinct from `0`) when there are
no numeric values. `distinctValues(field)` returns the unique values for a field, dropping
`undefined` but preserving stored `null`.

## Selecting fields

Use `select()` to project only the fields you need. This reduces payload size but does not reduce
the document-read cost.

```typescript
const userEmails = await userRepo
  .query()
  .where('subscribed', '==', true)
  .select('email', 'name')
  .get();
```

`select()` returns a **new** query builder (it does not mutate the one you called it on), and the
result type narrows to `FirestoreDocument<DeepPartial<T>>` — every property, including nested map
properties, is optional, so a field you projected away (at any depth) is a compile error to access
without a guard. A `readConverter` written for full documents may throw on a projected result. Note
that a projected query cannot be used with `onSnapshot()` (see below).

## Bulk query operations

`query().update(data)` updates every document matching the query and returns the number of documents
**written**; `query().delete()` deletes every matching document and returns the **matched (deleted)
count**.

> **Note:** `query().update()` runs the **bulk** lifecycle hooks `beforeBulkUpdate` (which may
> mutate the update payload before validation) and `afterBulkUpdate` (receiving `{ ids }` of the
> written documents); `query().delete()` runs `beforeBulkDelete` and `afterBulkDelete` (receiving
> `{ ids, documents }`). The per-document `before/afterUpdate` and `before/afterDelete` hooks do not
> run here — use the single-document methods if you need those. See
> [Lifecycle hooks](./lifecycle-hooks/).

```typescript
// Update all matching documents; returns the number of documents written
const updatedCount = await orderRepo
  .query()
  .where('status', '==', 'pending')
  .update({ status: 'processing' });

// Delete all matching documents; returns the number of documents matched
const deletedCount = await userRepo.query().where('lastLogin', '<', oneYearAgo).delete();

// Delete matching documents with multiple filters
await orderRepo
  .query()
  .where('status', '==', 'cancelled')
  .where('createdAt', '<', sixMonthsAgo)
  .delete();
```

## Streaming for large datasets

`stream()` returns an async generator that yields matching documents one at a time, avoiding the
memory cost of loading an entire result set at once.

```typescript
// Stream all users without loading them into memory
for await (const user of userRepo.query().stream()) {
  await sendEmail(user.email);
  console.log(`Processed user ${user.id}`);
}

// Stream with filters
for await (const order of orderRepo.query().where('status', '==', 'pending').stream()) {
  await processOrder(order);
}
```

**Performance cost:** Streaming still reads every matching document, so you are charged for every
document read. Use appropriate filters and limits.

## Real-time subscriptions

`onSnapshot(callback, onError?)` subscribes to live query results. It resolves to an unsubscribe
function — call it to stop listening. The callback receives the current set of matching documents on
every change.

`onSnapshot()` cannot be combined with `select()`: Firestore does not allow a real-time listener on
a field-masked query, so the builder throws locally with a clear error. Listen without `select()`
and project inside your callback, or use `get()` / `stream()` for a one-time projected read.

```typescript
// Subscribe to query results
const unsubscribe = await orderRepo
  .query()
  .where('status', '==', 'active')
  .onSnapshot(
    orders => {
      console.log(`Active orders: ${orders.length}`);
      updateDashboard(orders);
    },
    error => {
      console.error('Snapshot error:', error);
    },
  );

// Stop listening when done
unsubscribe();
```

**Cost warning:** Real-time listeners charge you for every document that matches your query, plus
additional reads when documents change. Use narrow filters and consider polling for less critical
data.
