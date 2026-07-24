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
[Migration steps](#migration-steps) and [Recommended upgrades](#recommended-upgrades-non-breaking)
is optional cleanup.

### 1. Virtual document identity — schemas no longer declare `id`

This is the defining v3 change. The Firestore **document name is the sole authority for `id`**.
Schemas describe the document's own data only and **must not declare a top-level `id`** — a read,
write, or stored schema with a top-level `id` is **rejected at construction** with a remedial error.

```typescript
// v2 — id declared in the schema
const userSchema = z.object({ id: z.string(), name: z.string(), email: z.string().email() });

// v3 — remove the top-level id; the document name is the id
const userSchema = z.object({ name: z.string(), email: z.string().email() });
type User = z.infer<typeof userSchema>; // read-data shape (no id)
```

If your v2 collections stored `id === name` (the common mirror pattern), the field becomes inert —
drop it from the schema now; the stored copy can be cleaned up later with an optional migration and
is harmless in the meantime.

What this changes:

- **Reads return `FirestoreDocument<T>`** (`Omit<T, 'id'> & { readonly id: ID }`), replacing the old
  `T & { id }`. The `id` is always overlaid from the document name, never from the document's own
  fields. `DataOf<R>`, `StoredDataOf<R>`, and `DocumentOf<R>` extract these types from a repository.
- **Write input is `z.input<writeSchema>`** (the `W` generic), the caller's pre-parse input — never
  `z.infer`, and never containing `id`. A `writeSchema` overlay changes only field write types.
- **Four repository generics:** `FirestoreRepository<T, W = T, S = T, WO = W>` — the new `S` (stored
  data, `z.output<storedSchema>`) is the source of query field paths, and `WO` is the parsed write
  output. Query field paths now derive from `S`, excluding the synthetic `id`.
- **Query by id with `whereId` / `orderById`.** `where('id', …)` and `orderBy('id')` are now compile
  errors (the synthetic id is not a stored field path). Use `whereId(op, value)` (scalar ops take a
  `string`; `in` / `not-in` take a `readonly string[]`) and `orderById(direction?)`, which query the
  document name natively.
- **Validated id boundaries.** Every id-taking method validates its id and rejects one containing
  `/`, `.`, `..`, a `__…__` reserved pattern, the empty string, or over 1500 bytes — throwing the
  new `InvalidDocumentIdError`. Use `repo.id(raw)` to validate an untrusted id at the boundary, and
  `repo.newId()` to mint a validated auto-id without writing. Reads echo the document name as `id`,
  never a caller-supplied path.
- **Legacy Datastore ids.** If you must address imported Datastore-mode numeric ids, opt in with
  `allowLegacyDatastoreIds: true` on `withSchema` / `raw` / `subcollection`.

### 2. Value-inferred `withSchema` / `subcollection`

Factories no longer accept an explicit read generic (`withSchema<User>(…)`) or a curried call
(`withSchema<User>()(…)`). Read and write types are inferred from schema **values**, and every
optional argument lives in a trailing options object.

| v2                                                  | v3                                                                                           |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `withSchema<User>(db, col, schema)`                 | `withSchema(db, col, schema)`                                                                |
| `withSchema<User>()(db, col, writeSchema)`          | `withSchema(db, col, readSchema, { writeSchema })`                                           |
| Positional `converter`, `opts`                      | `{ writeSchema?, storedSchema?, readConverter?, sentinelPolicy?, allowLegacyDatastoreIds? }` |
| Untyped `subcollection(parentId, name)`             | `new FirestoreRepository(db, fullPath)` (or pass a schema)                                   |
| Curried path exposed write schema as `schemas.read` | `schemas.read` is always the plain read schema                                               |

Hand-written interfaces can no longer be passed as the factory generic — derive the type from the
schema: `type User = z.infer<typeof userSchema>` (with **no** top-level `id` — see section 1). For
an unvalidated repository, prefer the new `FirestoreRepository.raw<User>(db, 'users', options?)`
static over the positional constructor.

### 3. Converters are read-only (`converter` → `readConverter`)

The old `converter` option accepted a full `FirestoreDataConverter<T>`. Only `fromFirestore` was
reliable on reads; `toFirestore` ran on some create-family writes and was skipped on updates.

In v3:

- The option is renamed **`readConverter`**.
- It accepts only a `ReadConverter<T>` — the `fromFirestore` mapper `(snapshot) => T`.
- **A `readConverter` now requires a `storedSchema`.** Because the converter changes the read shape,
  the at-rest schema that query field paths derive from must be supplied explicitly.
- `createMillisTimestampConverter()` returns that mapper (not a full converter).
- Any create-time write transform that lived in `toFirestore` must move to a `before*` hook.

### 4. Type-safe, validated dot-notation and query paths

Dot-notation is now first-class instead of a stringly-typed, runtime-only feature. Most code needs
no change — you can **delete the `as any` casts** you previously used on nested updates — but a few
contracts tightened:

- **Query field paths are typed** from the stored shape. `where`, `orderBy`, `select` (and the
  vector builder's `where` / `select`) accept `FieldPaths<Omit<S, 'id'>> | FieldPath` instead of an
  arbitrary `string`. Typos and unknown paths are now compile errors, and nested paths
  (`orderBy('address.city')`) are supported. For a genuinely dynamic field name, pass a `FieldPath`
  (`where(new FieldPath(name), '==', v)`) instead of a computed string. Querying the document id
  uses `whereId` / `orderById` (see section 1).
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

### 5. `zod` peer floor raised to `^4.0.0`

The `zod` peer range is now `^4.0.0` (was `^3.25.0 || ^4.0.0`). If you are still on zod 3, upgrade
to zod 4 — see the [zod v4 migration guide](https://zod.dev/v4/changelog). No firestore-orm API
changes accompany this bump; the validator internals now target the v4 schema shapes only.

### 6. `create` / `bulkCreate` / `createInTransaction` return `{ id }` by default

These methods previously returned the created document cast to the read type, but never actually
read it back — so with a divergent read/write schema or a `readConverter`, the runtime value did not
match the promised read model. They now return only `{ id }` (or `{ id }[]`); pass
`{ returnDoc: true }` to `create`/`bulkCreate` to read the document back through the `readConverter`
and get the converted `FirestoreDocument<T>` (matching `update`/`upsert`). `createInTransaction`
returns `{ id }` only (a transaction cannot read a document back after writing it).

```typescript
// v2: const user = await repo.create(input); user.name // full doc
// v3:
const { id } = await repo.create(input); // default: id only
const user = await repo.create(input, { returnDoc: true }); // FirestoreDocument<T>
```

### 7. `sentinelPolicy` defaults to `'strict'`

The default flips from `'permissive'` to `'strict'`. Under permissive, a `FieldValue` sentinel on a
field whose schema did not explicitly allow it silently caused the **entire raw payload** to be
written, discarding every Zod coercion, default, and transform elsewhere. Under strict, only
sentinels a field's schema permits pass (declare them with the write combinators `zNumberWrite` /
`zArrayWrite` / `zDateWrite` / `withDelete` / `zSentinel`), and the parsed Zod output is always
returned. Pass `{ sentinelPolicy: 'permissive' }` to `withSchema`/`subcollection` to keep the old
behavior as a migration shim. See
[Field-value sentinels](/firestore-orm/guides/concepts/field-value-sentinels/).

### 8. `FieldValue.delete()` is rejected on create / set / upsert

`FieldValue.delete()` clears a field, which is only meaningful on an update. v3 rejects it on every
create/set chokepoint — `create`, `bulkCreate`, `createInTransaction`, and `upsert` — scanning the
**parsed** write output, so a transform- or default-introduced delete is caught too. Use `update()`
or `patch()` to clear a field. The other sentinels (`increment`, `arrayUnion`, `arrayRemove`,
`serverTimestamp`) remain valid on create.

### 9. Aggregations: `totalCount` → `collectionCount`, and `average` returns `number | null`

- **`QueryBuilder.totalCount()` is renamed to `collectionCount()`.** The name now signals that it
  counts the whole base collection and ignores the builder's `where` clauses; `count()` stays the
  single query-aware count.
- **`average(field)` returns `number | null`** (was effectively `number`). It resolves to `null`
  when there are no numeric values to average, so "no data" stays distinct from a genuine average of
  `0`. `sum(field)` still returns `number` (`0` on no match).
- `distinctValues(field)` now drops only `undefined` and preserves a stored `null` as a distinct
  value.

### 10. Empty update payloads are rejected

An update whose payload is empty after validation (e.g. every value `undefined`) previously skipped
the write and reported success — so a missing document looked "updated". `update`, `patch`,
`bulkUpdate`, `bulkPatch`, `updateInTransaction`, and `query().update()` now throw a
`ValidationError` for an empty patch. Provide at least one field, or use `delete()` to remove a
document. (A mixed payload still filters `undefined` leaves and writes the rest.)

### 11. `errorHandler` moved to the `firestore-orm/express` subpath

The Express middleware is no longer exported from the package root; import it from the optional
`@reggieofarrell/firestore-orm/express` subpath and install `express` (now an optional peer). This
keeps `express` out of the core type graph so consumers who never use the adapter can type-check
without `@types/express`. The `FirestoreIndexError` response is now `503` (was `404`), and its body
**no longer includes the Firestore index-console URL** — that URL can disclose project/database and
index structure, so it is kept server-side on the caught error's `indexUrl` for logging only.

```typescript
// v2: import { errorHandler } from '@reggieofarrell/firestore-orm';
// v3:
import { errorHandler } from '@reggieofarrell/firestore-orm/express';
```

### 12. Node 22+ and Firebase Admin 14

The declared engine floor is now Node.js **22** (18/20 are end-of-life). That floor comes from
`firebase-admin` **14**, which itself requires Node >= 22 — the library's own code targets ES2020,
so if you stay on `firebase-admin` 12/13 it still runs on Node 18+ (just outside the
tested/supported window; `engines` is advisory, so npm warns rather than blocks). The
`firebase-admin` peer range adds `^14.0.0` (12/13 remain supported), and the TypeScript floor is
**5.5** (required by zod 4). v3 also ships a dual **ESM + CommonJS** build — CommonJS consumers can
now `require()` the package (this is additive; existing ESM `import`s are unchanged).

### 13. Vector search adds `vectorQuery()` (no longer overrides `query()`)

`withVectorSearch(repo)` used to replace `query()` with a restricted vector builder. In v3 it leaves
`query()` returning the normal `FirestoreQueryBuilder` and **adds** a `vectorQuery()` entry point.
Migrate `.query().findNearest(…)` to `.vectorQuery().findNearest(…)`. The object-form `findNearest`
requires `@google-cloud/firestore >= 7.10` (guaranteed by `firebase-admin >= 13`), and
`vectorEmbeddingSchema` now enforces finite / exact / maximum dimensions on native
`FieldValue.vector()` values too. See
[Vector search](/firestore-orm/guides/advanced/vector-search/).

### 14. Type-only tightening (projection, aggregation)

These change only compile-time types (no runtime behavior):

- After `select(...)`, query reads return `FirestoreDocument<DeepPartial<T>>` — every data property,
  including nested map properties, is optional, so a field you projected away (at any depth, e.g. an
  unselected sibling of `select('address.city')`) is a compile error to access without a guard.
  (`select()` also now returns a new builder — see
  [Query-builder behavior refinements](#query-builder-behavior-refinements) below.)
- `findByField` and its `getOneByField*` siblings accept typed stored field paths and take
  `value: unknown`.

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
pattern recommended in
[Core Concepts](/firestore-orm/guides/designing/schema-evolution/#normalizing-across-schema-changes).)

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
  // No top-level `id` — the document name is the id (see breaking change #1).
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
  storedSchema: userStoredSchema, // required whenever readConverter is set (the at-rest shape)
  sentinelPolicy: 'strict',
});

// Reuse an existing converter's read half:
FirestoreRepository.withSchema(db, 'users', userSchema, {
  readConverter: existingConverter.fromFirestore.bind(existingConverter),
  storedSchema: userStoredSchema,
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
  storedSchema: userStoredSchema, // required whenever readConverter is set
});

// v3 before-hooks MUTATE the payload in place and return void (they do not return a new object).
userRepo.on('beforeCreate', async data => {
  data.updatedAt = FieldValue.serverTimestamp();
});

userRepo.on('beforeUpdate', async data => {
  data.updatedAt = FieldValue.serverTimestamp();
});
```

`createMillisTimestampConverter()` is still a drop-in for `readConverter` — only its return type
narrowed. See [Timestamps ↔ Millis](/firestore-orm/guides/concepts/timestamps/).

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

Details: [Schema Validation](/firestore-orm/guides/concepts/schema-validation/) and
[Firestore Triggers](/firestore-orm/guides/integrations/cloud-functions/).

## Checklist

- [ ] **Remove the top-level `id` from every read / write / stored schema** — it is now rejected at
      construction; the document name is the id, overlaid on reads as `FirestoreDocument<T>`
- [ ] Replace `where('id', …)` / `orderBy('id')` with `whereId(op, value)` / `orderById(direction?)`
- [ ] Validate untrusted ids with `repo.id(raw)` (catches `InvalidDocumentIdError`); use
      `repo.newId()` for an id you need before writing
- [ ] Drop `()` curry and explicit `<User>` (or similar) on `withSchema` / `subcollection`; prefer
      `FirestoreRepository.raw<User>(…)` for an unvalidated repository
- [ ] Derive read types with `z.infer<typeof schema>` (no top-level `id`); write input is
      `z.input<writeSchema>`
- [ ] Move positional `converter` / `{ sentinelPolicy }` into
      `{ writeSchema?, storedSchema?, readConverter?, sentinelPolicy?, allowLegacyDatastoreIds? }`
- [ ] Rename `converter` → `readConverter`; pass only the `fromFirestore` mapper, and add the now-
      required `storedSchema`
- [ ] Convert `addHook(event, fn)` to `repo.on(event, fn)`; make before-hooks **mutate** the payload
      in place (no return value)
- [ ] Move any `toFirestore` create-time logic into `beforeCreate` / `beforeUpdate` (etc.)
- [ ] Capture `create` / `bulkCreate` results as `{ id }` (or pass `{ returnDoc: true }`); rename
      `totalCount()` → `collectionCount()`; handle `average()` returning `null`
- [ ] Replace `FieldValue.delete()` on `create` / `upsert` with `update()` / `patch()`
- [ ] Migrate `withVectorSearch(repo).query().findNearest(…)` to `.vectorQuery().findNearest(…)`
- [ ] Replace untyped `subcollection(parent, name)` with a schema or
      `new FirestoreRepository(db, path)`
- [ ] Prefer `repo.validate` / `safeValidate` over `schemas.read.parse(...)` at trust boundaries
- [ ] Run `tsc` / your typecheck — `withSchema<User>(…)` should fail intentionally

## Further reading

- [Core Concepts](/firestore-orm/guides/concepts/core-concepts/) — `readConverter`, repository
  construction
- [Schema Validation](/firestore-orm/guides/concepts/schema-validation/) — `writeSchema`, `validate`
  / `safeValidate`
- [Lifecycle Hooks](/firestore-orm/guides/concepts/lifecycle-hooks/) — write-time transforms
- [Subcollections](/firestore-orm/guides/working-with-data/subcollections/)
- Design records (in-repo):
  [ADR-0007](https://github.com/reggieofarrell/firestore-orm/blob/main/docs/adr/0007-retire-curried-schema-factories.md)
  (factories),
  [ADR-0008](https://github.com/reggieofarrell/firestore-orm/blob/main/docs/adr/0008-read-only-converters.md)
  (read-only converters),
  [ADR-0009](https://github.com/reggieofarrell/firestore-orm/blob/main/docs/adr/0009-explicit-read-validators.md)
  (explicit validators)
