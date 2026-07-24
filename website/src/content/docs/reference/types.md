---
title: 'Exported Types'
description:
  'The types re-exported from the package entry point — FirestoreDocument, DataOf, FieldPaths,
  UpdateInput, SentinelPolicy, and more.'
---

Types re-exported from the package entry point (`@reggieofarrell/firestore-orm`). For the classes
these types describe, see [FirestoreRepository](/firestore-orm/reference/repository/) and
[FirestoreQueryBuilder](/firestore-orm/reference/query-builder/); for the runtime helpers, see
[Helpers & Utilities](/firestore-orm/reference/helpers/).

- **`ID`** — `string` document-identifier alias.
- **`FirestoreDocument<T>`** — the flat read-result shape: `Omit<T, 'id'> & { readonly id: ID }`.
  Returned by every read (`getById`, `getAll`, query terminals, hook payloads, …).
- **`DataOf<R>`** — extracts a repository's read-data type (`Omit<T, 'id'>`) without spelling the
  generics.
- **`StoredDataOf<R>`** — extracts a repository's stored-data type (`Omit<S, 'id'>`).
- **`DocumentOf<R>`** — extracts a repository's document result type
  (`FirestoreDocument<DataOf<R>>`); name a returned document type without spelling the generics.
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
- **`UpdateInput<T>`** — update payload type, `UpdateData<Omit<T, 'id'>>` (typed dot-notation
  paths).
- **`CreateInput<T>`** — create payload type, `WithFieldValue<Omit<T, 'id'>>`; `id` is not a member.
- **`CreateOutput<T>`** — parsed create output (`Omit<T, 'id'>`) that after-create hooks observe.
- **`Validator<Input, Output = Input>`** — validation contract produced by `makeValidator(...)`.
- **`RepositorySchemaSet`** — bundle of read / create / update schemas attached to a repository.
- **`SentinelPolicy`** — `'permissive' | 'strict'` (the v3 default is `'strict'`).
- **`FieldValueKind`** — union of recognized Firestore sentinel kinds.

The package also exports runtime helpers — validation combinators, timestamp utilities, and
dot-notation utilities — documented on the [Helpers & Utilities](/firestore-orm/reference/helpers/)
page. The vector-search extension (`@reggieofarrell/firestore-orm/vector`) exports
`withVectorSearch`, `vectorEmbeddingSchema`, `VectorDistanceMeasure`, `isVectorFieldValue`, and
related constants — see [Vector Search](/firestore-orm/guides/advanced/vector-search/).
