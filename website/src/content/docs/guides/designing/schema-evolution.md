---
title: 'Schema Evolution'
description:
  'Evolve a schema over time without a data migration — read-side normalization through the
  readConverter, and how defaults behave on read vs write.'
---

Firestore is schemaless, so documents written under an older schema linger unchanged. This page
covers how to evolve a schema safely and keep reads returning the current shape — without a data
migration.

## Why documents drift

Because reads are casts, a field you add to the schema later is _typed_ as present but is
`undefined` at runtime on pre-migration documents. Rewriting every stored document is expensive and
often unnecessary. Instead, normalize on read.

## Normalizing across schema changes

The [`readConverter`](/firestore-orm/guides/concepts/read-converters/) is the seam that fixes drift:
it runs on **every** read, so normalize the raw body into the current schema shape there and every
read comes back current — without a data migration.

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

## Defaults on read vs write

Giving fields a `.default(...)` for read-side backfill is safe for writes: defaults are applied on
`create` but **never** injected on a partial `update`, so a later `update(id, { … })` that omits a
defaulted field leaves the stored value untouched (see
[Schema Validation](/firestore-orm/guides/concepts/schema-validation/#validation-behavior)).

## Cost and composition

Full-parse normalization is heavier than the default cast (a full Zod parse on every read), so
reserve it for collections where drift is likely — it deliberately trades read speed for a
self-healing read shape. It composes with the built-in
[`createMillisTimestampConverter`](/firestore-orm/guides/concepts/timestamps/): run the timestamp
mapper first, then parse. And because normalization already happened on the way out,
[`validate()` / `safeValidate()`](/firestore-orm/guides/concepts/schema-validation/) at a trust
boundary become pure assertions that pre-migration documents still pass.
