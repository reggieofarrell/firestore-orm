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

**`getById(id: ID, options: { withMetadata: true }): Promise<WithMetadata<FirestoreDocument<T>> | null>`**

Same as `getById(id)`, but each result is `{ doc, metadata }` — the document under `doc` (unchanged
from the default read) plus sibling `DocumentMetadata` under `metadata`. Pass the flag inline; a
hoisted `const opts = { withMetadata: true }` widens to `{ withMetadata: boolean }` and matches no
overload.

**`getByIdOrThrow(id: ID): Promise<FirestoreDocument<T>>`**

Get document by ID; throws `NotFoundError` when missing.

**`getByIdOrThrow(id: ID, options: { withMetadata: true }): Promise<WithMetadata<FirestoreDocument<T>>>`**

Throws `NotFoundError` when missing; otherwise returns `{ doc, metadata }` like
`getById(id, { withMetadata: true })`.

**`getByIdWithUpdateTime(id: ID): Promise<{ doc: FirestoreDocument<T>; updateTime: Timestamp } | null>`**

Get a document together with its Firestore `updateTime` — the token for optimistic-concurrency
writes. Resolves to `null` when the document does not exist. The result is a **pair**, not an
overlay, so a stored field named `updateTime` is never shadowed. Pass `updateTime` back as
`lastUpdateTime` on `update` / `patch` / `delete` (or their bulk and transaction variants). A
configured `readConverter` applies to `doc`. For the general read-metadata shape (all provenance
fields, not just `updateTime`), use `getById(id, { withMetadata: true })` instead — this method
remains the narrow CAS-token accessor. **Not** on `ReadOnlyTransactionalRepository` — it performs
non-transactional I/O. See
[Conditional writes](/firestore-orm/guides/working-with-data/crud-operations/#conditional-writes).

**`getMany(ids: ID[]): Promise<(FirestoreDocument<T> | null)[]>`** /
**`getMany(ids: ID[], options: { fieldMask: … }): Promise<(FirestoreDocument<DeepPartial<T>> | null)[]>`** /
**`getMany(ids: ID[], options: { withMetadata: true }): Promise<(WithMetadata<FirestoreDocument<T>> | null)[]>`** /
**`getMany(ids: ID[], options: { withMetadata: true; fieldMask: … }): Promise<(WithMetadata<FirestoreDocument<DeepPartial<T>>> | null)[]>`**

Batched multi-document read via one `BatchGetDocuments` RPC (`db.getAll`). Results are in **input
order** (SDK client-side re-sort). Missing documents are `null` in position (`ids[i]` is the missing
id). Empty input returns `[]` without contacting Firestore. Duplicate ids are allowed (one entry per
position). Prefer this over `query().whereId('in', ids)` for id lookups — no 30-value cap, input
order, and misses are marked rather than silently dropped. When `fieldMask` is supplied, the result
narrows to `FirestoreDocument<DeepPartial<T>>` (mirroring `select()`); `id` always survives;
`fieldMask: []` is a legal ID-only projection.

:::caution
With a configured `readConverter`, `fromFirestore` receives the **masked** document. A converter that
dereferences a field the mask omitted will throw a raw `TypeError`. Either omit the mask, widen it
to cover every field the converter reads, or make the converter defensive — see
[Read converters](/firestore-orm/guides/concepts/read-converters/).
:::

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

**`getAll(): Promise<FirestoreDocument<T>[]>`** /
**`getAll(options: { withMetadata: true }): Promise<WithMetadata<FirestoreDocument<T>>[]>`**

Get all documents in the collection. Pass `{ withMetadata: true }` for `{ doc, metadata }` rows.

**`findByField(field: FieldPaths<OmitId<S>> | FieldPath, value: unknown): Promise<FirestoreDocument<T>[]>`** /
**`findByField(field, value, options: { withMetadata: true }): Promise<WithMetadata<FirestoreDocument<T>>[]>`**

Find all documents whose `field` (a stored field path) equals `value`.

**`getOneByField(field: FieldPaths<OmitId<S>> | FieldPath, value: unknown): Promise<FirestoreDocument<T> | null>`** /
**`getOneByField(field, value, options: { withMetadata: true }): Promise<WithMetadata<FirestoreDocument<T>> | null>`**

Find the first document by field value. Returns `null` when no document matches.

**`getOneByFieldOrThrow(field: FieldPaths<OmitId<S>> | FieldPath, value: unknown): Promise<FirestoreDocument<T>>`**
**`getOneByFieldOrThrow(field, value, options: { withMetadata: true }): Promise<WithMetadata<FirestoreDocument<T>>>`**

Find exactly one document by field value. Throws `NotFoundError` when none match and `ConflictError`
when multiple documents match.

**`listenOne(id: ID, callback: (item: FirestoreDocument<T>) => void, onError?: (error: Error) => void): () => void`**

Subscribe to real-time updates for a single document by ID. Returns an unsubscribe function. See
[Real-time & Listeners](/firestore-orm/guides/advanced/real-time/).

**`listenOneDetailed(id: ID, callback: (item: WithMetadata<FirestoreDocument<T>>) => void, onError?: (error: Error) => void): () => void`**

Subscribe to a single document and deliver `{ doc, metadata }` on every change — same provenance
fields as `{ withMetadata: true }` reads. Returns an unsubscribe function synchronously. When the
document is **deleted**, routes to `onError(new NotFoundError(...))` (mirrors `listenOne`) rather
than invoking the callback with a nullable document — the underlying deletion snapshot has no
`createTime` / `updateTime` to build metadata from.

## Writes

**`create(data: CreateInput<W>, options: { returnDoc: true }): Promise<FirestoreDocument<T>>`**
**`create(data: CreateInput<W>, options?: { returnDoc?: false }): Promise<{ id: ID }>`**

Create a new document with an auto-generated Firestore ID. Returns `{ id }` by default; pass
`{ returnDoc: true }` to resolve to the created `FirestoreDocument<T>`.

**`bulkCreate(data: CreateInput<W>[], options: { returnDoc: true }): Promise<FirestoreDocument<T>[]>`**
**`bulkCreate(data: CreateInput<W>[], options?: { returnDoc?: false }): Promise<{ id: ID }[]>`**

Create multiple documents, committed in batches of 500. Returns `{ id }[]` by default; pass
`{ returnDoc: true }` for the created documents.

**`createWithId(id: ID, data: CreateInput<W>, options: { returnDoc: true }): Promise<FirestoreDocument<T>>`**
**`createWithId(id: ID, data: CreateInput<W>, options?: { returnDoc?: false }): Promise<{ id: ID }>`**

**Create-only** write under a caller-supplied ID — the counterpart to `upsert`, which overwrites.
Throws `ConflictError` when a document already exists at that ID. The existence check happens on the
backend as part of the write, so two concurrent calls cannot both succeed. Fires `beforeCreate` /
`afterCreate` with the caller's id.

**`bulkCreateWithIds(entries: { id: ID; data: CreateInput<W> }[], options: { returnDoc: true }): Promise<FirestoreDocument<T>[]>`**
**`bulkCreateWithIds(entries: { id: ID; data: CreateInput<W> }[], options?: { returnDoc?: false }): Promise<{ id: ID }[]>`**

Batched create-only writes under caller-supplied IDs. Throws `ConflictError` if any ID exists — at
or below 500 operations the batch is atomic, so **no sibling lands**. Duplicate IDs in the input are
rejected before any I/O.

**`update(id: ID, data: UpdateInput<W>, options: UpdateOptions & { returnDoc: true }): Promise<FirestoreDocument<T>>`**
**`update(id: ID, data: UpdateInput<W>, options?: UpdateOptions & { returnDoc?: false }): Promise<{ id: ID }>`**

Update a document with partial data. Supports dot notation for nested updates. Pass
`{ merge: true }` to normalize nested objects to dot paths before writing. Pass `{ lastUpdateTime }`
(from `getByIdWithUpdateTime`) to make the write conditional — it commits only if the document is
still at that version, and otherwise throws `PreconditionFailedError`. Returns `{ id }` by default;
pass `{ returnDoc: true }` to resolve to the updated `FirestoreDocument<T>`.

**`patch(id: ID, data: UpdateInput<W>, options: { returnDoc: true; lastUpdateTime?: Timestamp }): Promise<FirestoreDocument<T>>`**
**`patch(id: ID, data: UpdateInput<W>, options?: { returnDoc?: false; lastUpdateTime?: Timestamp }): Promise<{ id: ID }>`**

Merge-style update — equivalent to `update(id, data, { merge: true })`. `patch` **always** merges,
so there is no `merge` option; `{ returnDoc: true }` resolves to the updated `FirestoreDocument<T>`,
and `{ lastUpdateTime }` guards the write exactly as on `update`.

**`bulkUpdate(updates: { id: ID; data: UpdateInput<W>; lastUpdateTime?: Timestamp }[]): Promise<{ id: ID }[]>`**

Update multiple documents in a batch. Supports dot notation. Each entry may carry its own
`lastUpdateTime`; at or below 500 operations one failed precondition rejects the whole batch and
changes nothing.

**`bulkPatch(updates: { id: ID; data: UpdateInput<W>; lastUpdateTime?: Timestamp }[]): Promise<{ id: ID }[]>`**

Merge-style batch update. Each payload is normalized like `patch(...)` before the batched writes.

**`upsert(id: ID, data: CreateInput<W>, options: { returnDoc: true }): Promise<FirestoreDocument<T>>`**
**`upsert(id: ID, data: CreateInput<W>, options?: { returnDoc?: false }): Promise<{ id: ID }>`**

Create or overwrite the document with the given ID. Returns `{ id }` by default; pass
`{ returnDoc: true }` to resolve to the final persisted `FirestoreDocument<T>`. Use `createWithId`
instead when the document must **not** already exist.

**`delete(id: ID, options?: { lastUpdateTime?: Timestamp }): Promise<void>`**

Permanently delete a document. Throws `NotFoundError` when the document does not exist — including
when a `lastUpdateTime` was supplied, because `delete`'s own existence pre-read runs first. A
supplied `lastUpdateTime` that no longer matches throws `PreconditionFailedError`.

**`bulkDelete(ids: ID[]): Promise<number>`**
**`bulkDelete(entries: { id: ID; lastUpdateTime?: Timestamp }[]): Promise<number>`**

Permanently delete multiple documents. Resolves to the count of documents that **actually existed**
(not the length of the input array). The two overloads cannot be mixed in one array. Documents that
are already gone are filtered out by the existence pre-read, so an entry with a `lastUpdateTime`
whose document no longer exists is skipped rather than raising.

**`bulkWrite(operations: BulkWriteOperation<W>[], options?: BulkWriteOptions): Promise<BulkWriteResult[]>`**

High-throughput, **non-atomic** writes backed by the Admin SDK's `BulkWriter`, with a positional
result per operation. This is a *separate contract* from the fixed-batch helpers: each op succeeds
or fails alone; lifecycle hooks do **not** run (throws if any bulk hook is registered unless
`{ skipHooks: true }`); duplicate explicit ids are rejected because same-document commit order is
undefined. Validation failures and backend refusals land as `{ ok: false, error }` for that item
while siblings still write. Optional `throttling` is forwarded to `db.bulkWriter`.

**`recursiveDelete(id: ID): Promise<void>`**

**Destructive.** Permanently deletes the document at `id` **and every descendant** (all
subcollections, any depth). No lifecycle hooks run; no count is returned. A missing document
resolves (idempotent). Partial failure is reported as a whole-call error — already-deleted docs stay
deleted; re-running is safe. Separate from `delete(id)`, which orphans subcollections.

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

**`collectionGroup(): FirestoreCollectionGroup<T, S>`**

Get a handle on the **collection group** this repository's collection belongs to — every collection
with the same id, at any depth, including a same-named root collection. The group id is the last
segment of this repository's collection path, and the handle inherits this repository's read model,
stored (query-path) model, `readConverter`, and `allowLegacyDatastoreIds` policy.

The handle is stateless and reusable. It exposes `collectionId`, `query()` (a fresh
[collection-group query builder](/firestore-orm/reference/query-builder/#collection-group-query-builder)
each call), and `fromSnapshot(snapshot)` — the group counterpart of the repository's own
`fromSnapshot`, returning a `CollectionGroupDocument<T> | null` with full-path identity.

A collection group is a `Query`, not a `CollectionReference`, so the surface is **read-only** and
results carry `path` / `parentPath` alongside `id` (ids are not unique across a group). **Throws**
if this repository's **read or stored** schema declares a top-level `path` or `parentPath`, which
the identity overlay would shadow — the stored model counts because query field paths derive from
it. `fromSnapshot(snapshot)` **throws** for a snapshot outside the group (its collection id must
match), so an out-of-group trigger cannot produce a well-typed document carrying the wrong identity.
Collection-group queries also need explicitly created collection-group-scoped indexes in production.
See
[collection-group queries](/firestore-orm/guides/working-with-data/queries/#collection-group-queries).

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
`before*` hooks run, via the transaction-scoped repo passed to `runInTransaction`. **`bulkWrite` and
`recursiveDelete` run no hooks** — `bulkWrite` throws when any bulk hook is registered unless
`{ skipHooks: true }` is passed. See
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

Get the full collection path. Pure — also available on `ReadOnlyTransactionalRepository` so
query-shaped PITR escape hatches can build a collection reference from the callback repo.

## Transactions

**`runInTransaction<R>(fn, options: FirebaseFirestore.ReadOnlyTransactionOptions): Promise<R>`** /
**`runInTransaction<R>(fn, options?: FirebaseFirestore.ReadWriteTransactionOptions): Promise<R>`**

Execute a function within a Firestore transaction. Options are forwarded to the Admin SDK
(`maxAttempts` on read-write; `{ readOnly: true, readTime? }` for a lock-free / PITR snapshot). The
option types are Admin SDK types (`FirebaseFirestore.ReadOnlyTransactionOptions` /
`FirebaseFirestore.ReadWriteTransactionOptions`) and are **not** re-exported by this package. When
`readOnly: true`, the callback `repo` is narrowed to `ReadOnlyTransactionalRepository` (read-safe
members only — write helpers and non-transactional reads are absent from the type). Otherwise the
callback receives a full transaction-scoped `repo`; use its `*InTransaction` methods so that hooks
fire correctly. See [Transactions](/firestore-orm/guides/working-with-data/transactions/).

**`runReadOnlyAt<R>(readTime: Timestamp, fn): Promise<R>`**

Convenience for a read-only transaction at `readTime`. Equivalent to
`runInTransaction(fn, { readOnly: true, readTime })`. Callback `repo` is
`ReadOnlyTransactionalRepository`.

**`getInTransaction(tx: Transaction, id: ID): Promise<FirestoreDocument<T> | null>`**

Read a document inside a transaction. Takes a pessimistic lock in a read-write transaction;
lock-free when `readOnly: true`. Available on both the full repo and
`ReadOnlyTransactionalRepository`.

**`getManyInTransaction(tx: Transaction, ids: ID[]): Promise<(FirestoreDocument<T> | null)[]>`** /
**`getManyInTransaction(tx: Transaction, ids: ID[], options: { fieldMask: … }): Promise<(FirestoreDocument<DeepPartial<T>> | null)[]>`**

Batched multi-document read inside a transaction via `tx.getAll`. Same positional / null-for-miss /
field-mask / empty-input / duplicate-id contract as `getMany`. In a read-write transaction this
takes pessimistic locks on **all** requested ids in one round trip; in a read-only / PITR
transaction it is lock-free. **Is** on `ReadOnlyTransactionalRepository` (unlike plain `getMany`,
which performs non-transactional I/O and is deliberately absent).

:::caution
With a configured `readConverter`, `fromFirestore` receives the **masked** document when `fieldMask`
is supplied. A converter that dereferences an omitted field throws a raw `TypeError` — see
[Read converters](/firestore-orm/guides/concepts/read-converters/).
:::

**`updateInTransaction(tx: Transaction, id: ID, data: UpdateInput<W>, options?: { merge?: boolean; lastUpdateTime?: Timestamp }): Promise<void>`**

Update a document within a transaction. Pass `{ merge: true }` to normalize nested objects to dot
paths before writing, and `{ lastUpdateTime }` to guard the write. A failed precondition does
**not** retry the transaction — Firestore retries on contention, not on a rejected precondition — so
the callback runs once and the transaction fails with `PreconditionFailedError`. **Not** on
`ReadOnlyTransactionalRepository`.

**`patchInTransaction(tx: Transaction, id: ID, data: UpdateInput<W>, options?: { lastUpdateTime?: Timestamp }): Promise<void>`**

Merge-style update within a transaction — equivalent to
`updateInTransaction(tx, id, data, { merge: true })`. Accepts only `lastUpdateTime` (merge is
implied). **Not** on `ReadOnlyTransactionalRepository`.

**`createInTransaction(tx: Transaction, data: CreateInput<W>): Promise<{ id: ID }>`**

Create a document within a transaction (auto-generated ID). Returns `{ id }` — a transaction cannot
read a document back after writing it, so there is no `returnDoc` option. **Not** on
`ReadOnlyTransactionalRepository`.

**`createWithIdInTransaction(tx: Transaction, id: ID, data: CreateInput<W>): Promise<{ id: ID }>`**

**Create-only** write under a caller-supplied ID within a transaction. Throws `ConflictError` if the
ID is taken, without retrying the callback. Only `beforeCreate` fires (after-hooks never run inside
a transaction). **Not** on `ReadOnlyTransactionalRepository`.

**`deleteInTransaction(tx: Transaction, id: ID, options?: { lastUpdateTime?: Timestamp }): Promise<void>`**

Delete a document within a transaction, optionally guarded by `lastUpdateTime`. The transactional
existence read runs first, so a missing document still throws `NotFoundError`. **Not** on
`ReadOnlyTransactionalRepository`.
