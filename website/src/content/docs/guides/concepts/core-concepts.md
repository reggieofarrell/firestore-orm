---
title: 'Core Concepts'
description:
  'Repository pattern, the four repository generics, and delete behavior in FirestoreORM.'
---

The foundational building blocks of FirestoreORM: the per-collection repository, its four generic
types, and delete semantics.

FirestoreORM's core is a per-collection repository. This page covers the repository pattern and
delete behavior. The other foundational topics each have their own page:
[document identity](/firestore-orm/guides/concepts/document-identity/),
[schema validation](/firestore-orm/guides/concepts/schema-validation/),
[read converters](/firestore-orm/guides/concepts/read-converters/),
[field-value sentinels](/firestore-orm/guides/concepts/field-value-sentinels/),
[timestamps](/firestore-orm/guides/concepts/timestamps/),
[lifecycle hooks](/firestore-orm/guides/concepts/lifecycle-hooks/),
[queries](/firestore-orm/guides/working-with-data/queries/), and
[vector search](/firestore-orm/guides/advanced/vector-search/).

## Repository Pattern

The repository abstracts Firestore operations behind a clean, consistent API. Each collection gets
its own repository instance.

```typescript
// Initialize once, use everywhere
const userRepo = FirestoreRepository.withSchema(db, 'users', userSchema);
const orderRepo = FirestoreRepository.withSchema(db, 'orders', orderSchema);
const productRepo = new FirestoreRepository<Product>(db, 'products'); // Without validation
```

The `withSchema` factory attaches a Zod schema for runtime validation. Both the read and write types
are inferred from schema **values**: the read type is `z.output<readSchema>`, and the write type is
`z.input<writeSchema>` when you pass a `writeSchema` overlay (otherwise it equals the read type). Do
not pass an explicit read-type generic. No `readSchema` (`userSchema`, `orderSchema` above) may
declare a top-level `id` field — the factory throws at construction if one is present. The document
name is the sole source of `id`, and reads resolve to `FirestoreDocument<T>`. A `writeSchema` built
from the write combinators enables cast-free combinator writes. Construct a repository directly with
`new FirestoreRepository<Product>(db, 'products')` when you don't need validation. See
[schema validation](/firestore-orm/guides/concepts/schema-validation/) for the full contract.

To add domain helpers (`findByEmail`, `deactivate`, and so on), subclass `FirestoreRepository` or
wrap a `withSchema` instance — both are supported. See
[Custom repository methods](/firestore-orm/guides/advanced/patterns/#custom-repository-methods) for
the constraints (`withSchema` returns a plain repository; subclasses use the public API only).

The full constructor signature is
`new FirestoreRepository<T, W = T, S = T, WO = W>(db, collectionPath, validator?, parentPath?, readConverter?, schemas?, allowLegacyDatastoreIds?)`,
where `T` = `z.output<readSchema>` (read data), `W` = `z.input<writeSchema>` (write input), `S` =
`z.output<storedSchema>` (at-rest shape, the source of query field paths), and `WO` =
`z.output<writeSchema>` (parsed write data). There is no options, config, debug, or logger bag —
everything is passed through these positional arguments (plus the trailing options object the
`withSchema` and `subcollection` factories accept: `writeSchema`, `storedSchema`, `readConverter`,
`sentinelPolicy`, and `allowLegacyDatastoreIds` — `storedSchema` is required when `readConverter` is
set).

## Converters and schema drift

Reads can be customized with an optional **`readConverter`** — for example mapping a stored
`Timestamp` to a `Date` or a millisecond `number` on the way out. Converters are **read-only**: the
mapper runs on every read, the document `id` is overlaid afterward, and a `storedSchema` is required
whenever one is set. See [Read Converters](/firestore-orm/guides/concepts/read-converters/) for the
full contract.

Because the converter runs on every read, it is also the seam for normalizing documents written
under an older schema into the current shape — without a data migration. See
[Schema Evolution](/firestore-orm/guides/designing/schema-evolution/) for that pattern.

## Delete Behavior

Deletes are explicit hard deletes. Calling `delete()` removes the document from Firestore
immediately.

```typescript
await userRepo.delete('user-123');
```

A few details worth knowing:

- `delete(id)` throws `NotFoundError` if the document does not exist.
- Delete lifecycle hooks (`beforeDelete` / `afterDelete`) receive the full persisted document
  (`FirestoreDocument<T>`) at runtime, so a hook can inspect what is being removed.
- `bulkDelete(ids)` resolves to the count of documents that **actually existed** — not the length of
  the input array — so ids that were already absent are not counted.
