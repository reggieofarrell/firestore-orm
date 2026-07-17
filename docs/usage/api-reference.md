# API Reference

Full type signatures for `FirestoreRepository`, `FirestoreQueryBuilder`, and the package's exported
types.

[← Documentation index](./README.md) · [Project README](../../README.md)

> **Errors:** the error classes (`NotFoundError`, `ValidationError`, `ConflictError`,
> `FirestoreIndexError`), the `parseFirestoreError` mapper, and the Express `errorHandler`
> middleware are documented in [Error handling](./error-handling.md).

The repository is generic over two types: the **read type** `T` (what reads resolve to, always with
`id` present) and the **write-input type** `W` (defaults to `T`). The curried factory forms infer
`W` from your Zod schema so combinator fields accept their native values and sentinels on writes
with no cast — see
[Per-Field Sentinel Approval](./field-value-sentinels.md#per-field-sentinel-approval).

`id` is **always** stripped from write payloads. The document id is sourced from the auto-generated
Firestore id (on `create` / `bulkCreate` / `createInTransaction`) or from the `id` argument you pass
(on `update` / `patch` / `upsert`). `CreateInput` permits an optional `id`, but it is discarded.

## FirestoreRepository

`class FirestoreRepository<T extends { id?: ID }, W = T>`

### Static Methods

**`withSchema<U extends { id?: ID }>(db: Firestore, collection: string, schema: ZodObject, converter?: FirestoreDataConverter<U>, opts?: { sentinelPolicy?: SentinelPolicy }): FirestoreRepository<U>`**

Create a schema-validated repository (direct form). Write inputs are typed by the read type `U`.

**`withSchema<U extends { id?: ID }>()(db: Firestore, collection: string, schema: S, converter?: FirestoreDataConverter<U>, opts?: { sentinelPolicy?: SentinelPolicy }): FirestoreRepository<U, z.infer<S>>`**
(curried)

Same, but the curried first call fixes the read type `U`, so the write-input type is inferred from
`schema` (`W = z.infer<S>`). Combinator fields then accept their native values / sentinels on
`create` / `update` with no cast. See
[Per-Field Sentinel Approval](./field-value-sentinels.md#per-field-sentinel-approval) for the exact
guarantees.

Both forms **require** a required top-level `id: z.string()` in the schema, or they throw at
construction. `opts.sentinelPolicy` is `'permissive'` (default) or `'strict'`; strict mode enforces
which sentinel kind each field accepts.

**`new FirestoreRepository<T extends { id?: ID }, W = T>(db: Firestore, collectionPath: string, validator?: Validator<W>, parentPath?: string, converter?: FirestoreDataConverter<T>, schemas?: RepositorySchemaSet)`**

Low-level constructor with optional validation and optional Firestore converter support. There is no
options / config / debug / logger bag anywhere in the constructor — prefer `withSchema(...)` for
typical use.

### Instance Methods

#### Reads

**`getById(id: ID): Promise<(T & { id: ID }) | null>`**

Get document by ID. Resolves to `null` when the document does not exist.

**`getByIdOrThrow(id: ID): Promise<T & { id: ID }>`**

Get document by ID; throws `NotFoundError` when missing.

**`fromSnapshot(snapshot: DocumentSnapshot): (T & { id: ID }) | null`**

Map a raw Firestore snapshot — e.g. the one delivered to a trigger cloud function — to `T & { id }`,
applying the repository's converter `fromFirestore` when configured and overlaying the document
`id`. Does no Firestore I/O; returns the read model `T` (not `W`), and `null` for a non-existent
snapshot. Not validated (like other reads); see [Using with Firestore triggers](./triggers.md).

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
runtime. Hooks do **not** run inside `query().update()` / `query().delete()`; inside transactions
they run only via the transaction-scoped repo passed to `runInTransaction`. See
[Lifecycle hooks](./lifecycle-hooks.md#lifecycle-hooks) for full detail.

**`subcollection<U extends { id?: ID }>(parentId: ID, subcollectionName: string, schema?: ZodObject, converter?: FirestoreDataConverter<U>, opts?: { sentinelPolicy?: SentinelPolicy }): FirestoreRepository<U>`**

Access a subcollection under a specific parent document (direct form). Converters are explicit per
repository instance and are **not** inherited from the parent repository. If a `schema` is provided
it must include a required `id`.

**`subcollection<U extends { id?: ID }>()(parentId: ID, subcollectionName: string, schema: S, converter?: FirestoreDataConverter<U>, opts?: { sentinelPolicy?: SentinelPolicy }): FirestoreRepository<U, z.infer<S>>`**
(curried)

Curried form that mirrors the curried `withSchema` factory: fixing the read type `U` in the first
call lets TypeScript infer the write-input type from `schema`, so combinator fields are writable
with no cast while reads stay typed as `U`. See [Subcollections](./subcollections.md).

**`getParentId(): ID | null`**

Get the parent document ID (for subcollections); `null` for a top-level repository.

**`getCollectionPath(): string`**

Get the full collection path.

#### Transactions

**`runInTransaction<R>(fn: (tx: Transaction, repo: FirestoreRepository<T, W>) => Promise<R>): Promise<R>`**

Execute a function within a Firestore transaction. The callback receives a transaction-scoped
`repo`; use its `*InTransaction` methods so that hooks fire correctly. See
[Transactions](./transactions.md).

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

`class FirestoreQueryBuilder<T, W>` — obtained from `repo.query()`. Chainable clause methods return
`this`.

**`where(field: string, op: Operator, value: any): this`**

Add a where clause. Operators: `==`, `!=`, `>`, `>=`, `<`, `<=`, `in`, `not-in`, `array-contains`,
`array-contains-any`.

**`select<K extends keyof T>(...fields: K[]): this`**

Project only the given fields.

**`orderBy(field: string, direction?: 'asc' | 'desc'): this`**

Order results by a field. `direction` defaults to `'asc'`.

**`limit(n: number): this`**

Limit the number of results.

> There is no public `startAt` / `startAfter` / `endBefore` / `endAt` cursor-chaining method. Use
> `paginate(pageSize, cursor?)` for cursor-based paging.

**`get(): Promise<(T & { id: ID })[]>`**

Execute the query and return all matching documents.

**`getOne(): Promise<(T & { id: ID }) | null>`**

Return the first matching document, or `null`.

**`exists(): Promise<boolean>`**

Return `true` if any document matches the query.

**`count(): Promise<number>`**

Count matching documents via a Firestore aggregation query.

**`totalCount(): Promise<number>`**

Count all documents in the base collection. Ignores any accumulated `where(...)` clauses on the
query builder instance.

**`sum<K extends keyof T>(field: K): Promise<number>`**

Firestore-native sum aggregation over a numeric field.

**`average<K extends keyof T>(field: K): Promise<number>`**

Firestore-native average aggregation over a numeric field.

**`distinctValues<K extends keyof T>(field: K): Promise<T[K][]>`**

Return the distinct values observed for a field.

**`paginate(pageSize: number, cursor?: string | null): Promise<{ items: (T & { id: ID })[]; nextCursor: string | null; hasMore: boolean }>`**

Cursor-based pagination (recommended for large datasets). Requires at least one prior `orderBy(...)`
call and throws if `pageSize <= 0`.

**`offsetPaginate(page: number, pageSize: number): Promise<{ items: (T & { id: ID })[]; page: number; pageSize: number; total: number; totalPages: number }>`**

Offset-based pagination.

**`paginateWithCount(pageSize: number, cursor?: string | null): Promise<{ items: (T & { id: ID })[]; nextCursor: string | null; hasMore: boolean; total: number }>`**

Cursor pagination combined with a total count.

**`stream(): AsyncGenerator<T & { id: ID }>`**

Stream matching documents as an async generator (for large datasets).

**`onSnapshot(callback: (items: (T & { id: ID })[]) => void, onError?: (error: Error) => void): Promise<() => void>`**

Subscribe to real-time updates for the query. Resolves to an unsubscribe function.

**`update(data: UpdateInput<W>): Promise<number>`**

Update all matching documents; returns the matched (updated) count. Supports dot notation. Lifecycle
hooks do **not** run for this method.

**`delete(): Promise<number>`**

Delete all matching documents; returns the matched (deleted) count. Lifecycle hooks do **not** run
for this method.

## Exported Types

Types re-exported from the package entry point (`@reggieofarrell/firestore-orm`):

- **`ID`** — `string` document-identifier alias.
- **`HookEvent`** — union of supported lifecycle hook names.
- **`UpdateOptions`** — `{ merge?: boolean; returnDoc?: boolean }`.
- **`PaginatedResult<T>`** — `{ items; nextCursor; hasMore }` from cursor pagination.
- **`UpdateInput<T>`** — update payload type (Firestore `PartialWithFieldValue<T>`-style input).
- **`CreateInput<T>`** — create payload type; permits an optional `id` that is discarded on write.
- **`Validator<T>`** — validation contract produced by `makeValidator(...)`.
- **`RepositorySchemaSet`** — bundle of read / create / update schemas attached to a repository.
- **`SentinelPolicy`** — `'permissive' | 'strict'`.
- **`FieldValueKind`** — union of recognized Firestore sentinel kinds.

The package also exports runtime helpers documented on their own pages:

- Validation combinators — `makeValidator`, `zSentinel`, `zNumberWrite`, `zArrayWrite`,
  `zDateWrite`, `withDelete`, `whichFieldValue`, `isFieldValueSentinel`, `collectSentinelPaths`: see
  [Schema validation](./schema-validation.md#schema-validation) and
  [Field-value sentinels](./field-value-sentinels.md#per-field-sentinel-approval).
- Timestamp utilities — `convertTimestampToMillis`, `convertMillisToTimestamp`,
  `convertTimestampsToMillis`, `createMillisTimestampConverter`: see
  [Timestamps](./timestamps.md#storing-a-timestamp-reading-a-millisecond-number).
- Dot-notation utilities — `isDotNotation`, `hasDotNotationKeys`, `expandDotNotation`,
  `flattenToDotNotation`, `mergeDotNotationUpdate`, `validateDotNotationPath`, `getRootFields`,
  `getDotNotationDepth`: see [Dot notation](./dot-notation.md).
- Vector search (`@reggieofarrell/firestore-orm/vector`) — `withVectorSearch`,
  `vectorEmbeddingSchema`, `VectorDistanceMeasure`, `isVectorFieldValue`, and related constants: see
  [Vector search](./vector-search.md).
