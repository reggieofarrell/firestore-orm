---
title: 'API Reference'
description:
  'Full type signatures for FirestoreRepository, FirestoreQueryBuilder, and exported types.'
---

Full type signatures for `FirestoreRepository`, `FirestoreQueryBuilder`, and the package's exported
types.

> **Errors:** the error classes (`NotFoundError`, `ValidationError`, `ConflictError`,
> `FirestoreIndexError`), the `parseFirestoreError` mapper, and the Express `errorHandler`
> middleware are documented in [Error handling](./error-handling/).

The repository is generic over two types: the **read type** `T` (what reads resolve to, always with
`id` present) and the **write-input type** `W` (defaults to `T`). `withSchema` / `subcollection`
infer both from schema values: `T = z.infer<readSchema>`, and `W = z.infer<writeSchema>` when a
`writeSchema` overlay is supplied (otherwise `W = T`). A `writeSchema` built from the write
combinators lets those fields accept their native values and sentinels on writes with no cast — see
[Per-Field Sentinel Approval](./field-value-sentinels/#per-field-sentinel-approval).

`id` is **always** stripped from write payloads. The document id is sourced from the auto-generated
Firestore id (on `create` / `bulkCreate` / `createInTransaction`) or from the `id` argument you pass
(on `update` / `patch` / `upsert`). `CreateInput` permits an optional `id`, but it is discarded.

`UpdateInput<W>` reuses the Firestore Admin SDK's `UpdateData<Omit<W, 'id'>>`, so update-family
methods accept **typed dot-notation field paths** (`'address.city'`) — no `as any` — while `create`
/ `upsert` (`CreateInput<W>`) reject dotted keys. Query field paths are typed via the exported
`FieldPaths<T>` helper (with `PathValue<T, P>` for resolving a path's value type). See the
[Dot Notation guide](./dot-notation/).

## FirestoreRepository

`class FirestoreRepository<T extends { id?: ID }, W = T>`

### Static Methods

**`withSchema<RS extends ZodObject, WS extends ZodObject = RS>(db: Firestore, collection: string, readSchema: RS, options?: { writeSchema?: WS; readConverter?: ReadConverter<z.infer<RS>>; sentinelPolicy?: SentinelPolicy }): FirestoreRepository<z.infer<RS>, z.infer<WS>>`**

Create a schema-validated repository. The **read type** is `z.infer<readSchema>` and the
**write-input type** is `z.infer<writeSchema>` when a `writeSchema` overlay is supplied, otherwise
it equals the read type. Build the overlay from the write combinators so those fields accept their
native values / sentinels on `create` / `update` with no cast — see
[Per-Field Sentinel Approval](./field-value-sentinels/#per-field-sentinel-approval) for the exact
guarantees.

Types are inferred from schema **values** — do not pass an explicit read-type generic. The
`readSchema` **requires** a required top-level `id: z.string()` or it throws at construction; the
`writeSchema` overlay need not include `id`. `options.sentinelPolicy` is `'permissive'` (default) or
`'strict'`; strict mode enforces which sentinel kind each field accepts.

**`new FirestoreRepository<T extends { id?: ID }, W = T>(db: Firestore, collectionPath: string, validator?: Validator<W>, parentPath?: string, readConverter?: ReadConverter<T>, schemas?: RepositorySchemaSet)`**

Low-level constructor with optional validation and an optional read-only converter. A
`ReadConverter<T>` is the `fromFirestore(snapshot) => T` mapper only; the repository builds the full
`FirestoreDataConverter` internally and applies it to reads, so `toFirestore` is never invoked.
There is no options / config / debug / logger bag anywhere in the constructor — prefer
`withSchema(...)` for typical use.

### Instance Methods

#### Reads

**`getById(id: ID): Promise<(T & { id: ID }) | null>`**

Get document by ID. Resolves to `null` when the document does not exist.

**`getByIdOrThrow(id: ID): Promise<T & { id: ID }>`**

Get document by ID; throws `NotFoundError` when missing.

**`fromSnapshot(snapshot: DocumentSnapshot): (T & { id: ID }) | null`**

Map a raw Firestore snapshot — e.g. the one delivered to a trigger cloud function — to `T & { id }`,
applying the repository's `readConverter` `fromFirestore` when configured and overlaying the
document `id`. Does no Firestore I/O; returns the read model `T` (not `W`), and `null` for a
non-existent snapshot. Not validated (like other reads); compose `validate` after a null guard — see
[Using with Firestore triggers](./triggers/).

**`validate(data: T & { id: ID }): T & { id: ID }`**
**`validate(data: (T & { id: ID })[]): (T & { id: ID })[]`**

Parse an already-read value through `schemas.read` and return the parsed output. Throws
`ValidationError` on mismatch (array form is all-or-nothing). Throws a plain `Error` if the
repository has no schema. See [Schema Validation](./schema-validation/#validating-reads-opt-in).

**`safeValidate(data: T & { id: ID }): SafeResult<T>`**
**`safeValidate(data: (T & { id: ID })[]): SafeResult<T>[]`**

Non-throwing variant of `validate`. Returns `{ success: true, data }` or
`{ success: false, error: ValidationError }` (array form: one result per element). Still throws a
plain `Error` when no schema is configured.

**`getAll(): Promise<(T & { id: ID })[]>`**

Get all documents in the collection.

**`findByField<K extends keyof T>(field: K, value: T[K]): Promise<(T & { id: ID })[]>`**

Find all documents whose `field` equals `value`.

**`getOneByField<K extends keyof T>(field: K, value: T[K]): Promise<(T & { id: ID }) | null>`**

Find the first document by field value. Returns `null` when no document matches.

**`getOneByFieldOrThrow<K extends keyof T>(field: K, value: T[K]): Promise<T & { id: ID }>`**

Find exactly one document by field value. Throws `NotFoundError` when none match and `ConflictError`
when multiple documents match.

**`listenOne(id: ID, callback: (item: T & { id: ID }) => void, onError?: (error: Error) => void): () => void`**

Subscribe to real-time updates for a single document by ID. Returns an unsubscribe function.

#### Writes

**`create(data: CreateInput<W>): Promise<T & { id: ID }>`**

Create a new document with an auto-generated Firestore ID.

**`bulkCreate(data: CreateInput<W>[]): Promise<(T & { id: ID })[]>`**

Create multiple documents, committed in batches of 500.

**`update(id: ID, data: UpdateInput<W>, options?: { merge?: boolean; returnDoc?: boolean }): Promise<{ id: ID } | (T & { id: ID })>`**

Update a document with partial data. Supports dot notation for nested updates. Pass
`{ merge: true }` to normalize nested objects to dot paths before writing. Pass
`{ returnDoc: true }` to resolve to the updated document instead of just `{ id }`.

**`patch(id: ID, data: UpdateInput<W>, options?: { returnDoc?: boolean }): Promise<{ id: ID } | (T & { id: ID })>`**

Merge-style update — equivalent to `update(id, data, { merge: true })`. `patch` **always** merges,
so there is no `merge` option; `{ returnDoc: true }` resolves to the updated document.

**`bulkUpdate(updates: { id: ID; data: UpdateInput<W> }[]): Promise<{ id: ID }[]>`**

Update multiple documents in a batch. Supports dot notation.

**`bulkPatch(updates: { id: ID; data: UpdateInput<W> }[]): Promise<{ id: ID }[]>`**

Merge-style batch update. Each payload is normalized like `patch(...)` before the batched writes.

**`upsert(id: ID, data: CreateInput<W>, options?: { returnDoc?: boolean }): Promise<{ id: ID } | (T & { id: ID })>`**

Create or overwrite the document with the given ID. Pass `{ returnDoc: true }` to resolve to the
final persisted document.

**`delete(id: ID): Promise<void>`**

Permanently delete a document. Throws `NotFoundError` when the document does not exist.

**`bulkDelete(ids: ID[]): Promise<number>`**

Permanently delete multiple documents. Resolves to the count of documents that **actually existed**
(not the length of the input array).

#### Query, hooks, and helpers

**`query(): FirestoreQueryBuilder<T, W>`**

Create a query builder for complex queries, aggregations, streaming, and real-time listeners.

**`on(event: HookEvent, fn: HookFn): void`**

Register a lifecycle hook. Supported events:

- `beforeCreate`, `afterCreate`
- `beforeUpdate`, `afterUpdate`
- `beforeDelete`, `afterDelete`
- `beforeBulkCreate`, `afterBulkCreate`
- `beforeBulkUpdate`, `afterBulkUpdate`
- `beforeBulkDelete`, `afterBulkDelete`

Payload notes: `beforeUpdate` receives `data & { id }`; `afterUpdate` receives `{ id }`;
`afterBulkUpdate` receives `{ ids }`; `beforeBulkDelete` / `afterBulkDelete` receive
`{ ids, documents }`; single-delete hooks receive the full persisted document `{ ...data, id }` at
runtime. `query().update()` / `query().delete()` run the **bulk** hooks
(`beforeBulkUpdate`/`afterBulkUpdate`, `beforeBulkDelete`/`afterBulkDelete`), not the per-document
hooks; inside transactions only `before*` hooks run, via the transaction-scoped repo passed to
`runInTransaction`. See [Lifecycle hooks](./lifecycle-hooks/#lifecycle-hooks) for full detail.

**`subcollection<RS extends ZodObject, WS extends ZodObject = RS>(parentId: ID, subcollectionName: string, readSchema: RS, options?: { writeSchema?: WS; readConverter?: ReadConverter<z.infer<RS>>; sentinelPolicy?: SentinelPolicy }): FirestoreRepository<z.infer<RS>, z.infer<WS>>`**

Access a subcollection under a specific parent document. Mirrors `withSchema`: read/write types are
inferred from schema values, and a `writeSchema` overlay enables cast-free combinator writes.
Converters are explicit per repository instance and are **not** inherited from the parent
repository. The `readSchema` **requires** a required top-level `id`. For an unvalidated
subcollection, construct a repository directly against the full path with
`new FirestoreRepository<Order>(db, `${parentPath}/${parentId}/orders`)`. See
[Subcollections](./subcollections/).

**`getParentId(): ID | null`**

Get the parent document ID (for subcollections); `null` for a top-level repository.

**`getCollectionPath(): string`**

Get the full collection path.

#### Transactions

**`runInTransaction<R>(fn: (tx: Transaction, repo: FirestoreRepository<T, W>) => Promise<R>): Promise<R>`**

Execute a function within a Firestore transaction. The callback receives a transaction-scoped
`repo`; use its `*InTransaction` methods so that hooks fire correctly. See
[Transactions](./transactions/).

**`getForUpdateInTransaction(tx: Transaction, id: ID): Promise<(T & { id: ID }) | null>`**

Read a document for update within a transaction.

**`updateInTransaction(tx: Transaction, id: ID, data: UpdateInput<W>, options?: { merge?: boolean }): Promise<void>`**

Update a document within a transaction. Pass `{ merge: true }` to normalize nested objects to dot
paths before writing.

**`patchInTransaction(tx: Transaction, id: ID, data: UpdateInput<W>): Promise<void>`**

Merge-style update within a transaction — equivalent to
`updateInTransaction(tx, id, data, { merge: true })`. Takes no options.

**`createInTransaction(tx: Transaction, data: CreateInput<W>): Promise<T & { id: ID }>`**

Create a document within a transaction (auto-generated ID).

**`deleteInTransaction(tx: Transaction, id: ID): Promise<void>`**

Delete a document within a transaction.

## FirestoreQueryBuilder

`class FirestoreQueryBuilder<T, W, R = T & { id }>` — obtained from `repo.query()`. `R` is the
result shape of terminal reads (`get`, `getOne`, `stream`, `paginate`, …); it defaults to the full
`T & { id }` and is narrowed by `select()`. Chainable clause methods (`where`, `orderBy`, `limit`)
return `this`; `select()` returns a **new** builder (see below).

**`where(field: FieldPaths<T> | FieldPath, op: WhereFilterOp, value: unknown): this`**

Add a where clause. `field` is a typed field path — a top-level key or a nested dot-notation path
(`'address.city'`) derived from `T` — or a `FieldPath` for dynamic names. Operators: `==`, `!=`,
`>`, `>=`, `<`, `<=`, `in`, `not-in`, `array-contains`, `array-contains-any`.

**`select(...fields: (FieldPaths<T> | FieldPath)[]): FirestoreQueryBuilder<T, W, DeepPartial<T> & { id }>`**

Project only the given fields. Accepts typed nested paths and `FieldPath`. Returns a **new** builder
(it does not mutate the original) whose terminal reads are typed `DeepPartial<T> & { id }` — every
property, including nested map properties, is optional, so a field you projected away (at any depth)
is a compile error to access without a guard. A `readConverter` written for full documents may throw
on a projected result. `select()` cannot be combined with `onSnapshot()` — Firestore does not allow
a real-time listener on a field-masked query, so the builder rejects it locally.

**`orderBy(field: FieldPaths<T> | FieldPath, direction?: 'asc' | 'desc'): this`**

Order results by a field (top-level or nested dot-notation path). `direction` defaults to `'asc'`.

**`limit(n: number): this`**

Limit the number of results.

> There is no public `startAt` / `startAfter` / `endBefore` / `endAt` cursor-chaining method. Use
> `paginate(pageSize, cursor?)` for cursor-based paging.

**`get(): Promise<R[]>`**

Execute the query and return all matching documents. `R` is `T & { id }` by default, or
`DeepPartial<T> & { id }` after `select(...)`.

**`getOne(): Promise<R | null>`**

Return the first matching document, or `null`.

**`exists(): Promise<boolean>`**

Return `true` if any document matches the query.

**`count(): Promise<number>`**

Count matching documents via a Firestore aggregation query.

**`totalCount(): Promise<number>`**

Count all documents in the base collection. Ignores any accumulated `where(...)` clauses on the
query builder instance.

**`sum(field: NumericFieldPaths<T> | FieldPath): Promise<number>`**

Firestore-native sum aggregation over a numeric field path (top-level or nested/dotted numeric
fields only) or a `FieldPath`.

**`average(field: NumericFieldPaths<T> | FieldPath): Promise<number>`**

Firestore-native average aggregation over a numeric field path (top-level or nested/dotted numeric
fields only) or a `FieldPath`.

**`distinctValues<K extends keyof T>(field: K): Promise<T[K][]>`**

Return the distinct values observed for a field.

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
- **`UpdateInput<T>`** — update payload type (Firestore `PartialWithFieldValue<T>`-style input).
- **`CreateInput<T>`** — create payload type; permits an optional `id` that is discarded on write.
- **`Validator<T>`** — validation contract produced by `makeValidator(...)`.
- **`RepositorySchemaSet`** — bundle of read / create / update schemas attached to a repository.
- **`SentinelPolicy`** — `'permissive' | 'strict'`.
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
