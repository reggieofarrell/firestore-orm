---
title: 'FirestoreQueryBuilder'
description:
  'Full type signatures for the FirestoreQueryBuilder — filtering, ordering, projection,
  aggregation, pagination, streaming, and real-time listeners.'
---

Full type signatures for `FirestoreQueryBuilder`, obtained from `repo.query()`. The generics `T`
(read data), `W` (write input), and `S` (stored data) are the repository's — see
[FirestoreRepository](/firestore-orm/reference/repository/#the-four-generics). For the narrative
walkthrough of these methods, see [Queries](/firestore-orm/guides/working-with-data/queries/).

`class FirestoreQueryBuilder<T, W, S = T, R = FirestoreDocument<T>>` — obtained from `repo.query()`.
`R` is the result shape of terminal reads (`get`, `getOne`, `stream`, `paginate`, …); it defaults to
`FirestoreDocument<T>` and is narrowed to `FirestoreDocument<DeepPartial<T>>` by `select()`.
Chainable clause methods (`where`, `whereFilter`, `whereId`, `orderBy`, `orderById`, `limit`) return
`this`; `select()` returns a **new** builder (see below).

## Clauses

**`where(field: FieldPaths<Omit<S, 'id'>> | FieldPath, op: WhereFilterOp, value: unknown): this`**

Add a where clause. `field` is a typed stored field path — a top-level key or a nested dot-notation
path (`'address.city'`) derived from `S` — or a `FieldPath` for dynamic names. Operators: `==`,
`!=`, `>`, `>=`, `<`, `<=`, `in`, `not-in`, `array-contains`, `array-contains-any`. `where('id', …)`
does **not** compile — the synthetic `id` is not a stored field path; query the document name with
`whereId(...)`. Chained `where()` clauses are AND-only; for a disjunction use `whereFilter(...)`.

**`whereId(op: '<' | '<=' | '==' | '!=' | '>=' | '>', value: string): this`**
**`whereId(op: 'in' | 'not-in', value: readonly string[]): this`**

Filter by the document id (a native document-name query via `FieldPath.documentId()`). Scalar
operators take a `string`; `in` / `not-in` take a `readonly string[]`. This is the correct way to
query by id.

**`whereFilter(build: (f: QueryFilterFactory<Omit<S, 'id'>>) => Filter): this`**

Add a **composite** filter — nested `AND` / `OR` expressions, which chained `where()` calls (an
implicit top-level AND) cannot express. The callback receives a schema-aware
[`QueryFilterFactory`](/firestore-orm/reference/types/):

- `f.where(field, op, value)` — same typing as `where(...)` above
  (`FieldPaths<Omit<S, 'id'>> | FieldPath`, `value: unknown`) at every nesting depth, so a typo
  inside a nested group is still a compile error.
- `f.whereId(op, value)` — same two overloads and the same `validateDocumentId()` boundary as
  `whereId(...)`, honoring the repository's `allowLegacyDatastoreIds` setting.
- `f.and(...filters)` / `f.or(...filters)` — nestable groups. **A zero-argument call throws.**
  Firestore silently _drops_ an empty composite filter, so `f.or()` would widen the query to every
  document in the collection rather than fail; the builder rejects it instead.

A `whereFilter(...)` is AND-ed with any chained `where(...)` clauses, and composes with `orderBy` /
`limit`, `select`, the aggregations, pagination, `stream()`, `onSnapshot()`, and the `update()` /
`delete()` terminals. Returning a prebuilt Admin SDK `Filter` (`f => myFilter`) is a supported
escape hatch — it is applied verbatim, without the factory's typed paths or id validation. A
callback that returns something which is not a `Filter` throws an ORM error; this cannot be caught
at compile time because the SDK's `Filter` type is structurally empty. `Filter` and `FieldPath` are
imported from `firebase-admin/firestore`.

**Inequality caveat.** An inequality (`<`, `<=`, `>`, `>=`, `!=`, `not-in`) inside an `or()` branch
excludes documents that are missing that field — including documents matched by a _different_
branch, because Firestore adds an implicit `orderBy` for every inequality field in the flattened
filter tree. An OR query can therefore return fewer rows than one of its own disjuncts, on reads,
aggregations, and the `update()` / `delete()` terminals alike. `f.whereId(...)` with a comparison
operator is exempt. See
[Queries](/firestore-orm/guides/working-with-data/queries/#composite-andor-filters).

Firestore enforces its own limits on the **server** and the ORM does not duplicate them (a local
copy would risk rejecting a query the backend accepts, and the counts multiply across clauses the
callback cannot see). Non-exhaustively: at most 30 disjunctions after normalization, `in` accepts at
most 30 values, at most one `array-contains` **per disjunction**, and one `!=` / `not-in` **per
query** — which also counts `!= null` / `!= NaN`. A `not-in` anywhere in the query is incompatible
with any `OR`, including one from a chained `where()` outside the callback. All arrive as
`INVALID_ARGUMENT`. A composite query can also require composite index coverage for more than one
disjunct branch — see [Troubleshooting](/firestore-orm/reference/troubleshooting/).

**`orderById(direction?: 'asc' | 'desc'): this`**

Order by the document id — the id-aware `orderBy`, useful as a stable pagination tiebreaker.
`direction` defaults to `'asc'`.

**`select(...fields: (FieldPaths<Omit<S, 'id'>> | FieldPath)[]): FirestoreQueryBuilder<T, W, S, FirestoreDocument<DeepPartial<T>>>`**

Project only the given fields. Accepts typed stored nested paths and `FieldPath`. Returns a **new**
builder (it does not mutate the original) whose terminal reads are typed
`FirestoreDocument<DeepPartial<T>>` — every data property, including nested map properties, is
optional, so a field you projected away (at any depth) is a compile error to access without a guard.
A `readConverter` written for full documents may throw on a projected result. `select()` cannot be
combined with `onSnapshot()` — Firestore does not allow a real-time listener on a field-masked
query, so the builder rejects it locally.

**`orderBy(field: FieldPaths<Omit<S, 'id'>> | FieldPath, direction?: 'asc' | 'desc'): this`**

Order results by a stored field (top-level or nested dot-notation path). `direction` defaults to
`'asc'`. To order by the document id, use `orderById(...)`.

**`limit(n: number): this`**

Limit the number of results.

> There is no public `startAt` / `startAfter` / `endBefore` / `endAt` cursor-chaining method. Use
> `paginate(pageSize, cursor?)` for cursor-based paging.

## Terminal reads

**`get(): Promise<R[]>`**

Execute the query and return all matching documents. `R` is `FirestoreDocument<T>` by default, or
`FirestoreDocument<DeepPartial<T>>` after `select(...)`.

**`getOne(): Promise<R | null>`**

Return the first matching document, or `null`.

**`exists(): Promise<boolean>`**

Return `true` if any document matches the query.

**`count(): Promise<number>`**

Count matching documents via a Firestore aggregation query.

**`collectionCount(): Promise<number>`**

Count all documents in the base collection. Ignores any accumulated `where(...)` clauses on the
query builder instance (use `count()` for the query-aware count).

**`sum(field: NumericFieldPaths<Omit<S, 'id'>> | FieldPath): Promise<number>`**

Firestore-native sum aggregation over a numeric stored field path (top-level or nested/dotted
numeric fields only) or a `FieldPath`. Returns `0` when no documents match.

**`average(field: NumericFieldPaths<Omit<S, 'id'>> | FieldPath): Promise<number | null>`**

Firestore-native average aggregation over a numeric stored field path (top-level or nested/dotted
numeric fields only) or a `FieldPath`. Returns **`null`** when there are no numeric values to
average — distinct from an average that genuinely computes to `0`.

**`distinctValues<K extends keyof Omit<T, 'id'>>(field: K): Promise<T[K][]>`**

Return the distinct values observed for a field. Drops `undefined`, but preserves a stored `null` as
a distinct value.

**`paginate(pageSize: number, cursor?: string | null): Promise<{ items: R[]; nextCursor: string | null; hasMore: boolean }>`**

Cursor-based pagination (recommended for large datasets). Requires at least one prior `orderBy(...)`
call and throws unless `pageSize` is a positive integer.

**`offsetPaginate(page: number, pageSize: number): Promise<{ items: R[]; page: number; pageSize: number; total: number; totalPages: number }>`**

Offset-based pagination. `page` and `pageSize` must be positive integers.

**`paginateWithCount(pageSize: number, cursor?: string | null): Promise<{ items: R[]; nextCursor: string | null; hasMore: boolean; total: number }>`**

Cursor pagination combined with a total count.

**`stream(): AsyncGenerator<R>`**

Stream matching documents as an async generator (for large datasets), backed by the SDK's native
`Query.stream()`.

**`onSnapshot(callback: (items: R[]) => void, onError?: (error: Error) => void): Promise<() => void>`**

Subscribe to real-time updates for the query. Resolves to an unsubscribe function. Throws if the
query has a `select(...)` field mask (Firestore forbids listeners on projected queries).

## Query-level writes

**`update(data: UpdateInput<W>): Promise<number>`**

Update all matching documents; returns the number of documents written. Supports dot notation. Runs
the bulk hooks `beforeBulkUpdate` (may mutate the payload) and `afterBulkUpdate` (`{ ids }`). An
empty patch is rejected with a `ValidationError`.

**`delete(): Promise<number>`**

Delete all matching documents; returns the matched (deleted) count. Runs the bulk hooks
`beforeBulkDelete` and `afterBulkDelete` (`{ ids, documents }`).
