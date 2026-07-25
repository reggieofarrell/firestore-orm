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
- `whereFilter(build)` — compose a nested AND/OR filter with a schema-aware filter factory.
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
costs on large collections — see [Performance](/firestore-orm/guides/designing/performance/) for the
full cost model.

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

## Composite AND/OR filters

Chained `where()` clauses are an implicit **AND** — every clause must match. For a **disjunction**,
use `whereFilter()`. The callback receives a filter factory whose field paths are typed against your
stored model at every nesting depth, so a typo inside a nested group is still a compile error.

```typescript
// status == 'published' OR (authorId == me AND visibility == 'private')
const posts = await postRepo
  .query()
  .whereFilter(f =>
    f.or(
      f.where('status', '==', 'published'),
      f.and(f.where('authorId', '==', currentUserId), f.where('visibility', '==', 'private')),
    ),
  )
  .orderBy('createdAt', 'desc')
  .get();
```

`f.whereId(op, value)` puts a document-name condition inside a group, with the same validated id
boundary as `whereId()`:

```typescript
const feed = await postRepo
  .query()
  .where('deleted', '==', false) // AND-ed with the composite below
  .whereFilter(f => f.or(f.where('pinned', '==', true), f.whereId('in', featuredIds)))
  .get();
```

A `whereFilter()` combines with everything else on the builder — chained `where()` clauses,
`orderBy`/`limit`, `select`, the aggregations, pagination, `stream()`, `onSnapshot()`, and the
`update()`/`delete()` terminals.

Two things to know:

- **`f.or()` / `f.and()` with no arguments throws.** Firestore silently _drops_ an empty composite
  filter, so an empty group would widen your query to every document in the collection instead of
  failing. If you build groups dynamically, check for an empty list first:

  ```typescript
  const posts = statuses.length
    ? await postRepo
        .query()
        .whereFilter(f => f.or(...statuses.map(s => f.where('status', '==', s))))
        .get()
    : [];
  ```

- **An OR query can need more indexes than you expect.** Firestore normalizes a composite filter
  into disjunctive form and evaluates each disjunct, so one `whereFilter()` may surface several
  successive `FirestoreIndexError`s — follow each link until every branch is covered. The server
  also caps a query at 30 disjunctions after normalization; see
  [Troubleshooting](/firestore-orm/reference/troubleshooting/) and
  [Performance & Cost](/firestore-orm/guides/designing/performance/).

### ⚠️ An inequality inside an OR branch excludes documents missing that field

Firestore adds an implicit `orderBy` for every inequality field (`<`, `<=`, `>`, `>=`, `!=`) found
anywhere in the filter tree, and a document that lacks an ordered field cannot appear in the
results. (`not-in` is an inequality too, but it can never appear inside an `OR` — Firestore rejects
that combination outright.) Inside a disjunction that means an inequality in **one** branch can drop
documents matched by **another** branch — so an OR query can return _fewer_ rows than one of its own
disjuncts:

```typescript
// 3 documents have kind: 'x'; two of them have no `score` field at all.
await postRepo.query().where('kind', '==', 'x').get(); // → 3 documents

await postRepo
  .query()
  .whereFilter(f => f.or(f.where('score', '>', 5), f.where('kind', '==', 'x')))
  .get(); // → 1 document — the two without `score` are gone
```

`count()` returns the same reduced number, so this is query planning, not a read-path quirk. It also
applies to the destructive `update()` / `delete()` terminals, which would silently skip those
documents.

**Safe shapes inside `or()`:** equality, `in`, `array-contains` / `array-contains-any` — and
`f.whereId(...)` with a comparison operator, which is exempt because Firestore skips `documentId()`
when adding implicit orders and a document name always exists.

If you need an inequality branch, either guarantee the field is always written (give it a default at
create time) or run the branches as separate queries and merge the results by `id`.

Returning a prebuilt Admin SDK `Filter` (`f => myFilter`) is supported as an escape hatch, applied
verbatim without the factory's typed paths or id validation.

### ⚠️ An empty prebuilt sub-group is dropped, not rejected

The zero-argument guard above is an **arity** check on `f.and()` / `f.or()`. It cannot see inside a
`Filter` you built yourself, so an empty SDK group — whether returned whole or passed in as a child
of a factory group — is silently discarded by Firestore and changes what the query means:

```typescript
import { Filter } from 'firebase-admin/firestore';

// `TRUE OR published` should match everything; the empty AND is dropped, so this NARROWS to published
.whereFilter(f => f.or(Filter.and(), f.where('status', '==', 'published')))

// `FALSE AND published` should match nothing; the empty OR is dropped, so this WIDENS to published
.whereFilter(f => f.and(Filter.or(), f.where('status', '==', 'published')))
```

Only a filter that reduces to **no conditions at all** is caught (the query would otherwise match
the whole collection). Build groups with `f.and()` / `f.or()` and the arity guard covers you; if you
assemble raw SDK filters, check for empty groups yourself before passing them in.

To reuse a filter group across call sites, extract it as a predicate and annotate the factory with
`StoredDataOf<typeof repo>` — which is already the stored shape without the synthetic `id`:

