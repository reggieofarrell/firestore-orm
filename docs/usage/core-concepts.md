# Core Concepts

The foundational building blocks of FirestoreORM: the per-collection repository, Firestore
converters for read/write serialization, and delete semantics.

[← Documentation index](./README.md) · [Project README](../../README.md)

FirestoreORM's core is a per-collection repository. This page covers the repository pattern,
Firestore converters, and delete behavior. The other foundational topics each have their own page:
[schema validation](./schema-validation.md), [field-value sentinels](./field-value-sentinels.md),
[timestamps](./timestamps.md), [lifecycle hooks](./lifecycle-hooks.md), [queries](./queries.md), and
[vector search](./vector-search.md).

## Repository Pattern

The repository abstracts Firestore operations behind a clean, consistent API. Each collection gets
its own repository instance.

```typescript
// Initialize once, use everywhere
const userRepo = FirestoreRepository.withSchema<User>(db, 'users', userSchema);
const orderRepo = FirestoreRepository.withSchema<Order>(db, 'orders', orderSchema);
const productRepo = new FirestoreRepository<Product>(db, 'products'); // Without validation
```

The `withSchema` factory attaches a Zod schema for runtime validation. Each schema it receives
(`userSchema`, `orderSchema` above) **must** declare a required top-level `id: z.string()` — the
factory throws at construction if it is missing. `withSchema` has two forms: a direct form,
`withSchema<User>(db, 'users', userSchema)`, which types writes by the read type, and a curried
form, `withSchema<User>()(db, 'users', userSchema)`, which infers the write type from the schema and
enables cast-free combinator writes. Construct a repository directly with
`new FirestoreRepository<Product>(db, 'products')` when you don't need validation. See
[schema validation](./schema-validation.md) for the full contract.

The full constructor signature is
`new FirestoreRepository<T, W>(db, collectionPath, validator?, parentPath?, converter?, schemas?)`.
There is no options, config, debug, or logger bag — everything is passed through these positional
arguments (plus the small `opts` object the `withSchema` and `subcollection` factories accept, whose
only field is `sentinelPolicy`).

## Firestore Converters

FirestoreORM supports Firestore `withConverter(...)` through optional repository converter arguments
— mainly for custom **read** deserialization (e.g. `Timestamp -> number`/`Date`).

> **`toFirestore` runs on create-family writes only — do not rely on it for write conversion.** The
> Admin SDK invokes a converter's `toFirestore` on `add`/`set` (`create`, `bulkCreate`, `upsert`
> when creating, `createInTransaction`) but **not** on `update()` — so it is **skipped** by
> `update`, `patch`, `bulkUpdate`, `bulkPatch`, `upsert` (when updating), `updateInTransaction` /
> `patchInTransaction`, and `query().update()`. `fromFirestore`, by contrast, runs on **every**
> read. So keep `toFirestore` a pass-through and put read transforms in `fromFirestore`; for
> write-time normalization that must apply on every path, use a `before*` hook (hooks run before
> validation on all write paths) — see [Lifecycle Hooks](./lifecycle-hooks.md).

```typescript
import { Timestamp, FirestoreDataConverter } from 'firebase-admin/firestore';

const userConverter: FirestoreDataConverter<User> = {
  // Pass-through. Do NOT convert here — the Admin SDK skips toFirestore on update().
  toFirestore: user => user as FirebaseFirestore.DocumentData,
  // Runs on every read: map the stored Timestamp back to a Date. Return data WITHOUT `id` — the
  // repository overlays the document id after fromFirestore returns.
  fromFirestore: snapshot => {
    const data = snapshot.data();
    return { ...data, createdAt: (data.createdAt as Timestamp).toDate() } as User;
  },
};

// Write a Date/serverTimestamp() (stored as a Timestamp on every write path); read back a Date.
const userRepo = FirestoreRepository.withSchema<User>(db, 'users', userSchema, userConverter);
```

Because `fromFirestore` receives only the stored document body, it must return data **without** an
`id` field; the repository reads the snapshot's document id and overlays it onto the result after
the converter runs. This is why reads resolve to `T & { id }` even though the converter never sets
`id` itself. A raw snapshot from a trigger cloud function is **not** converter-applied and has no
`id` — use [`fromSnapshot`](./triggers.md) to reconstruct the read shape there.

For the common `Timestamp -> number` case, the built-in
[`createMillisTimestampConverter`](./timestamps.md) packages exactly this shape (recursive read
conversion + pass-through write).

Converter behavior is instance-local by design:

- Parent repositories and subcollections do not share converters automatically.
- Pass a converter explicitly to each `subcollection(...)` call that needs converter behavior.

## Delete Behavior

Deletes are explicit hard deletes. Calling `delete()` removes the document from Firestore
immediately.

```typescript
await userRepo.delete('user-123');
```

A few details worth knowing:

- `delete(id)` throws `NotFoundError` if the document does not exist.
- Delete lifecycle hooks (`beforeDelete` / `afterDelete`) receive the full persisted document
  (`{ ...data, id }`) at runtime, so a hook can inspect what is being removed.
- `bulkDelete(ids)` resolves to the count of documents that **actually existed** — not the length of
  the input array — so ids that were already absent are not counted.
