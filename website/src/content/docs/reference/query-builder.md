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
`FirestoreDocument<T>` and is narrowed to `FirestoreDocument<DeepPartial<T>>` by `select()`. Pass
`{ withMetadata: true }` on a terminal to receive `WithMetadata<R>` (or an array of pairs) instead —
`R` itself is unchanged. Chainable clause methods (`where`, `whereFilter`, `whereId`, `orderBy`,
`orderById`, `limit`) return `this`; `select()` returns a **new** builder (see below).

## Clauses

**`where(field: FieldPaths<OmitId<S>> | FieldPath, op: WhereFilterOp, value: unknown): this`**

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

**`whereFilter(build: (f: QueryFilterFactory<OmitId<S>>) => Filter): this`**

Add a **composite** filter — nested `AND` / `OR` expressions, which chained `where()` calls (an
implicit top-level AND) cannot express. The callback receives a schema-aware
[`QueryFilterFactory`](/firestore-orm/reference/types/):

- `f.where(field, op, value)` — same typing as `where(...)` above
  (`FieldPaths<OmitId<S>> | FieldPath`, `value: unknown`) at every nesting depth, so a typo
  inside a nested group is still a compile error.
- `f.whereId(op, value)` — same two overloads and the same `validateDocumentId()` boundary as
  `whereId(...)`, honoring the repository's `allowLegacyDatastoreIds` setting.
- `f.and(...filters)` / `f.or(...filters)` — nestable groups. **A zero-argument call throws.**
  Firestore silently _drops_ an empty composite filter, so `f.or()` would widen the query to every
  document in the collection rather than fail; the builder rejects it instead.

A `whereFilter(...)` is AND-ed with any chained `where(...)` clauses, and composes with `orderBy` /
`limit`, `select`, the aggregations, pagination, `stream()`, `onSnapshot()`, and the `update()` /
`delete()` terminals. Returning a prebuilt Admin SDK `Filter` (`f => myFilter`) is a supported
escape hatch — it is applied verbatim, without the factory's typed paths or id validation. Note the
zero-argument guard is an **arity** check on `f.and()` / `f.or()` and cannot see inside a prebuilt
`Filter`: an empty SDK group, returned whole or passed as a child of a factory group, is silently
dropped by Firestore and changes the query's meaning. Only a filter reducing to _no_ conditions at
all is rejected. A callback that returns something which is not a `Filter` throws an ORM error; this
cannot be caught at compile time because the SDK's `Filter` type is structurally empty. `Filter` and
`FieldPath` are imported from `firebase-admin/firestore`.

**Inequality caveat.** An inequality (`<`, `<=`, `>`, `>=`, `!=`) inside an `or()` branch excludes
documents that are missing that field — including documents matched by a _different_ branch, because
Firestore adds an implicit `orderBy` for every inequality field in the flattened filter tree. An OR
query can therefore return fewer rows than one of its own disjuncts, on reads, aggregations, and the
`update()` / `delete()` terminals alike. `f.whereId(...)` with a comparison operator is exempt. See
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
`direction` defaults to `'asc'`. **`'desc'` cannot be a query's only ordering:** Firestore rejects a
bare descending document-name scan with
`FAILED_PRECONDITION: Firestore does not support descending key scans`. Add any equality
`where(...)` clause or a preceding `orderBy(...)` and it works; ascending is unrestricted.

**`select(...fields: (FieldPaths<OmitId<S>> | FieldPath)[]): FirestoreQueryBuilder<T, W, S, FirestoreDocument<DeepPartial<T>>>`**

Project only the given fields. Accepts typed stored nested paths and `FieldPath`. Returns a **new**
builder (it does not mutate the original) whose terminal reads are typed
`FirestoreDocument<DeepPartial<T>>` — every data property, including nested map properties, is
optional, so a field you projected away (at any depth) is a compile error to access without a guard.
A `readConverter` written for full documents may throw on a projected result. `select()` cannot be
combined with `onSnapshot()` — Firestore does not allow a real-time listener on a field-masked
query, so the builder rejects it locally.

**`orderBy(field: FieldPaths<OmitId<S>> | FieldPath, direction?: 'asc' | 'desc'): this`**

Order results by a stored field (top-level or nested dot-notation path). `direction` defaults to
`'asc'`. To order by the document id, use `orderById(...)`.

