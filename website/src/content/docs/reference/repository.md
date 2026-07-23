---
title: 'FirestoreRepository'
description:
  'Full type signatures for the FirestoreRepository class — construction, reads, writes, identity,
  hooks, and transactions.'
---

Full type signatures for `FirestoreRepository`. For the query builder returned by `query()`, see
[FirestoreQueryBuilder](/firestore-orm/reference/query-builder/); for the package's exported types,
see [Exported Types](/firestore-orm/reference/types/); for the error classes and the Express
middleware, see [Error Handling](/firestore-orm/reference/errors/).

## The four generics

The repository is generic over **four** types, inferred by `withSchema` / `subcollection` from
schema values:

- **`T`** — the read-data type, `z.output<readSchema>`. It carries **no** `id`; reads resolve to
  `FirestoreDocument<T>` (= `Omit<T, 'id'> & { readonly id: ID }`), with the id overlaid from the
  document name.
- **`W`** — the write-input type, `z.input<writeSchema>` (defaults to `T`) — the caller's pre-parse
  input to `create` / `update`. A `writeSchema` built from the write combinators lets those fields
  accept their native values and sentinels on writes with no cast — see
  [Per-Field Sentinel Approval](/firestore-orm/guides/concepts/field-value-sentinels/).
- **`S`** — the stored-data type, `z.output<storedSchema>` (defaults to `T`) — the at-rest shape
  that query field paths derive from.
- **`WO`** — the parsed-write type, `z.output<writeSchema>` (defaults to `W`) — what the SDK
  persists and after-create hooks observe.

The Firestore document name is the **sole authority** for `id`. Schemas describe the document's own
data and **must not** declare a top-level `id` (construction throws if they do) — see
[Document Identity](/firestore-orm/guides/concepts/document-identity/). The id is generated on
`create` / `bulkCreate` / `createInTransaction`, or taken from the `id` argument on `update` /
`patch` / `upsert` / `delete`, and is never part of a write payload.