```typescript
import type { QueryFilterFactory, StoredDataOf } from '@reggieofarrell/firestore-orm';

const publishedOrMine = (uid: string) => (f: QueryFilterFactory<StoredDataOf<typeof postRepo>>) =>
  f.or(f.where('status', '==', 'published'), f.where('authorId', '==', uid));

const posts = await postRepo.query().whereFilter(publishedOrMine(currentUserId)).get();
```

The shape must match that repository exactly — annotating a predicate with a _different_
repository's shape is a compile error, not a silent mismatch.

## Collection-group queries

`repo.collectionGroup()` queries **every collection that shares this repository's collection id**,
at any depth in the database — the classic "all `posts`, across all users" query. The group id is
the last segment of the repository's path, and the returned handle inherits that repository's read
model, stored (query-path) model, read converter, and `allowLegacyDatastoreIds` policy.

```typescript
// A repository for one user's posts: 'users/u1/posts'
const userPosts = userRepo.subcollection('u1', 'posts', postSchema);

// …and the same shape, across every user.
const postGroup = userPosts.collectionGroup();

const published = await postGroup
  .query()
  .where('status', '==', 'published')
  .orderBy('createdAt', 'desc')
  .limit(20)
  .get();
```

If you have no concrete parent id handy, make a top-level handle — constructing a repository does no
I/O, so the collection it names does not have to exist:

```typescript
const postGroup = FirestoreRepository.withSchema(db, 'posts', postSchema).collectionGroup();
```

### Results carry full-path identity

Document ids are only unique **within one collection**, so `users/u1/posts/p1` and
`users/u2/posts/p1` are different documents that both report `id: 'p1'`. Group results are therefore
[`CollectionGroupDocument`](/firestore-orm/reference/types/)s: the read data plus `id`, the full
`path`, and the containing collection's `parentPath` — all plain strings, so a result stays
JSON-serializable.

```typescript
const rows = await postGroup.query().where('status', '==', 'draft').get();

rows[0].id; // 'p1'          ← ambiguous across the group
rows[0].path; // 'users/u2/posts/p1'  ← the identity that is actually unique
rows[0].parentPath; // 'users/u2/posts'
```

To act on a document, rebuild a reference from the path with the `Firestore` instance you already
own: `db.doc(row.path)`.

Identity is overlaid on top of the document data, exactly as `id` is on a normal read, so a stored
field named `path` or `parentPath` would be shadowed. `collectionGroup()` **throws** if a
schema-validated repository's read schema declares either at the top level.

### What the group id actually matches

A collection group is matched purely by collection id, which catches more than people expect:

- a same-named **root** collection (`posts/abc`) is a member;
- a same-named collection nested **under a group member** (`users/u1/posts/p1/posts/deep`) is a
  member;
- a collection with a _different_ id under the same parent is never a member.

### Document-name queries use the full path

Because ids are ambiguous, a group's document-name operations work on the full path.
`wherePath(...)` / `orderByPath(...)` replace `whereId(...)` / `orderById(...)`, which are not
available on a group builder:

```typescript
await postGroup.query().wherePath('==', 'users/u1/posts/p1').getOne();
await postGroup
  .query()
  .wherePath('in', [db.doc('users/u1/posts/p1')])
  .get();

// Stable pagination tiebreaker — ordering is lexicographic over the full path.
await postGroup.query().orderByPath().paginate(20);
```

Path operands are validated segment by segment against the same rules as any other id the ORM
accepts, so a bare id, a `..` segment, or a reserved `__…__` segment throws
[`InvalidDocumentIdError`](/firestore-orm/reference/errors/) before any I/O. A well-formed path that
simply isn't in the group matches nothing (Firestore reports no error for it).

Inside `whereFilter(...)`, the group factory exposes `f.wherePath(...)` for the same reason:

```typescript
await postGroup
  .query()
  .whereFilter(f => f.or(f.where('status', '==', 'published'), f.wherePath('==', pinnedPath)))
  .get();
```

### Read-only, and the rest of the surface

Everything else behaves exactly as it does on a single-collection query — `where`, `whereFilter`,
`orderBy`, `limit`, `select`, `get` / `getOne` / `exists`, `count`, `sum` / `average`,
`distinctValues`, `paginate` / `offsetPaginate` / `paginateWithCount`, `stream`, and `onSnapshot`.
`groupCount()` replaces `collectionCount()` as the unfiltered count.

A collection group has no `CollectionReference`, so there is **no write surface**: `update()` and
`delete()` do not exist on a group builder (a compile error, not a runtime throw). Their bulk hooks
carry `{ ids }` payloads, and ids are not unique across a group, so every registered hook would see
ambiguous identity. For a group-wide write, drop to the Admin SDK — see
[Scope & Capabilities](/firestore-orm/reference/scope-and-capabilities/#raw-sdk-escape-hatch).

### ⚠️ Collection-group queries need their own indexes

Firestore's automatic single-field indexes are **collection**-scoped. A collection-group query that
filters or orders on a field needs an explicitly created **collection-group-scoped** index in
production — even for a single `where(...)`. The emulator does not enforce this, so a group query
that passes locally can fail deployed with
[`FirestoreIndexError`](/firestore-orm/reference/errors/). See
[Troubleshooting](/firestore-orm/reference/troubleshooting/).

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
> [Lifecycle hooks](/firestore-orm/guides/concepts/lifecycle-hooks/).

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