**`limit(n: number): this`**

Limit the number of results. When chained after `limitToLast()`, this call **replaces**
`limitToLast` (Admin SDK last-wins).

**`limitToLast(n: number): this`**

Return the last `n` documents of the ordered result set (results still in `orderBy` order).
Requires at least one prior `orderBy()` / `orderById()` / `orderByPath()`. `n` must be a
non-negative integer (`0` yields an empty page). Cannot be combined with `stream()`, opaque
`paginate()`, or `offsetPaginate()` — call `get()` instead. Real-time `onSnapshot()` **is**
supported. `getOne()` / `exists()` also compose: they skip an internal `.limit(1)` narrowing that
would otherwise last-wins overwrite `limitToLast`.

**`startAt` / `startAfter` / `endAt` / `endBefore`**

Typed cursor bounds matching the Admin SDK overloads: pass a `DocumentSnapshot`, or field values in
`orderBy` order (`unknown`, stored-shape rule). `startAt` / `endAt` are **inclusive**;
`startAfter` / `endBefore` are **exclusive**. Prefer snapshots or scalar field values — a
`DocumentReference` as a field-value bound against a non–document-id `orderBy` can silently yield
an empty result. Bound methods may throw **raw SDK errors** synchronously (for example a
single-collection foreign snapshot), consistent with `where` / `orderBy`.

**`offset(n: number): this`**

Skip the first `n` matching documents. `n` must be a non-negative integer (`0` is allowed). Prefer
cursor bounds or `paginate()` for large offsets — Firestore still scans skipped documents. Opaque
`paginate()` / `offsetPaginate()` reject a prior `offset()` (the terminals own the offset/limit
slots).

For forward opaque paging, keep using `paginate(pageSize, cursor?)`. For reverse pages, use
`orderBy(...).endAt(cursor).limitToLast(pageSize).get()`.

## Terminal reads

**`get(): Promise<R[]>`** /
**`get(options: { withMetadata: true }): Promise<WithMetadata<R>[]>`**

Execute the query and return all matching documents. `R` is `FirestoreDocument<T>` by default, or
`FirestoreDocument<DeepPartial<T>>` after `select(...)`.

**`explain(options?: { analyze?: boolean }): Promise<QueryExplainResult<R>>`**

Plans this query and optionally executes it (Admin SDK Query Explain). Returns
`{ metrics, documents }` — SDK diagnostics plus ORM-mapped rows (not a raw `ExplainResults` /
`QuerySnapshot`).

- Omit `analyze` (or pass `false`) for plan-only: `documents` is **`null`**.
- Pass `{ analyze: true }` to execute: `documents` is `R[]` (possibly **`[]`** when nothing
  matched — never collapse empty ↔ null).
- Composes with `limitToLast` the same way `get()` does (no local reject).
- Requires `@google-cloud/firestore` >= 7.4. Collection-group builders inherit this method.

