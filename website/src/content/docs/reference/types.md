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
- **`FirestoreDocument<T>`** — the flat read-result shape. For a concrete `T`, equivalent to
  `Omit<T, 'id'> & { readonly id: ID }`; for unresolved generics it is a **distributive
  conditional** so union read models narrow correctly (ADR-0028). Returned by every read (`getById`,
  `getAll`, query terminals, hook payloads, …).
- **`DataOf<R>`** — extracts a repository's read-data type (`OmitId<T>`) without spelling the
  generics.
- **`StoredDataOf<R>`** — extracts a repository's stored-data type (`OmitId<S>`).
- **`DocumentOf<R>`** — extracts a repository's document result type
  (`FirestoreDocument<DataOf<R>>`); name a returned document type without spelling the generics.
- **`CollectionGroupDocument<T>`** — the read-result shape of a
  [collection-group query](/firestore-orm/guides/working-with-data/queries/#collection-group-queries):
  `Omit<T, 'id' | 'path' | 'parentPath'>` plus a readonly `id`, the full document `path`
  (`'users/u1/posts/p1'`), and the containing collection's `parentPath` (`'users/u1/posts'`). All
  plain strings, so a result stays JSON-serializable — rebuild a reference with `db.doc(row.path)`.
  Ids are not unique across a group, so `path` is the identity that distinguishes two rows. Compose
  it with the extractors to name a row: `CollectionGroupDocument<DataOf<typeof postRepo>>`. Both
  `FirestoreDocument` and `CollectionGroupDocument` distribute `Omit` over union read models
  (ADR-0028).
- **`DocumentMetadata`** — snapshot provenance paired with reads and detailed listeners: `ref`
  (live `DocumentReference` — not JSON-serializable), `path`, `parentPath`, `createTime`,
  `updateTime`, `readTime`. Delivered as a **sibling** of the document, never overlaid onto it.
- **`WithMetadata<D>`** — `{ doc: D; metadata: DocumentMetadata }`, returned by any read called with
  `{ withMetadata: true }`. `doc` stays JSON-serializable; `metadata.ref` does not.
- **`WriteMetadata`** — commit receipt `{ writeTime: Timestamp }` returned by a **non-transactional**
  write called with `{ withMetadata: true }`. This is the Admin SDK write-result timestamp, **not**
  `DocumentMetadata.updateTime` and not a JSON field on the document body. Absent from every
  `*InTransaction` helper.
- **`WriteResultWithMetadata<R>`** — `R & WriteMetadata` (for example `{ id, writeTime }`). Prefer
  this enrichment over a universal `{ result, metadata }` wrapper so default callers keep reading
  `.id`.
- **`DetailedDocumentChange<R>`** — one mapped `docChanges()` entry: `type`, `doc`, `metadata`,
  `oldIndex`, `newIndex`. For `type: 'removed'`, `doc` and `metadata` describe the document as it
  last was — branch on `type`, not on `exists`.
- **`DetailedQuerySnapshot<R>`** — detailed listener payload: `docs`, `changes`, `size`, `empty`,
  `readTime`.
- **`InvalidDocumentIdReason`** — machine-readable cause carried by `InvalidDocumentIdError` (the
  error class is documented in [Error Handling](/firestore-orm/reference/errors/)).
- **`HookEvent`** — union of supported lifecycle hook names.
- **`HookContext<E>`** — second argument to every lifecycle hook: `event`, `execution`
  (`'direct'` | `'transaction'`), `retryable`, and (on the transaction branch only) diagnostic
  `attempt: number | null`. See [Lifecycle Hooks](/firestore-orm/guides/concepts/lifecycle-hooks/).
- **`WriteOutcome`** — discriminated persistence outcome carried by `WriteOutcomeError` (see
  [Error Handling](/firestore-orm/reference/errors/)).
- **`UpdateOptions`** — `{ merge?: boolean; returnDoc?: boolean; withMetadata?: boolean;
  lastUpdateTime?: Timestamp }`. `returnDoc` and `withMetadata` are mutually exclusive.
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
  Declared literal keys beside a string index signature *with no explicit `id`* (for example
  `{ name: string } & Record<string, unknown>`) are preserved as typed paths; arbitrary dynamic map
  keys are not — use an SDK `FieldPath` for those. Nested intersections recover their declared
  children recursively. An explicit `id` combined with a string index remains unsupported (see
  issue [#82](https://github.com/reggieofarrell/firestore-orm/issues/82)).
- **`OmitId<S>`** — distributive synthetic-`id` removal for stored/read models. When a member
  explicitly declares a literal `id`, the helper omits it; otherwise it returns that member
  unchanged (so an intersection with `Record<string, unknown>` keeps both its declared keys and its
  value-position index signature). Use when annotating a reusable `QueryFilterFactory` predicate
  over a union model: `(f: QueryFilterFactory<OmitId<UnionStored>>) => …`. Prefer
  `StoredDataOf<typeof repo>` for repository-bound predicates. See ADR-0028.
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
- **`ReadOnlyTransactionalRepository<T, S = T>`** — type-level surface for `{ readOnly: true }` /
  `runReadOnlyAt` transaction callbacks. Membership is **pure or transaction-scoped only**:
  `getInTransaction`, `getManyInTransaction`, `fromSnapshot`, `validate`, `id` / `newId`,
  `getCollectionPath`, and the `readSchema` / `schemas` accessors. Write helpers and
  non-transactional reads (`getById`, `getMany`, `getAll`, `query`) are absent from the type so they
  cannot bypass the transaction or `readTime`. The optional second type parameter `S` is the
  **stored** model used to type `fieldMask` paths on `getManyInTransaction` (mirroring `select()` /
  `where()`); it defaults to `T` so existing one-argument uses keep compiling. See
  [Transactions](/firestore-orm/guides/working-with-data/transactions/).
- **`UpdateInput<T>`** — update payload type; for a concrete `T`, `UpdateData<Omit<T, 'id'>>` (typed
  dot-notation paths). Distributes over union write models (ADR-0028).
- **`CreateInput<T>`** — create payload type; for a concrete `T`, `WithFieldValue<Omit<T, 'id'>>`;
  `id` is not a member. Distributes over union write models, so each branch is writable and
  cross-branch payloads stay rejected (ADR-0028).
- **`CreateOutput<T>`** — parsed create output (`Omit<T, 'id'>` for a concrete `T`) that
  after-create hooks observe. Distributes over unions (ADR-0028).
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
