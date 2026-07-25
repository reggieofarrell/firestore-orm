---
title: 'Exported Types'
description:
  'The types re-exported from the package entry point — FirestoreDocument, DataOf, FieldPaths,
  UpdateInput, SentinelPolicy, and more.'
---

Types re-exported from the package entry point (`@reggieofarrell/firestore-orm`). For the classes
these types describe, see [FirestoreRepository](/firestore-orm/reference/repository/) and
[FirestoreQueryBuilder](/firestore-orm/reference/query-builder/) (which also documents
`FirestoreCollectionGroup` and `FirestoreCollectionGroupQueryBuilder`); for the runtime helpers, see
[Helpers & Utilities](/firestore-orm/reference/helpers/).

- **`ID`** — `string` document-identifier alias.
- **`FirestoreDocument<T>`** — the flat read-result shape: `Omit<T, 'id'> & { readonly id: ID }`.
  Returned by every read (`getById`, `getAll`, query terminals, hook payloads, …).
- **`DataOf<R>`** — extracts a repository's read-data type (`Omit<T, 'id'>`) without spelling the
  generics.
- **`StoredDataOf<R>`** — extracts a repository's stored-data type (`Omit<S, 'id'>`).
- **`DocumentOf<R>`** — extracts a repository's document result type
  (`FirestoreDocument<DataOf<R>>`); name a returned document type without spelling the generics.
- **`CollectionGroupDocument<T>`** — the read-result shape of a
  [collection-group query](/firestore-orm/guides/working-with-data/queries/#collection-group-queries):
  `Omit<T, 'id' | 'path' | 'parentPath'>` plus a readonly `id`, the full document `path`
  (`'users/u1/posts/p1'`), and the containing collection's `parentPath` (`'users/u1/posts'`). All
  plain strings, so a result stays JSON-serializable — rebuild a reference with `db.doc(row.path)`.
  Ids are not unique across a group, so `path` is the identity that distinguishes two rows. Compose
  it with the extractors to name a row: `CollectionGroupDocument<DataOf<typeof postRepo>>`. Unlike
  `FirestoreDocument`, its `Omit` distributes over a union read model
  ([#54](https://github.com/reggieofarrell/firestore-orm/issues/54) fixes the same defect there).
- **`InvalidDocumentIdReason`** — machine-readable cause carried by `InvalidDocumentIdError` (the
  error class is documented in [Error Handling](/firestore-orm/reference/errors/)).
- **`HookEvent`** — union of supported lifecycle hook names.
- **`UpdateOptions`** — `{ merge?: boolean; returnDoc?: boolean }`.
- **`ReadConverter<T>`** — read-only converter: the `fromFirestore(snapshot) => T` mapper passed as
  `readConverter` (the repository builds the full `FirestoreDataConverter` internally). See
  [Read Converters](/firestore-orm/guides/concepts/read-converters/).
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
- **`QueryFilterFactory<S>`** — the callback argument of
  [`whereFilter(...)`](/firestore-orm/reference/query-builder/): schema-aware `where` / `whereId` /
  `and` / `or` builders that return an SDK `Filter`. `and()` and `or()` throw when called with no
  filters. `Filter` itself is **not** re-exported — import it from `firebase-admin/firestore`, as
  with `FieldPath` and `WhereFilterOp`. Useful for extracting a reusable typed predicate — annotate
  the shape with `StoredDataOf<typeof repo>`, which already excludes the synthetic `id`:
  `const mine = (f: QueryFilterFactory<StoredDataOf<typeof postRepo>>) => f.or(…)`. `S` is
  **invariant**: a predicate annotated with a different repository's shape (or one that still
  includes `id`) is a compile error rather than silently accepted.
- **`CollectionGroupFilterFactory<S>`** — the collection-group counterpart, handed to
  `collectionGroup().query().whereFilter(...)`. Identical to `QueryFilterFactory<S>` except that the
  document-name helper is `wherePath(op, fullPathOrRef)` rather than `whereId(op, id)`, because a
  collection-group query matches `documentId()` against the **full document path**. Same invariance
  rules.
- **`ReadOnlyTransactionalRepository<T>`** — type-level surface for `{ readOnly: true }` /
  `runReadOnlyAt` transaction callbacks. Membership is **pure or transaction-scoped only**:
  `getInTransaction`, `fromSnapshot`, `validate`, `id` / `newId`, `getCollectionPath`, and the
  `readSchema` / `schemas` accessors. Write helpers and non-transactional reads (`getById`,
  `getAll`, `query`) are absent from the type so they cannot bypass the transaction or `readTime`.
  See [Transactions](/firestore-orm/guides/working-with-data/transactions/).
- **`UpdateInput<T>`** — update payload type, `UpdateData<Omit<T, 'id'>>` (typed dot-notation
  paths).
- **`CreateInput<T>`** — create payload type, `WithFieldValue<Omit<T, 'id'>>`; `id` is not a member.
- **`CreateOutput<T>`** — parsed create output (`Omit<T, 'id'>`) that after-create hooks observe.
- **`Validator<Input, Output = Input>`** — validation contract produced by `makeValidator(...)`.
- **`RepositorySchemaSet`** — bundle of schemas attached to a repository: `read` / `create` /
  `update`, plus an optional `stored` carrying the effective at-rest shape (the supplied
  `storedSchema`, or the read schema when none was given). `stored` is what `collectionGroup()`
  inspects to reject a stored shape colliding with group identity; for the stored shape as a _type_,
  use `StoredDataOf<typeof repo>`.
- **`SentinelPolicy`** — `'permissive' | 'strict'` (the v3 default is `'strict'`).
- **`FieldValueKind`** — union of recognized Firestore sentinel kinds.

The package also exports runtime helpers — validation combinators, timestamp utilities, and
dot-notation utilities — documented on the [Helpers & Utilities](/firestore-orm/reference/helpers/)
page. The vector-search extension (`@reggieofarrell/firestore-orm/vector`) exports
`withVectorSearch`, `vectorEmbeddingSchema`, `VectorDistanceMeasure`, `isVectorFieldValue`, and
related constants — see [Vector Search](/firestore-orm/guides/advanced/vector-search/).
