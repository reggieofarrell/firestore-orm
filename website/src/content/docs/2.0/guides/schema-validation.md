---
title: Schema Validation
description: Zod validation lifecycle, derived create/update schemas, and id handling.
slug: 2.0/guides/schema-validation
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

const userRepo = FirestoreRepository.withSchema<User>(db, 'users', userSchema);

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

* Include a required top-level `id` field in schemas passed to `withSchema(...)`.
* `create()` validates against an internal write schema derived from `schema.omit({ id: true })`.
* `update()` validates against an internal update schema derived from
  `schema.omit({ id: true }).partial()`.
* Top-level `id` is ignored/stripped from `create`/`update`/`patch` payloads before validation and
  writes.
* `create()` therefore does **not** require `id` in its input type — the id is auto-generated (or,
  for `upsert`, taken from the explicit `id` argument); reads always include `id`.
* Only the document-level top-level `id` is stripped; nested IDs (for example `items[].id`) are
  treated as normal domain data.
* Write operations follow this sequence: `before*` hook -> validation -> Firestore write -> `after*`
  hook.
* Validation errors are thrown after `before*` hooks run and before any Firestore write occurs.
* Firestore `FieldValue` sentinels are supported in write payloads. By default
  (`sentinelPolicy: 'permissive'`) any sentinel is accepted on any field — sentinel-valued paths are
  skipped during schema validation while non-sentinel paths are still validated. To enforce which
  sentinels a field may receive, declare them with the per-field combinators and opt into
  `sentinelPolicy: 'strict'` (see
  [Per-Field Sentinel Approval](/firestore-orm/2.0/guides/field-value-sentinels/)).

> **Where `id` lives (and why the curried form doesn't change it).** There are three separate `id`
> contexts, and it's easy to conflate them:
>
> * **In the schema** — a required top-level `id` (e.g. `id: z.string()`) is **required**; the
>   repository throws at construction otherwise. It describes the *read* shape.
> * **On write inputs** (`create` / `update` / `upsert` / `patch`) — `id` is **never** required and
>   is always stripped. The document id comes from Firestore (auto-generated on `create`) or from
>   the method's `id` argument (`update(id, …)`, `upsert(id, …)`).
> * **On reads** — `id` is always present (results are typed `T & { id }`).
>
> The **curried** form (`withSchema<T>()(…)`) changes *only* the write value types of non-`id`
> fields (`W = z.infer<schema>`, enabling cast-free combinator writes). All three `id` rules above
> are identical in the direct and curried forms.

## Accessing derived schemas

The repository exposes the read schema you provided plus the two schemas it derives internally for
validation.

```typescript
const userRepo = FirestoreRepository.withSchema<User>(db, 'users', userSchema);

// Canonical read schema (includes required id)
const readSchema = userRepo.schemas?.read;

// Internal write schemas used by repository validation
const createSchema = userRepo.schemas?.create; // userSchema without id
const updateSchema = userRepo.schemas?.update; // create schema made partial
```
