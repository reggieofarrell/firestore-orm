---
title: 'Schema Validation'
description: 'Zod validation lifecycle, derived create/update schemas, and id handling.'
---

Validation runs automatically before every write, using a Zod schema you attach at construction.

Validation happens automatically before any write operation using Zod schemas. Attach a schema with
`FirestoreRepository.withSchema(...)` and the repository derives the write and update schemas it
enforces on `create`, `update`, and `patch`.

```typescript
const userSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  email: z.string().email(),
  age: z.number().int().positive().optional(),
});

const userRepo = FirestoreRepository.withSchema(db, 'users', userSchema);

try {
  await userRepo.create({
    name: '',
    email: 'not-an-email',
    age: -5,
  });
} catch (error) {
  if (error instanceof ValidationError) {
    console.log(error.issues);
    // [
    //   { path: ['name'], message: 'Too small: expected string to have >=1 characters' },
    //   { path: ['email'], message: 'Invalid email address' },
    //   { path: ['age'], message: 'Too small: expected number to be >0' }
    // ]
  }
}
```

The `message` text on each issue is produced by Zod, so the exact wording depends on your Zod
version (this package supports both Zod 3 and Zod 4) and any custom messages you pass to your schema
(e.g. `z.string().min(1, 'Name is required')`). The `path` array is what you should branch on.

## Required top-level `id`

Every schema you pass to `withSchema(...)` (and to a subcollection with a schema) **must** declare a
required top-level `id: z.string()`. The repository asserts this at construction and throws if the
`id` field is missing. This is the read shape — it does not force `id` onto write inputs.

## Validation behavior

- Include a required top-level `id` field in schemas passed to `withSchema(...)`.
- `create()` validates against an internal write schema derived from `schema.omit({ id: true })`.
- `update()` validates against an internal update schema derived from
  `schema.omit({ id: true }).partial()`.
- **Zod `.default(...)` values are applied on `create`, but never injected on `update`.** A partial
  update writes only the keys you actually provide — an omitted field that has a schema default is
  left untouched (its stored value is preserved, not silently reset to the default). This holds at
  every nesting level, so `update(id, { name })` never clobbers a defaulted sibling like `prefs`,
  and `update(id, { config: {} })` writes `{}` rather than re-injecting a nested `count` default.
  Defaults remain the right behavior on `create`, where every field is being written for the first
  time.
- Top-level `id` is ignored/stripped from `create`/`update`/`patch` payloads before validation and
  writes.
- `create()` therefore does **not** require `id` in its input type — the id is auto-generated (or,
  for `upsert`, taken from the explicit `id` argument); reads always include `id`.
- Only the document-level top-level `id` is stripped; nested IDs (for example `items[].id`) are
  treated as normal domain data.
- Write operations follow this sequence: `before*` hook -> validation -> Firestore write -> `after*`
  hook.
- Validation errors are thrown after `before*` hooks run and before any Firestore write occurs.
- Firestore `FieldValue` sentinels are supported in write payloads. By default
  (`sentinelPolicy: 'permissive'`) any sentinel is accepted on any field — sentinel-valued paths are
  skipped during schema validation while non-sentinel paths are still validated. To enforce which
  sentinels a field may receive, declare them with the per-field combinators and opt into
  `sentinelPolicy: 'strict'` (see
  [Per-Field Sentinel Approval](./field-value-sentinels/#per-field-sentinel-approval)).

> **Where `id` lives (and why a `writeSchema` overlay doesn't change it).** There are three separate
> `id` contexts, and it's easy to conflate them:
>
> - **In the schema** — a required top-level `id` (e.g. `id: z.string()`) is **required**; the
>   repository throws at construction otherwise. It describes the _read_ shape.
> - **On write inputs** (`create` / `update` / `upsert` / `patch`) — `id` is **never** required and
>   is always stripped. The document id comes from Firestore (auto-generated on `create`) or from
>   the method's `id` argument (`update(id, …)`, `upsert(id, …)`).
> - **On reads** — `id` is always present (results are typed `T & { id }`).
>
> A **`writeSchema` overlay** changes _only_ the write value types of non-`id` fields
> (`W = z.infer<writeSchema>`, enabling cast-free combinator writes). All three `id` rules above are
> identical whether or not a `writeSchema` is supplied — only `readSchema` must carry a required
> top-level `id`.

## Accessing derived schemas

The repository exposes the read schema you provided plus the two schemas it derives internally for
validation.

```typescript
const userRepo = FirestoreRepository.withSchema(db, 'users', userSchema);

// Canonical read schema (includes required id)
const readSchema = userRepo.schemas?.read;

// Internal write schemas used by repository validation
const createSchema = userRepo.schemas?.create; // userSchema without id
const updateSchema = userRepo.schemas?.update; // create schema made partial
```

`schemas.update` is the raw `.partial()` Zod schema, so parsing a payload through it **directly**
(`schemas.update.parse(...)`) still applies Zod defaults for omitted keys. The default-stripping
described above happens in the repository's `update`/`patch` path, not in this raw schema — prefer
the repository methods for writes.

## Validating reads (opt-in)

Reads are **compile-time casts**, not runtime validation — `getById`, query terminals,
`fromSnapshot`, and the rest return the Firestore payload (plus `id` overlay / `readConverter`)
without parsing through Zod. That keeps the default path fast and predictable.

When you need a runtime guarantee at a trust boundary, compose the explicit validators:

```typescript
// Throwing — returns the parsed value (Zod transforms/coercions apply)
const user = userRepo.validate(await userRepo.getByIdOrThrow(id));

// List — all-or-nothing (first bad doc throws ValidationError)
const users = userRepo.validate(await userRepo.getAll());

// Non-throwing — filter bad docs instead of failing the whole batch
const ok = userRepo
  .safeValidate(await userRepo.getAll())
  .filter(r => r.success)
  .map(r => r.data);
```

Both methods require a schema-configured repository (`withSchema`). Data-shape failures become
`ValidationError` (same as writes). Calling them without a schema throws a plain `Error` — that is a
config mistake, not a validation failure.

### What gets validated

Both methods run against the **converted** read shape — after any `readConverter` transform and the
`id` overlay, since that is what the read methods return. Write your read schema against the
converted types: if `createMillisTimestampConverter` exposes a stored `Timestamp` as a `number`,
declare that field `z.number()`, not a Timestamp type.

As with all Zod object parsing (and the write paths), keys **not** declared in the read schema are
**stripped** from the returned value. A stored document that has drifted to include fields outside
the schema comes back with those fields dropped — the return value is the parsed shape, not a copy
of the input.

To keep documents written under an older schema in the current shape on **every** read (not only
where you call `validate`), do the coercion in the `readConverter` — see
[Normalizing across schema changes](./core-concepts/#normalizing-across-schema-changes). With that
in place, `validate` / `safeValidate` become pure assertions that pre-migration documents still
pass.

For listeners / streams, validate inside the callback (`repo.validate(doc)` /
`repo.safeValidate(docs)`). See [Using with Firestore triggers](./triggers/) for the
`fromSnapshot` + `validate` pattern.