`UpdateInput<W>` reuses the Firestore Admin SDK's `UpdateData<Omit<W, 'id'>>`, so update-family
methods accept **typed dot-notation field paths** (`'address.city'`) — no `as any` — while `create`
/ `upsert` (`CreateInput<W>` = `WithFieldValue<Omit<W, 'id'>>`) reject dotted keys. Query field
paths are derived from the stored shape `S` (excluding the synthetic `id`) via the exported
`FieldPaths` helper (with `PathValue` for resolving a path's value type). See the
[Dot Notation guide](/firestore-orm/guides/working-with-data/dot-notation/).

`class FirestoreRepository<T extends object, W extends object = T, S extends object = T, WO extends object = W>`

## Static methods

**`withSchema<RS extends ZodObject, WS extends ZodObject = RS, SS extends ZodObject = RS>(db: Firestore, collection: string, readSchema: RS, options?: { writeSchema?: WS; storedSchema?: SS; readConverter?: ReadConverter<z.output<RS>>; sentinelPolicy?: SentinelPolicy; allowLegacyDatastoreIds?: boolean }): FirestoreRepository<z.output<RS>, z.input<WS>, z.output<SS>, z.output<WS>>`**

Create a schema-validated repository. The **read type** is `z.output<readSchema>`, the **write-input
type** is `z.input<writeSchema>` (defaults to the read type), and the **stored type** is
`z.output<storedSchema>` (defaults to the read type). Build the overlay from the write combinators
so those fields accept their native values / sentinels on `create` / `update` with no cast — see
[Per-Field Sentinel Approval](/firestore-orm/guides/concepts/field-value-sentinels/) for the exact
guarantees.

Types are inferred from schema **values** — do not pass an explicit generic. The read / write /
stored schemas describe the document's own data and **must not** declare a top-level `id`, or
construction throws with a remedial error — the document name is the sole `id` authority.
`options.sentinelPolicy` is `'strict'` (default) or `'permissive'`; strict mode enforces which
sentinel kind each field accepts. When a `readConverter` is supplied, `storedSchema` is **required**
(the converter changes the read shape, so query paths need an explicit at-rest schema) — see
[Read Converters](/firestore-orm/guides/concepts/read-converters/). `allowLegacyDatastoreIds` opts
into accepting legacy Datastore-mode numeric ids.

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

## Reads

**`getById(id: ID): Promise<FirestoreDocument<T> | null>`**

Get document by ID. Resolves to `null` when the document does not exist.

**`getByIdOrThrow(id: ID): Promise<FirestoreDocument<T>>`**

Get document by ID; throws `NotFoundError` when missing.

**`fromSnapshot(snapshot: DocumentSnapshot): FirestoreDocument<T> | null`**

Map a raw Firestore snapshot — e.g. the one delivered to a trigger cloud function — to
`FirestoreDocument<T>`, applying the repository's `readConverter` `fromFirestore` when configured
and overlaying the document `id`. Does no Firestore I/O; returns the read model `T` (not `W`), and
`null` for a non-existent snapshot. Not validated (like other reads); compose `validate` after a
null guard — see [Cloud Functions & triggers](/firestore-orm/guides/integrations/cloud-functions/).

**`validate(data: FirestoreDocument<T>): FirestoreDocument<T>`**
**`validate(data: FirestoreDocument<T>[]): FirestoreDocument<T>[]`**

Parse an already-read value through `schemas.read` and return the parsed output. Throws
`ValidationError` on mismatch (array form is all-or-nothing). Throws a plain `Error` if the
repository has no schema. See
[Schema Validation](/firestore-orm/guides/concepts/schema-validation/#validating-reads-opt-in).

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

Subscribe to real-time updates for a single document by ID. Returns an unsubscribe function. See
[Real-time & Listeners](/firestore-orm/guides/advanced/real-time/).

## Writes

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

## Identity

**`id(raw: string): ID`**

Validate an untrusted document id at the boundary and return it as an `ID`. Throws
`InvalidDocumentIdError` when `raw` is malformed (empty, contains `/`, `.`, `..`, a `__…__` reserved
pattern, or exceeds 1500 bytes). Use it before passing a request-supplied id to `getById`, `update`,
etc. See [Document Identity](/firestore-orm/guides/concepts/document-identity/).

**`newId(): ID`**

Generate a new, validated auto-id **without** writing a document. Persist under it explicitly with
`upsert(id, …)` or a transaction `set` — `create()` and `createInTransaction()` each generate their
own fresh id.

## Query, hooks & helpers

**`query(): FirestoreQueryBuilder<T, W, S>`**

Create a query builder for complex queries, aggregations, streaming, and real-time listeners. See
[FirestoreQueryBuilder](/firestore-orm/reference/query-builder/).

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
[Lifecycle hooks](/firestore-orm/guides/concepts/lifecycle-hooks/) for full detail.

**`subcollection<RS extends ZodObject, WS extends ZodObject = RS, SS extends ZodObject = RS>(parentId: ID, subcollectionName: string, readSchema: RS, options?: { writeSchema?: WS; storedSchema?: SS; readConverter?: ReadConverter<z.output<RS>>; sentinelPolicy?: SentinelPolicy; allowLegacyDatastoreIds?: boolean }): FirestoreRepository<z.output<RS>, z.input<WS>, z.output<SS>, z.output<WS>>`**

Access a subcollection under a specific parent document. Mirrors `withSchema`: read/write/stored
types are inferred from schema values, and a `writeSchema` overlay enables cast-free combinator
writes. Converters are explicit per repository instance and are **not** inherited from the parent
repository. The read / write / stored schemas **must not** declare a top-level `id` (construction
throws otherwise); when a `readConverter` is supplied, `storedSchema` is required. For an
unvalidated subcollection, construct a repository directly against the full path with
`new FirestoreRepository<Order>(db, `${parentPath}/${parentId}/orders`)`. See
[Subcollections](/firestore-orm/guides/working-with-data/subcollections/).

**`getParentId(): ID | null`**

Get the parent document ID (for subcollections); `null` for a top-level repository.

**`getCollectionPath(): string`**

Get the full collection path.

## Transactions

**`runInTransaction<R>(fn: (tx: Transaction, repo: FirestoreRepository<T, W, S, WO>) => Promise<R>): Promise<R>`**

Execute a function within a Firestore transaction. The callback receives a transaction-scoped
`repo`; use its `*InTransaction` methods so that hooks fire correctly. See
[Transactions](/firestore-orm/guides/working-with-data/transactions/).

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
