---
title: 'API Reference'
description:
  'Full type signatures for FirestoreRepository, FirestoreQueryBuilder, and exported types.'
---

Full type signatures for `FirestoreRepository`, `FirestoreQueryBuilder`, and the package's exported
types.

> **Errors:** the error classes (`NotFoundError`, `ValidationError`, `ConflictError`,
> `FirestoreIndexError`, `InvalidDocumentIdError`), the `parseFirestoreError` mapper, and the
> Express `errorHandler` middleware are documented in [Error handling](./error-handling/).

The repository is generic over **four** types, inferred by `withSchema` / `subcollection` from
schema values:

- **`T`** — the read-data type, `z.output<readSchema>`. It carries **no** `id`; reads resolve to
  `FirestoreDocument<T>` (= `Omit<T, 'id'> & { readonly id: ID }`), with the id overlaid from the
  document name.
- **`W`** — the write-input type, `z.input<writeSchema>` (defaults to `T`) — the caller's pre-parse
  input to `create` / `update`. A `writeSchema` built from the write combinators lets those fields
  accept their native values and sentinels on writes with no cast — see
  [Per-Field Sentinel Approval](./field-value-sentinels/#per-field-sentinel-approval).
- **`S`** — the stored-data type, `z.output<storedSchema>` (defaults to `T`) — the at-rest shape
  that query field paths derive from.
- **`WO`** — the parsed-write type, `z.output<writeSchema>` (defaults to `W`) — what the SDK
  persists and after-create hooks observe.

The Firestore document name is the **sole authority** for `id`. Schemas describe the document's own
data and **must not** declare a top-level `id` (construction throws if they do). The id is generated
on `create` / `bulkCreate` / `createInTransaction`, or taken from the `id` argument on `update` /
`patch` / `upsert` / `delete`, and is never part of a write payload.

`UpdateInput<W>` reuses the Firestore Admin SDK's `UpdateData<Omit<W, 'id'>>`, so update-family
methods accept **typed dot-notation field paths** (`'address.city'`) — no `as any` — while `create`
/ `upsert` (`CreateInput<W>` = `WithFieldValue<Omit<W, 'id'>>`) reject dotted keys. Query field
paths are derived from the stored shape `S` (excluding the synthetic `id`) via the exported
`FieldPaths` helper (with `PathValue` for resolving a path's value type). See the
[Dot Notation guide](./dot-notation/).

## FirestoreRepository

`class FirestoreRepository<T extends object, W extends object = T, S extends object = T, WO extends object = W>`

### Static Methods

**`withSchema<RS extends ZodObject, WS extends ZodObject = RS, SS extends ZodObject = RS>(db: Firestore, collection: string, readSchema: RS, options?: { writeSchema?: WS; storedSchema?: SS; readConverter?: ReadConverter<z.output<RS>>; sentinelPolicy?: SentinelPolicy; allowLegacyDatastoreIds?: boolean }): FirestoreRepository<z.output<RS>, z.input<WS>, z.output<SS>, z.output<WS>>`**

Create a schema-validated repository. The **read type** is `z.output<readSchema>`, the **write-input
type** is `z.input<writeSchema>` (defaults to the read type), and the **stored type** is
`z.output<storedSchema>` (defaults to the read type). Build the overlay from the write combinators
so those fields accept their native values / sentinels on `create` / `update` with no cast — see
[Per-Field Sentinel Approval](./field-value-sentinels/#per-field-sentinel-approval) for the exact
guarantees.

Types are inferred from schema **values** — do not pass an explicit generic. The read / write /
stored schemas describe the document's own data and **must not** declare a top-level `id`, or
construction throws with a remedial error — the document name is the sole `id` authority.
`options.sentinelPolicy` is `'strict'` (default) or `'permissive'`; strict mode enforces which
sentinel kind each field accepts. When a `readConverter` is supplied, `storedSchema` is **required**
(the converter changes the read shape, so query paths need an explicit at-rest schema).
`allowLegacyDatastoreIds` opts into accepting legacy Datastore-mode numeric ids.

**`raw<T extends object, W extends object = T, S extends object = T>(db: Firestore, collection: string, options?: { readConverter?: ReadConverter<T>; allowLegacyDatastoreIds?: boolean }): FirestoreRepository<T, W, S, W>`**

Named entry point for an **unvalidated** (schema-less) repository. Types come from the explicit
generic `T`; no Zod validation runs. Prefer this over the positional constructor when you need a raw
repository with options — it keeps a security-relevant flag like `allowLegacyDatastoreIds`
discoverable instead of a trailing positional boolean.

**`new FirestoreRepository<T extends object, W extends object = T, S extends object = T, WO extends object = W>(db: Firestore, collectionPath: string, validator?: Validator<W, WO>, parentPath?: string, readConverter?: ReadConverter<T>, schemas?: RepositorySchemaSet, allowLegacyDatastoreIds?: boolean)`**

Low-level constructor with optional validation and an optional read-only converter. A
`ReadConverter<T>` is the `fromFirestore(snapshot) => T` mapper only; the repository builds the full
`FirestoreDataConverter` internally and applies it to reads, so `toFirestore` is never invoked.
There is no options / config / debug / logger bag anywhere in the constructor — prefer
`withSchema(...)` (or `raw(...)` for an unvalidated repository) for typical use.

### Instance Methods

#### Reads

**`getById(id: ID): Promise<FirestoreDocument<T> | null>`**

Get document by ID. Resolves to `null` when the document does not exist.

**`getByIdOrThrow(id: ID): Promise<FirestoreDocument<T>>`**

Get document by ID; throws `NotFoundError` when missing.

**`fromSnapshot(snapshot: DocumentSnapshot): FirestoreDocument<T> | null`**

Map a raw Firestore snapshot — e.g. the one delivered to a trigger cloud function — to
`FirestoreDocument<T>`, applying the repository's `readConverter` `fromFirestore` when configured
and overlaying the document `id`. Does no Firestore I/O; returns the read model `T` (not `W`), and
`null` for a non-existent snapshot. Not validated (like other reads); compose `validate` after a
null guard — see [Using with Firestore triggers](./triggers/).

**`validate(data: FirestoreDocument<T>): FirestoreDocument<T>`**
**`validate(data: FirestoreDocument<T>[]): FirestoreDocument<T>[]`**

Parse an already-read value through `schemas.read` and return the parsed output. Throws
`ValidationError` on mismatch (array form is all-or-nothing). Throws a plain `Error` if the
repository has no schema. See [Schema Validation](./schema-validation/#validating-reads-opt-in).

**`safeValidate(data: FirestoreDocument<T>): SafeResult<T>`**
**`safeValidate(data: FirestoreDocument<T>[]): SafeResult<T>[]`**

Non-throwing variant of `validate`. Returns `{ success: true, data }` or
`{ success: false, error: ValidationError }` (array form: one result per element). Still throws a
plain `Error` when no schema is configured.

**`getAll(): Promise<FirestoreDocument<T>[]>`**

Get all documents in the collection.

**`findByField(field: FieldPaths<Omit<S, 'id'>> | FieldPath, value: unknown): Promise<FirestoreDocument<T>[]>`**

Find all documents whose `field` (a stored field path) equals `value`.

**`getOneByField(field: FieldPaths<Omit<S, 'id'>> | FieldPath, value: unknown): Promise<FirestoreDocument<T> | null>`**

Find the first document by field value. Returns `null` when no document matches.

**`getOneByFieldOrThrow(field: FieldPaths<Omit<S, 'id'>> | FieldPath, value: unknown): Promise<FirestoreDocument<T>>`**

Find exactly one document by field value. Throws `NotFoundError` when none match and `ConflictError`
when multiple documents match.

**`listenOne(id: ID, callback: (item: FirestoreDocument<T>) => void, onError?: (error: Error) => void): () => void`**

Subscribe to real-time updates for a single document by ID. Returns an unsubscribe function.

#### Writes

**`create(data: CreateInput<W>, options: { returnDoc: true }): Promise<FirestoreDocument<T>>`**
**`create(data: CreateInput<W>, options?: { returnDoc?: false }): Promise<{ id: ID }>`**

Create a new document with an auto-generated Firestore ID. Returns `{ id }` by default; pass
`{ returnDoc: true }` to resolve to the created `FirestoreDocument<T>`.

**`bulkCreate(data: CreateInput<W>[], options: { returnDoc: true }): Promise<FirestoreDocument<T>[]>`**
**`bulkCreate(data: CreateInput<W>[], options?: { returnDoc?: false }): Promise<{ id: ID }[]>`**

Create multiple documents, committed in batches of 500. Returns `{ id }[]` by default; pass
`{ returnDoc: true }` for the created documents.

**`update(id: ID, data: UpdateInput<W>, options: UpdateOptions & { returnDoc: true }): Promise<FirestoreDocument<T>>`**
**`update(id: ID, data: UpdateInput<W>, options?: UpdateOptions & { returnDoc?: false }): Promise<{ id: ID }>`**

Update a document with partial data. Supports dot notation for nested updates. Pass
`{ merge: true }` to normalize nested objects to dot paths before writing. Returns `{ id }` by
default; pass `{ returnDoc: true }` to resolve to the updated `FirestoreDocument<T>`.

**`patch(id: ID, data: UpdateInput<W>, options: { returnDoc: true }): Promise<FirestoreDocument<T>>`**
**`patch(id: ID, data: UpdateInput<W>, options?: { returnDoc?: false }): Promise<{ id: ID }>`**

Merge-style update — equivalent to `update(id, data, { merge: true })`. `patch` **always** merges,
so there is no `merge` option; `{ returnDoc: true }` resolves to the updated `FirestoreDocument<T>`.

**`bulkUpdate(updates: { id: ID; data: UpdateInput<W> }[]): Promise<{ id: ID }[]>`**

Update multiple documents in a batch. Supports dot notation.

**`bulkPatch(updates: { id: ID; data: UpdateInput<W> }[]): Promise<{ id: ID }[]>`**

Merge-style batch update. Each payload is normalized like `patch(...)` before the batched writes.

**`upsert(id: ID, data: CreateInput<W>, options: { returnDoc: true }): Promise<FirestoreDocument<T>>`**
**`upsert(id: ID, data: CreateInput<W>, options?: { returnDoc?: false }): Promise<{ id: ID }>`**

Create or overwrite the document with the given ID. Returns `{ id }` by default; pass
`{ returnDoc: true }` to resolve to the final persisted `FirestoreDocument<T>`.

**`delete(id: ID): Promise<void>`**

Permanently delete a document. Throws `NotFoundError` when the document does not exist.

**`bulkDelete(ids: ID[]): Promise<number>`**

Permanently delete multiple documents. Resolves to the count of documents that **actually existed**
(not the length of the input array).

#### Identity

**`id(raw: string): ID`**

Validate an untrusted document id at the boundary and return it as an `ID`. Throws
`InvalidDocumentIdError` when `raw` is malformed (empty, contains `/`, `.`, `..`, a `__…__` reserved
pattern, or exceeds 1500 bytes). Use it before passing a request-supplied id to `getById`, `update`,
etc.

**`newId(): ID`**

Generate a new, validated auto-id **without** writing a document. Persist under it explicitly with
`upsert(id, …)` or a transaction `set` — `create()` and `createInTransaction()` each generate their
own fresh id.

#### Query, hooks, and helpers

**`query(): FirestoreQueryBuilder<T, W, S>`**

Create a query builder for complex queries, aggregations, streaming, and real-time listeners.

**`on(event: HookEvent, fn: HookFn): void`**

Register a lifecycle hook. Supported events:

- `beforeCreate`, `afterCreate`
- `beforeUpdate`, `afterUpdate`
- `beforeDelete`, `afterDelete`
- `beforeBulkCreate`, `afterBulkCreate`
- `beforeBulkUpdate`, `afterBulkUpdate`
- `beforeBulkDelete`, `afterBulkDelete`

Payload notes: `beforeCreate` / `beforeUpdate` receive the mutable write payload (`WriteInput`);
`afterCreate` receives the parsed write output (`z.output<writeSchema>`) plus the generated `id`;
`afterUpdate` receives `{ id }`; `afterBulkUpdate` receives `{ ids }`; `beforeBulkDelete` /
`afterBulkDelete` receive `{ ids: ID[]; documents: FirestoreDocument<T>[] }`; single-delete hooks
receive the full persisted document as a `FirestoreDocument<T>` at runtime. `query().update()` /
`query().delete()` run the **bulk** hooks (`beforeBulkUpdate`/`afterBulkUpdate`,
`beforeBulkDelete`/`afterBulkDelete`), not the per-document hooks; inside transactions only
`before*` hooks run, via the transaction-scoped repo passed to `runInTransaction`. See
[Lifecycle hooks](./lifecycle-hooks/#lifecycle-hooks) for full detail.

**`subcollection<RS extends ZodObject, WS extends ZodObject = RS, SS extends ZodObject = RS>(parentId: ID, subcollectionName: string, readSchema: RS, options?: { writeSchema?: WS; storedSchema?: SS; readConverter?: ReadConverter<z.output<RS>>; sentinelPolicy?: SentinelPolicy; allowLegacyDatastoreIds?: boolean }): FirestoreRepository<z.output<RS>, z.input<WS>, z.output<SS>, z.output<WS>>`**

Access a subcollection under a specific parent document. Mirrors `withSchema`: read/write/stored
types are inferred from schema values, and a `writeSchema` overlay enables cast-free combinator
writes. Converters are explicit per repository instance and are **not** inherited from the parent
repository. The read / write / stored schemas **must not** declare a top-level `id` (construction
throws otherwise); when a `readConverter` is supplied, `storedSchema` is required. For an
unvalidated subcollection, construct a repository directly against the full path with
`new FirestoreRepository<Order>(db, `${parentPath}/${parentId}/orders`)`. See
[Subcollections](./subcollections/).

**`getParentId(): ID | null`**

Get the parent document ID (for subcollections); `null` for a top-level repository.

**`getCollectionPath(): string`**

Get the full collection path.

#### Transactions

**`runInTransaction<R>(fn: (tx: Transaction, repo: FirestoreRepository<T, W, S, WO>) => Promise<R>): Promise<R>`**

Execute a function within a Firestore transaction. The callback receives a transaction-scoped
`repo`; use its `*InTransaction` methods so that hooks fire correctly. See
[Transactions](./transactions/).

**`getForUpdateInTransaction(tx: Transaction, id: ID): Promise<FirestoreDocument<T> | null>`**

Read a document for update within a transaction.

**`updateInTransaction(tx: Transaction, id: ID, data: UpdateInput<W>, options?: { merge?: boolean }): Promise<void>`**

Update a document within a transaction. Pass `{ merge: true }` to normalize nested objects to dot
paths before writing.

**`patchInTransaction(tx: Transaction, id: ID, data: UpdateInput<W>): Promise<void>`**

Merge-style update within a transaction — equivalent to
`updateInTransaction(tx, id, data, { merge: true })`. Takes no options.

**`createInTransaction(tx: Transaction, data: CreateInput<W>): Promise<{ id: ID }>`**

Create a document within a transaction (auto-generated ID). Returns `{ id }` — a transaction cannot
read a document back after writing it, so there is no `returnDoc` option.

**`deleteInTransaction(tx: Transaction, id: ID): Promise<void>`**

Delete a document within a transaction.

## FirestoreQueryBuilder

`class FirestoreQueryBuilder<T, W, S = T, R = FirestoreDocument<T>>` — obtained from `repo.query()`.
`R` is the result shape of terminal reads (`get`, `getOne`, `stream`, `paginate`, …); it defaults to
`FirestoreDocument<T>` and is narrowed to `FirestoreDocument<DeepPartial<T>>` by `select()`.
Chainable clause methods (`where`, `whereId`, `orderBy`, `orderById`, `limit`) return `this`;
`select()` returns a **new** builder (see below).

**`where(field: FieldPaths<Omit<S, 'id'>> | FieldPath, op: WhereFilterOp, value: unknown): this`**

Add a where clause. `field` is a typed stored field path — a top-level key or a nested dot-notation
path (`'address.city'`) derived from `S` — or a `FieldPath` for dynamic names. Operators: `==`,
`!=`, `>`, `>=`, `<`, `<=`, `in`, `not-in`, `array-contains`, `array-contains-any`. `where('id', …)`
does **not** compile — the synthetic `id` is not a stored field path; query the document name with
`whereId(...)`.

**`whereId(op: '<' | '<=' | '==' | '!=' | '>=' | '>', value: string): this`**
**`whereId(op: 'in' | 'not-in', value: readonly string[]): this`**

Filter by the document id (a native document-name query via `FieldPath.documentId()`). Scalar
operators take a `string`; `in` / `not-in` take a `readonly string[]`. This is the correct way to
query by id.

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

**`update(data: UpdateInput<W>): Promise<number>`**

Update all matching documents; returns the number of documents written. Supports dot notation. Runs
the bulk hooks `beforeBulkUpdate` (may mutate the payload) and `afterBulkUpdate` (`{ ids }`). An
empty patch is rejected with a `ValidationError`.

**`delete(): Promise<number>`**

Delete all matching documents; returns the matched (deleted) count. Runs the bulk hooks
`beforeBulkDelete` and `afterBulkDelete` (`{ ids, documents }`).

## Exported Types

Types re-exported from the package entry point (`@reggieofarrell/firestore-orm`):

- **`ID`** — `string` document-identifier alias.
- **`FirestoreDocument<T>`** — the flat read-result shape: `Omit<T, 'id'> & { readonly id: ID }`.
  Returned by every read (`getById`, `getAll`, query terminals, hook payloads, …).
- **`DataOf<R>`** — extracts a repository's read-data type (`Omit<T, 'id'>`) without spelling the
  generics.
- **`StoredDataOf<R>`** — extracts a repository's stored-data type (`Omit<S, 'id'>`).
- **`DocumentOf<R>`** — extracts a repository's document result type
  (`FirestoreDocument<DataOf<R>>`); name a returned document type without spelling the generics.
- **`InvalidDocumentIdReason`** — machine-readable cause carried by `InvalidDocumentIdError` (the
  error class is documented in [Error handling](./error-handling/)).
- **`HookEvent`** — union of supported lifecycle hook names.
- **`UpdateOptions`** — `{ merge?: boolean; returnDoc?: boolean }`.
- **`ReadConverter<T>`** — read-only converter: the `fromFirestore(snapshot) => T` mapper passed as
  `readConverter` (the repository builds the full `FirestoreDataConverter` internally).
- **`SafeResult<T>`** — `{ success: true; data } | { success: false; error: ValidationError }`
  returned by `safeValidate`.
- **`PaginatedResult<T>`** — `{ items; nextCursor; hasMore }` from cursor pagination.
- **`DeepPartial<T>`** — recursively-optional `T` (nested map properties optional too); the terminal
  result shape after `select(...)`. It recurses into **every object not assignable to the leaf set**
  (there is no plain-map predicate); leaf values are preserved whole — scalars, `Date`, Firestore
  value classes (`Timestamp`, `GeoPoint`, `DocumentReference`, `FieldValue`, vector values), byte
  values (`Uint8Array`/`Buffer`), functions, and arrays. The leaf test is distributive over unions.
  A custom class instance produced by a `readConverter` as a field value is not a known leaf, so it
  recurses and its methods type as optional after a projection. Guarding only the field does not
  make such a method callable (`row.value?.method()` still errors — `method` is now optional too);
  guard the method as well (`row.value?.method?.()`) or assert the field back to its class type
  after a null check (`(row.value as ClassType).method()`).
- **`FieldPaths<T>` / `PathValue<T, P>`** — typed field-path union and the value type at a path.
- **`UpdateInput<T>`** — update payload type, `UpdateData<Omit<T, 'id'>>` (typed dot-notation
  paths).
- **`CreateInput<T>`** — create payload type, `WithFieldValue<Omit<T, 'id'>>`; `id` is not a member.
- **`CreateOutput<T>`** — parsed create output (`Omit<T, 'id'>`) that after-create hooks observe.
- **`Validator<Input, Output = Input>`** — validation contract produced by `makeValidator(...)`.
- **`RepositorySchemaSet`** — bundle of read / create / update schemas attached to a repository.
- **`SentinelPolicy`** — `'permissive' | 'strict'` (the v3 default is `'strict'`).
- **`FieldValueKind`** — union of recognized Firestore sentinel kinds.

The package also exports runtime helpers documented on their own pages:

- Validation combinators — `makeValidator`, `zSentinel`, `zNumberWrite`, `zArrayWrite`,
  `zDateWrite`, `withDelete`, `whichFieldValue`, `isFieldValueSentinel`, `collectSentinelPaths`: see
  [Schema validation](./schema-validation/#schema-validation) and
  [Field-value sentinels](./field-value-sentinels/#per-field-sentinel-approval).
- Timestamp utilities — `convertTimestampToMillis`, `convertMillisToTimestamp`,
  `convertTimestampsToMillis`, `createMillisTimestampConverter`: see
  [Timestamps](./timestamps/#storing-a-timestamp-reading-a-millisecond-number).
- Dot-notation utilities — `isDotNotation`, `hasDotNotationKeys`, `expandDotNotation`,
  `flattenToDotNotation`, `mergeDotNotationUpdate`, `validateDotNotationPath`, `getRootFields`,
  `getDotNotationDepth`: see [Dot notation](./dot-notation/).
- Vector search (`@reggieofarrell/firestore-orm/vector`) — `withVectorSearch`,
  `vectorEmbeddingSchema`, `VectorDistanceMeasure`, `isVectorFieldValue`, and related constants: see
  [Vector search](./vector-search/).
