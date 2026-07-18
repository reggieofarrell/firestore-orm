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

v3 has **two** breaking contracts. Everything else in this guide is optional cleanup.

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
