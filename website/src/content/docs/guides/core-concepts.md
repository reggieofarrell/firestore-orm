---
title: 'Core Concepts'
description: 'Repository pattern, Firestore converters, and delete behavior in FirestoreORM.'
---

The foundational building blocks of FirestoreORM: the per-collection repository, Firestore
converters for read/write serialization, and delete semantics.

FirestoreORM's core is a per-collection repository. This page covers the repository pattern,
Firestore converters, and delete behavior. The other foundational topics each have their own page:
[schema validation](./schema-validation/), [field-value sentinels](./field-value-sentinels/),
[timestamps](./timestamps/), [lifecycle hooks](./lifecycle-hooks/), [queries](./queries/), and
[vector search](./vector-search/).

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
[schema validation](./schema-validation/) for the full contract.

To add domain helpers (`findByEmail`, `deactivate`, and so on), subclass `FirestoreRepository` or
wrap a `withSchema` instance — both are supported. See
[Custom repository methods](./advanced-patterns/#custom-repository-methods) for the constraints
(`withSchema` returns a plain repository; subclasses use the public API only).

The full constructor signature is
`new FirestoreRepository<T, W = T, S = T, WO = W>(db, collectionPath, validator?, parentPath?, readConverter?, schemas?, allowLegacyDatastoreIds?)`,
where `T` = `z.output<readSchema>` (read data), `W` = `z.input<writeSchema>` (write input), `S` =
`z.output<storedSchema>` (at-rest shape, the source of query field paths), and `WO` =
`z.output<writeSchema>` (parsed write data). There is no options, config, debug, or logger bag —
everything is passed through these positional arguments (plus the trailing options object the
`withSchema` and `subcollection` factories accept: `writeSchema`, `storedSchema`, `readConverter`,
`sentinelPolicy`, and `allowLegacyDatastoreIds` — `storedSchema` is required when `readConverter` is
set).

## Firestore Converters

FirestoreORM supports custom **read** deserialization (e.g. `Timestamp -> number`/`Date`) through an
optional **`readConverter`**.

> **Converters are read-only.** A `readConverter` is just the `fromFirestore` half of a converter —
> a `(snapshot) => T` mapper (the `ReadConverter<T>` type). The repository builds the full
> `FirestoreDataConverter` internally (your mapper plus a pass-through `toFirestore`) and attaches
> it to the **read** ref only, so `fromFirestore` runs on **every** read while writes go through a
> **raw** ref — a `toFirestore` is never even expressible, let alone invoked. This removes a
> long-standing footgun: the Admin SDK already skipped `toFirestore` on `update()`, so relying on it
> was unreliable. For write-time normalization, use a `before*` hook (hooks run before validation on
> all write paths) — see [Lifecycle Hooks](./lifecycle-hooks/).

```typescript
import { z } from 'zod';
import { Timestamp } from 'firebase-admin/firestore';
import { FirestoreRepository, ReadConverter } from '@reggieofarrell/firestore-orm';

// Runs on every read: map the stored Timestamp back to a Date. Return data WITHOUT `id` — the
// repository overlays the document id after the mapper returns.
const userReadConverter: ReadConverter<User> = snapshot => {
  const data = snapshot.data();
  return { ...data, createdAt: (data.createdAt as Timestamp).toDate() } as User;
};

// The at-rest shape query field paths derive from — `createdAt` is stored as a Timestamp, not the
// Date the read model exposes. Required whenever a readConverter restructures fields.
const userStoredSchema = userSchema.extend({ createdAt: z.instanceof(Timestamp) });

// Write a Date/serverTimestamp() (stored as a Timestamp on every write path); read back a Date.
const userRepo = FirestoreRepository.withSchema(db, 'users', userSchema, {
  storedSchema: userStoredSchema,
  readConverter: userReadConverter,
});
```

Because the mapper receives only the stored document body, it must return data **without** an `id`
field; the repository reads the snapshot's document id and overlays it onto the result afterward.
This is why reads resolve to `FirestoreDocument<T>` (`Omit<T, 'id'> & { readonly id: ID }`) even
though the mapper never sets `id` itself. A raw snapshot from a trigger cloud function is **not**
converter-applied and has no `id` — use [`fromSnapshot`](./triggers/) to reconstruct the read shape
there.

For the common `Timestamp -> number` case, the built-in
[`createMillisTimestampConverter`](./timestamps/) returns exactly this mapper (recursive read
conversion), ready to pass as `readConverter`.

Converter behavior is instance-local by design:

- Parent repositories and subcollections do not share converters automatically.
- Pass a converter explicitly via `subcollection(..., { readConverter })` for each subcollection
  that needs converter behavior.

### Normalizing across schema changes

Firestore is schemaless, so documents written under an older schema linger unchanged. Because reads
are casts, a field you add to the schema later is _typed_ as present but is `undefined` at runtime
on pre-migration documents. The `readConverter` is the seam that fixes this: it runs on **every**
read, so normalize the raw body into the current schema shape there and every read comes back
current — without a data migration.

**Best practice:** treat the `readConverter` as the place to coerce a stored document into the
current schema shape. A targeted backfill is cheapest — spread defaults _before_ the stored data so
new fields fall back and existing values win:

```typescript
const userReadConverter: ReadConverter<User> = snapshot => {
  const data = snapshot.data();
  // `status` was added to the schema later; older docs lack it.
  return { status: 'active', ...data } as User;
};
```

For full coercion across every schema revision, parse the raw body through the read schema so
defaults backfill and types coerce on every read. Give evolving fields a `.default(...)` so
pre-migration documents parse cleanly:

```typescript
// userSchema gained: status: z.enum(['active', 'archived']).default('active')
const userReadConverter: ReadConverter<User> = snapshot =>
  userSchema.parse(snapshot.data()) as User;
```

Giving fields a `.default(...)` for read-side backfill is safe for writes: defaults are applied on
`create` but never injected on a partial `update`, so a later `update(id, { … })` that omits a
defaulted field leaves the stored value untouched (see
[Schema Validation](./schema-validation/#validation-behavior)).

This is heavier than the default cast (a full Zod parse on every read), so reserve it for
collections where drift is likely — it deliberately trades read speed for a self-healing read shape.
It composes with the built-in [`createMillisTimestampConverter`](./timestamps/): run the timestamp
mapper first, then parse. And because normalization already happened on the way out,
[`validate()` / `safeValidate()`](./schema-validation/) at a trust boundary become pure assertions
that pre-migration documents still pass.

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