⚠️ The Firestore **emulator does not return explain metrics** today; the Admin SDK then throws
`Error: No explain results`. Real plan/execution stats require production Firestore.
`explainStream` is deferred ([#65](https://github.com/reggieofarrell/firestore-orm/issues/65)).

**`getOne(): Promise<R | null>`** /
**`getOne(options: { withMetadata: true }): Promise<WithMetadata<R> | null>`**

Return the first matching document, or `null`.

**`exists(): Promise<boolean>`**

Return `true` if any document matches the query.

**`count(): Promise<number>`**

Count matching documents via a Firestore aggregation query.

**`collectionCount(): Promise<number>`**

Count all documents in the base collection. Ignores any accumulated `where(...)` clauses on the
query builder instance (use `count()` for the query-aware count).

**`sum(field: NumericFieldPaths<OmitId<S>> | FieldPath): Promise<number>`**

Firestore-native sum aggregation over a numeric stored field path (top-level or nested/dotted
numeric fields only) or a `FieldPath`. Returns `0` when no documents match. Not combinable with a
prior `select()` (local guard).

**`average(field: NumericFieldPaths<OmitId<S>> | FieldPath): Promise<number | null>`**

Firestore-native average aggregation over a numeric stored field path (top-level or nested/dotted
numeric fields only) or a `FieldPath`. Returns **`null`** when there are no numeric values to
average — distinct from an average that genuinely computes to `0`. Not combinable with a prior
`select()` (local guard).

**`aggregate<Spec extends AggregationSpec<OmitId<S>>>(spec: Spec): Promise<AggregationResult<Spec>>`**

Run multiple aliased aggregations in **one** Firestore aggregate request. Spec keys are result
aliases; values are `{ kind: 'count' }` or `{ kind: 'sum' | 'average', field }` with the same
numeric-path typing as `sum` / `average`. Result aliases map to `number` for `count`/`sum` and
`number | null` for `average`. Backend max is **5** aggregations per request. Empty specs, the alias
`'__proto__'`, and unknown / missing `kind` values are rejected locally. `select()` + count-only is
allowed; `select()` + any `sum`/`average` throws locally. Prefer required schema fields — a
sparse-field `sum`/`average` can collapse the document set for the whole request (see the queries
guide). Also available on collection-group builders (inherited from the shared read base).

**`distinctValues<K extends Extract<KeysOf<OmitId<T>>, string>>(field: K): Promise<ValueAtKey<T, K>[]>`**

(`KeysOf` / `ValueAtKey` are internal; `OmitId` is exported — see
[Exported Types](/firestore-orm/reference/types/). The constraint widens to branch-specific keys on
union read models while preserving the element type — ADR-0028.)

Return the distinct values observed for a field. Drops `undefined`, but preserves a stored `null` as
a distinct value. Deduplication uses **Firestore-aware semantic equality** (maps and arrays compare
structurally and map key order is irrelevant; `Timestamp`, `GeoPoint`, `DocumentReference` by path,
`Bytes`, and `VectorValue` compare by value). Values a `readConverter` produced that are not
Firestore values — a `Map`, a `Set`, a custom class — fall back to per-instance identity and are
never merged. The terminal is still client-side: it downloads matching documents and dedupes in
process. Reads the document's own field directly rather than a materialized row, so on a collection
group `distinctValues('path')` returns the values of a _stored_ field named `path`, not the document
paths `get()` reports as `row.path`. That is intentional — it is the only surface that can read a
field the identity overlay shadows.

**`paginate(pageSize: number, cursor?: string | null): Promise<{ items: R[]; nextCursor: string | null; hasMore: boolean }>`** /
**`paginate(pageSize, cursor, options: { withMetadata: true }): Promise<{ items: WithMetadata<R>[]; nextCursor: string | null; hasMore: boolean }>`**

Cursor-based pagination (recommended for large datasets). Requires at least one prior `orderBy(...)`
call and throws unless `pageSize` is a positive integer.

**`offsetPaginate(page: number, pageSize: number): Promise<{ items: R[]; page: number; pageSize: number; total: number; totalPages: number }>`** /
**`offsetPaginate(page, pageSize, options: { withMetadata: true }): Promise<{ items: WithMetadata<R>[]; page: number; pageSize: number; total: number; totalPages: number }>`**

Offset-based pagination. `page` and `pageSize` must be positive integers.

**`paginateWithCount(pageSize: number, cursor?: string | null): Promise<{ items: R[]; nextCursor: string | null; hasMore: boolean; total: number }>`** /
**`paginateWithCount(pageSize, cursor, options: { withMetadata: true }): Promise<{ items: WithMetadata<R>[]; nextCursor: string | null; hasMore: boolean; total: number }>`**

Cursor pagination combined with a total count.

**`stream(): AsyncGenerator<R>`** /
**`stream(options: { withMetadata: true }): AsyncGenerator<WithMetadata<R>>`**

Stream matching documents as an async generator (for large datasets), backed by the SDK's native
`Query.stream()`.

**`onSnapshot(callback: (items: R[]) => void, onError?: (error: Error) => void): Promise<() => void>`**

Subscribe to real-time updates for the query. Resolves to an unsubscribe function. Throws if the
query has a `select(...)` field mask (Firestore forbids listeners on projected queries).

**`onSnapshotDetailed(callback: (snapshot: DetailedQuerySnapshot<R>) => void, onError?: (error: Error) => void): Promise<() => void>`**

Subscribe with the full mapped result set **plus** `docChanges()` semantics. The callback receives
`DetailedQuerySnapshot<R>`: `docs`, `changes` (each entry is `DetailedDocumentChange<R>` with
`type`, `doc`, `metadata`, `oldIndex`, `newIndex`), `size`, `empty`, and `readTime`. The first
emission reports every match as `type: 'added'` with `oldIndex: -1`. For a `removed` change, `doc`
and `metadata` describe the document **as it last was** — branch on `type`, not on `exists` on the
change doc. Same `select()` rejection as `onSnapshot`. See
[Real-time & Listeners](/firestore-orm/guides/advanced/real-time/).

## Query-level writes

**`update(data: UpdateInput<W>): Promise<number>`**

Update all matching documents; returns the number of documents written. Supports dot notation. Runs
the bulk hooks `beforeBulkUpdate` (may mutate the payload) and `afterBulkUpdate` (`{ ids }`). An
empty patch is rejected with a `ValidationError`.

**`delete(): Promise<number>`**

Delete all matching documents; returns the matched (deleted) count. Runs the bulk hooks
`beforeBulkDelete` and `afterBulkDelete` (`{ ids, documents }`).

## Collection-group query builder

`class FirestoreCollectionGroupQueryBuilder<T, S = T, R = CollectionGroupDocument<T>>` — obtained
from `repo.collectionGroup().query()`. It queries every collection sharing the repository's
collection id, at any depth. Both builders extend the same internal read base, so **everything in
[Clauses](#clauses) and [Terminal reads](#terminal-reads) above behaves identically** except for the
differences below — including every `{ withMetadata: true }` terminal overload and
`onSnapshotDetailed()`. On collection-group rows, `metadata.path` equals the row's own `path` (not a
separate spelling). For the narrative walkthrough see
[collection-group queries](/firestore-orm/guides/working-with-data/queries/#collection-group-queries).

| Single collection                 | Collection group             | Why                                                 |
| --------------------------------- | ---------------------------- | --------------------------------------------------- |
| result `FirestoreDocument<T>`     | `CollectionGroupDocument<T>` | ids are not unique across a group                   |
| `whereId(op, id)`                 | `wherePath(op, path)`        | `documentId()` matches the **full path** in a group |
| `orderById(direction?)`           | `orderByPath(direction?)`    | ordering is lexicographic over the full path        |
| `collectionCount()`               | `groupCount()`               | the unfiltered count spans the whole group          |
| `update(data)` / `delete()`       | _(absent)_                   | bulk hooks are `id`-keyed; ids are ambiguous here   |
| `f.whereId(...)` in `whereFilter` | `f.wherePath(...)`           | same reason as `wherePath`                          |

**`wherePath(op: '<' | '<=' | '==' | '!=' | '>=' | '>', value: string | DocumentReference): this`**
**`wherePath(op: 'in' | 'not-in', value: readonly (string | DocumentReference)[]): this`**

Filter by the document name, which in a collection-group query is the document's **full path**.
Accepts a path string (`'users/u1/posts/p1'`) or a `DocumentReference`. String operands are
validated per segment — a bare id, an odd segment count, a leading/trailing `/`, a `..` segment, or
a reserved `__…__` segment throws `InvalidDocumentIdError` before any I/O, honoring the repository's
`allowLegacyDatastoreIds` setting on the document segments. Validation is applied **per operand**,
so one valid element in an `in` array does not waive the rest. A well-formed path outside the group
matches nothing rather than erroring.

**`orderByPath(direction?: 'asc' | 'desc'): this`**

Order by the full document path. `direction` defaults to `'asc'`, and the same descending-key-scan
restriction as `orderById` applies.

**`groupCount(): Promise<number>`**

Count every document in the group, ignoring the builder's `where` clauses. Use `count()` for the
query-aware count.

**`whereFilter(build: (f: CollectionGroupFilterFactory<OmitId<S>>) => Filter): this`**

Identical to the collection form, except the factory exposes `f.wherePath(...)` instead of
`f.whereId(...)`. All the composite-filter caveats above — the inequality-in-`or()` exclusion, the
empty-group rejection, and the server-side limits — apply unchanged.

**`select(...)`** returns a **new** collection-group builder typed
`CollectionGroupDocument<DeepPartial<T>>`. Path identity survives a projection: it comes from the
snapshot reference, not from the field mask.

**Indexes.** Firestore's automatic single-field indexes are _collection_-scoped, so a
collection-group query that filters or orders on a field needs an explicitly created
**collection-group-scoped** index in production — even for a single `where(...)`. The emulator does
not enforce this. See [Troubleshooting](/firestore-orm/reference/troubleshooting/).
