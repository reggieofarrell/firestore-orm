---
title: Migrating from v2 to v3
description:
  Breaking changes and step-by-step migration from @reggieofarrell/firestore-orm 2.x to 3.x.
---

Upgrade guide for moving from `@reggieofarrell/firestore-orm` **2.x** to **3.x**.

This page covers only the v2 → v3 contract. If you are still on the older upstream package
(`@spacelabstech/firestoreorm` / 1.x), migrate to 2.x first — see the project
[CHANGELOG](https://github.com/reggieofarrell/firestore-orm/blob/main/CHANGELOG.md) entry for
`2.0.0`.

Use the version switcher in the docs header to compare against the archived **v2** docs while you
upgrade.

## Breaking changes

v3 tightens several public contracts. Review each section below; everything under
[Migration steps](#migration-steps) and [Recommended upgrades](#recommended-upgrades) is optional
cleanup.

### 1. Value-inferred `withSchema` / `subcollection`

Factories no longer accept an explicit read generic (`withSchema<User>(…)`) or a curried call
(`withSchema<User>()(…)`). Read and write types are inferred from schema **values**, and every
optional argument lives in a trailing options object.

| v2                                                  | v3                                                         |
| --------------------------------------------------- | ---------------------------------------------------------- |
| `withSchema<User>(db, col, schema)`                 | `withSchema(db, col, schema)`                              |
| `withSchema<User>()(db, col, writeSchema)`          | `withSchema(db, col, readSchema, { writeSchema })`         |
| Positional `converter`, `opts`                      | `{ readConverter?, writeSchema?, sentinelPolicy? }`        |
| Untyped `subcollection(parentId, name)`             | `new FirestoreRepository(db, fullPath)` (or pass a schema) |
| Curried path exposed write schema as `schemas.read` | `schemas.read` is always the plain read schema             |

Hand-written interfaces can no longer be passed as the factory generic — derive the type from the
schema: `type User = z.infer<typeof userSchema>` (keep a required top-level `id` on the **read**
schema).

### 2. Converters are read-only (`converter` → `readConverter`)

The old `converter` option accepted a full `FirestoreDataConverter<T>`. Only `fromFirestore` was
reliable on reads; `toFirestore` ran on some create-family writes and was skipped on updates.

In v3:

- The option is renamed **`readConverter`**.
- It accepts only a `ReadConverter<T>` — the `fromFirestore` mapper `(snapshot) => T`.
- `createMillisTimestampConverter()` returns that mapper (not a full converter).
- Any create-time write transform that lived in `toFirestore` must move to a `before*` hook.

### 3. Type-safe, validated dot-notation

Dot-notation is now first-class instead of a stringly-typed, runtime-only feature. Most code needs
no change — you can **delete the `as any` casts** you previously used on nested updates — but a few
contracts tightened:

- **Query field paths are typed.** `where`, `orderBy`, `select` (and the vector builder's `where` /
  `select`) accept `FieldPaths<T> | FieldPath` instead of an arbitrary `string`. Typos and unknown
  paths are now compile errors, and nested paths (`orderBy('address.city')`) are supported. For a
  genuinely dynamic field name, pass a `FieldPath` (`where(new FieldPath(name), '==', v)`) instead
  of a computed string.
- **`id` is no longer a writable update key**, and **`create`/`upsert` reject dot-notation keys** (a
  compile error, and a runtime error if forced with a cast — Firestore would create a field whose
  name literally contains a dot). Use a nested object on create.
- **Behavior fix (important):** in v2, explicit dot-notation update keys on a **schema-validated**
  repository were silently stripped and never written. In v3 they are validated and persisted; a bad
  leaf value or an unknown field path now throws `ValidationError` instead of silently doing
  nothing. If you relied on that no-op, audit those call sites.
- `query().update(...)` now returns the number of documents **actually written** (payloads that
  sanitized to empty are not counted), not the matched count.
- **`bulkPatch`'s `beforeBulkUpdate` hook now receives the raw (un-flattened) input**, matching
  single-document `patch`. In v2 it saw pre-flattened dot-notation keys. A hook that read
  `update.data['profile.verified']` should read `update.data.profile?.verified` (or handle both).

New type helpers `FieldPaths<T>` and `PathValue<T, P>` are exported from the package root.

### 4. `zod` peer floor raised to `^4.0.0`

The `zod` peer range is now `^4.0.0` (was `^3.25.0 || ^4.0.0`). If you are still on zod 3, upgrade
to zod 4 — see the [zod v4 migration guide](https://zod.dev/v4/changelog). No firestore-orm API
changes accompany this bump; the validator internals now target the v4 schema shapes only.

### 5. `create` / `bulkCreate` / `createInTransaction` return `{ id }` by default

These methods previously returned the created document cast to the read type, but never actually
read it back — so with a divergent read/write schema or a `readConverter`, the runtime value did not
match the promised read model. They now return only `{ id }` (or `{ id }[]`); pass
`{ returnDoc: true }` to `create`/`bulkCreate` to read the document back through the `readConverter`
and get the converted read model (matching `update`/`upsert`). `createInTransaction` returns
`{ id }` only (a transaction cannot read a document back after writing it).

```typescript
// v2: const user = await repo.create(input); user.name // full doc
// v3:
const { id } = await repo.create(input); // default: id only
const user = await repo.create(input, { returnDoc: true }); // converted read model
```

The repository also now rejects a read schema whose `id` field is optional, nullable, or transformed
to a non-string, since reads always overlay a concrete string id.

### 6. `sentinelPolicy` defaults to `'strict'`

The default flips from `'permissive'` to `'strict'`. Under permissive, a `FieldValue` sentinel on a
field whose schema did not explicitly allow it silently caused the **entire raw payload** to be
written, discarding every Zod coercion, default, and transform elsewhere. Under strict, only
sentinels a field's schema permits pass (declare them with the write combinators `zNumberWrite` /
`zArrayWrite` / `zDateWrite` / `withDelete` / `zSentinel`), and the parsed Zod output is always
returned. Pass `{ sentinelPolicy: 'permissive' }` to `withSchema`/`subcollection` to keep the old
behavior as a migration shim. See [Field-value sentinels](./field-value-sentinels/).

### 7. Empty update payloads are rejected

An update whose payload is empty after validation (e.g. every value `undefined`) previously skipped
the write and reported success — so a missing document looked "updated". `update`, `patch`,
`bulkUpdate`, `bulkPatch`, `updateInTransaction`, and `query().update()` now throw a
`ValidationError` for an empty patch. Provide at least one field, or use `delete()` to remove a
document. (A mixed payload still filters `undefined` leaves and writes the rest.)

### 8. `errorHandler` moved to the `firestore-orm/express` subpath

The Express middleware is no longer exported from the package root; import it from the optional
`@reggieofarrell/firestore-orm/express` subpath and install `express` (now an optional peer). This
keeps `express` out of the core type graph so consumers who never use the adapter can type-check
without `@types/express`. The `FirestoreIndexError` response is now `503` (was `404`).

```typescript
// v2: import { errorHandler } from '@reggieofarrell/firestore-orm';
// v3:
import { errorHandler } from '@reggieofarrell/firestore-orm/express';
```

### 9. Node 22+ and Firebase Admin 14

The engine floor is now Node.js **22** (18/20 are end-of-life). The `firebase-admin` peer range adds
`^14.0.0` (12/13 remain supported), and the TypeScript floor is **5.5** (required by zod 4). v3 also
ships a dual **ESM + CommonJS** build — CommonJS consumers can now `require()` the package (this is
additive; existing ESM `import`s are unchanged).

### 10. Type-only tightening (projection, aggregation)

These change only compile-time types (no runtime behavior):

- After `select(...)`, query reads return `DeepPartial<T> & { id }` — every property, including
  nested map properties, is optional, so a field you projected away (at any depth, e.g. an
  unselected sibling of `select('address.city')`) is a compile error to access without a guard.
  (`select()` also now returns a new builder — see
  [Query-builder behavior refinements](#query-builder-behavior-refinements) below.)
- `sum()` / `average()` accept only numeric field paths (including nested/dotted); `findByField` and
  its `getOneByField*` siblings accept typed dotted field paths.

Smaller hardening you are unlikely to hit: pagination inputs must be positive finite integers, bulk
operations reject duplicate ids, cursors are bound to their collection, and vector validation
rejects non-finite values.

### Behavior fix: Zod defaults are no longer injected on a partial `update()`

This is **not** a breaking API contract (no code change is required to compile) — it removes a
silent data-loss bug, so it is called out here separately from the three breaking contracts above.

In v2, a partial `update()` on a schema-validated repository re-applied every field's Zod
`.default(...)`, including for fields you did not mention. On a schema with, say,
`prefs: z.object({ … }).default({})`, calling `update(id, { name })` silently wrote `prefs: {}` and
**overwrote the stored `prefs` map** — data loss for a field the caller never touched. (This bit any
field with a default, and is especially easy to hit with the read-side `.default(...)` backfill
pattern recommended in [Core Concepts](./core-concepts/#normalizing-across-schema-changes).)

In v3, a partial update writes only the keys you actually provide, at every nesting level;
`update(id, { config: {} })` writes `{}` rather than re-injecting a nested `count` default. Defaults
still apply on `create`. No migration is needed — but if you were relying on a partial update to
re-apply a default, set that value explicitly in the update payload.

### Query-builder behavior refinements

A few smaller behavior changes you are unlikely to hit unless you use these patterns:

- **`select()` returns a new builder (immutable).** Fluent chains
  (`repo.query().where(…).select(…).get()`) are unaffected. Only code that called `select()` for its
  side effect on a **retained** builder reference must switch to the returned builder:

  ```typescript
  // Before: the original `q` was (unsoundly) projected in place.
  const q = repo.query();
  q.select('name');
  const rows = await q.get(); // now returns FULL documents (q was never projected)

  // After: use the builder select() returns.
  const projected = repo.query().select('name');
  const rows = await projected.get();
  ```

- **`select().onSnapshot()` now throws locally** — Firestore does not allow a real-time listener on
  a field-masked query. Listen without `select()` and project in your callback, or use `get()` /
  `stream()`.

- **`query().update({})` on a zero-match query now throws `ValidationError`** (it previously
  returned `0`). The empty-update contract is no longer data-dependent. A valid, non-empty payload
  against a zero-match query still returns `0`.

- **Vector `select()` + `distanceResultField`:** pass only stored fields to `select()`; do not list
  the computed distance field. `findNearest()` appends it and widens the mask automatically, and it
  appears in the result type.

## Migration steps

### Drop curry and explicit `<T>` on factories

**Before (v2):**

```typescript
type User = { id: string; name: string; email: string };

const userSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email(),
});

// Direct — writes typed as the read type
const userRepo = FirestoreRepository.withSchema<User>(db, 'users', userSchema);

// Curried — write type inferred from a write/combinator schema
const userRepoCurried = FirestoreRepository.withSchema<User>()(db, 'users', userWriteSchema);
```

**After (v3):**

```typescript
const userSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email(),
});

type User = z.infer<typeof userSchema>;

const userRepo = FirestoreRepository.withSchema(db, 'users', userSchema);

// Clean read schema + combinator write overlay
const userRepoStrict = FirestoreRepository.withSchema(db, 'users', userSchema, {
  writeSchema: userWriteSchema,
  sentinelPolicy: 'strict',
});
```

`withSchema<User>(…)` intentionally fails to compile in v3 (`User` is not a `ZodObject`).

### Move converter / options into the options object

**Before (v2):**

```typescript
FirestoreRepository.withSchema<User>(db, 'users', userSchema, converter, {
  sentinelPolicy: 'strict',
});

// Filler undefined when you only needed opts:
FirestoreRepository.withSchema<User>(db, 'users', userSchema, undefined, {
  sentinelPolicy: 'strict',
});
```

**After (v3):**

```typescript
import type { ReadConverter } from '@reggieofarrell/firestore-orm';

const userReadConverter: ReadConverter<User> = snap => ({ ...snap.data() }) as User;

FirestoreRepository.withSchema(db, 'users', userSchema, {
  readConverter: userReadConverter,
  sentinelPolicy: 'strict',
});

// Reuse an existing converter's read half:
FirestoreRepository.withSchema(db, 'users', userSchema, {
  readConverter: existingConverter.fromFirestore.bind(existingConverter),
});
```

### Relocate `toFirestore` write transforms into hooks

**Before (v2)** — `toFirestore` on create-family writes only:

```typescript
const converter: FirestoreDataConverter<User> = {
  fromFirestore: snap => ({ ...snap.data() }) as User,
  toFirestore: data => ({
    ...data,
    updatedAt: FieldValue.serverTimestamp(),
  }),
};
```

**After (v3)** — read mapper + hook:

```typescript
const userReadConverter: ReadConverter<User> = snap => ({ ...snap.data() }) as User;

const userRepo = FirestoreRepository.withSchema(db, 'users', userSchema, {
  readConverter: userReadConverter,
});

userRepo.addHook('beforeCreate', async data => ({
  ...data,
  updatedAt: FieldValue.serverTimestamp(),
}));

userRepo.addHook('beforeUpdate', async data => ({
  ...data,
  updatedAt: FieldValue.serverTimestamp(),
}));
```

`createMillisTimestampConverter()` is still a drop-in for `readConverter` — only its return type
narrowed. See [Timestamps ↔ Millis](./timestamps/).

### Fix untyped subcollections

**Before (v2):**

```typescript
const orders = userRepo.subcollection('user-123', 'orders');
```

**After (v3)** — pass a schema, or use the raw constructor:

```typescript
const orders = userRepo.subcollection('user-123', 'orders', orderSchema);

// Unvalidated (same pattern as a top-level raw repo):
const ordersRaw = new FirestoreRepository<Order>(db, 'users/user-123/orders');
```

## Recommended upgrades (non-breaking)

These APIs are additive in v3. Adopt them while you migrate; they are not required to compile.

### Prefer `validate` / `safeValidate` over `schemas.read.parse`

The old trigger workaround leaked a raw `ZodError`:

```typescript
// v2 workaround — prefer not to keep this
repo.schemas?.read.parse(repo.fromSnapshot(snap));
```

Use the repository validators instead:

```typescript
const mapped = event.data && repo.fromSnapshot(event.data);
if (!mapped) return;
const user = repo.validate(mapped); // ValidationError on mismatch

const results = repo.safeValidate(docs); // SafeResult<T>[] — filter failures
```

Details: [Schema Validation](./schema-validation/) and [Firestore Triggers](./triggers/).

## Checklist

- [ ] Drop `()` curry and explicit `<User>` (or similar) on `withSchema` / `subcollection`
- [ ] Derive read types with `z.infer<typeof schema>`; keep required top-level `id` on the read
      schema
- [ ] Move positional `converter` / `{ sentinelPolicy }` into
      `{ readConverter?, writeSchema?, sentinelPolicy? }`
- [ ] Rename `converter` → `readConverter`; pass only the `fromFirestore` mapper
- [ ] Move any `toFirestore` create-time logic into `beforeCreate` / `beforeUpdate` (etc.)
- [ ] Replace untyped `subcollection(parent, name)` with a schema or
      `new FirestoreRepository(db, path)`
- [ ] Prefer `repo.validate` / `safeValidate` over `schemas.read.parse(...)` at trust boundaries
- [ ] Run `tsc` / your typecheck — `withSchema<User>(…)` should fail intentionally

## Further reading

- [Core Concepts](./core-concepts/) — `readConverter`, repository construction
- [Schema Validation](./schema-validation/) — `writeSchema`, `validate` / `safeValidate`
- [Lifecycle Hooks](./lifecycle-hooks/) — write-time transforms
- [Subcollections](./subcollections/)
- Design records (in-repo):
  [ADR-0007](https://github.com/reggieofarrell/firestore-orm/blob/main/docs/adr/0007-retire-curried-schema-factories.md)
  (factories),
  [ADR-0008](https://github.com/reggieofarrell/firestore-orm/blob/main/docs/adr/0008-read-only-converters.md)
  (read-only converters),
  [ADR-0009](https://github.com/reggieofarrell/firestore-orm/blob/main/docs/adr/0009-explicit-read-validators.md)
  (explicit validators)
