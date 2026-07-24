---
title: 'Per-Field Sentinel Approval'
description:
  'Write combinators, sentinelPolicy strict mode, and sharing write types with the front end.'
---

Use per-field write combinators so each field accepts only its declared type or an explicitly
approved `FieldValue` sentinel. As of v3 `sentinelPolicy: 'strict'` is the **default**.

## Why per-field approval

As of v3, `sentinelPolicy` defaults to **`'strict'`**: a plain field accepts no `FieldValue`
sentinel, and only sentinels a field's write combinator permits pass. Declare each writable-with-a-
sentinel field with a **write combinator** so a write must be either the field's declared type
**or** a specific approved sentinel.

The pre-v3 default, `'permissive'`, accepted **any** sentinel on **any** field and — worse — wrote
the **raw payload** verbatim when a sentinel-path parse failed, discarding Zod coercions/defaults
elsewhere. It remains available as an explicit opt-in migration shim
(`{ sentinelPolicy: 'permissive' }`), but strict + combinators is the recommended path.

## Write combinators

| Combinator            | Field accepts                                                 |
| --------------------- | ------------------------------------------------------------- |
| `zNumberWrite()`      | `number` or `FieldValue.increment()`                          |
| `zArrayWrite(elem)`   | `elem[]` or `FieldValue.arrayUnion()` / `arrayRemove()`       |
| `zDateWrite()`        | `Date` or `FieldValue.serverTimestamp()`                      |
| `withDelete(schema)`  | the wrapped type or `FieldValue.delete()`                     |
| `zSentinel(...kinds)` | a sentinel of one of the named kinds (compose with `z.union`) |

The typed write combinators `zNumberWrite()` / `zArrayWrite()` / `zDateWrite()` also accept
`{ allowDelete: true }` to additionally permit `FieldValue.delete()`. (`withDelete(schema)` already
permits it, and `zSentinel(...)` takes `'delete'` as one of its named kinds.)

Even when a field permits `FieldValue.delete()` (via `withDelete` or `{ allowDelete: true }`), a
`delete()` sentinel is **rejected on `create`, `bulkCreate`, and `upsert`** — clear a field with
`update()` / `patch()` instead. `increment`, `arrayUnion`, `arrayRemove`, and `serverTimestamp`
remain valid on create.

## Enabling strict mode

Declare a **read schema** with plain types and a **write overlay** (`writeSchema`) whose fields use
the combinators. Strict is the default, so no `sentinelPolicy` argument is needed (it is shown
explicitly below for clarity). Reads stay typed by the clean read schema while writes accept each
field's declared type or its approved sentinel with **no cast**. A plain field (no combinator)
accepts **no** sentinel under strict. Neither the `readSchema` nor the write overlay declares a
top-level `id` — the factory throws at construction if one is present, and the document name is the
sole source of `id`.

```typescript
import {
  FirestoreRepository,
  zNumberWrite,
  zArrayWrite,
  zSentinel,
} from '@reggieofarrell/firestore-orm';
import { FieldValue } from 'firebase-admin/firestore';
import { z } from 'zod';

// Clean read schema — the contract type, no sentinels.
const userRead = z.object({
  name: z.string().min(1),
  loginCount: z.number().int(),
  tags: z.array(z.string()),
  updatedAt: z.string(),
});

// Write overlay — each field declares which sentinel it accepts.
const userWrite = userRead.extend({
  name: z.string().min(1), // plain -> no sentinel allowed under 'strict'
  loginCount: zNumberWrite(), // number | increment
  tags: zArrayWrite(z.string()), // string[] | arrayUnion | arrayRemove
  updatedAt: z.union([z.string(), zSentinel('serverTimestamp')]), // string | serverTimestamp
});

const userRepo = FirestoreRepository.withSchema(db, 'users', userRead, {
  writeSchema: userWrite,
  sentinelPolicy: 'strict',
});

await userRepo.update('u1', { loginCount: FieldValue.increment(1) }); // ok, no cast
await userRepo.update('u1', { loginCount: FieldValue.arrayUnion('x') }); // throws ValidationError
await userRepo.update('u1', { name: FieldValue.serverTimestamp() }); // throws ValidationError
```

`sentinelPolicy` defaults to `'strict'` (the pre-v3 default was `'permissive'`); strict is the mode
that actually **enforces** which sentinel **kind** each field accepts, so only combinator-declared
sentinels pass. `'permissive'` remains available as an explicit opt-in migration shim — the
combinators are still useful there for documentation, but permissive accepts any sentinel on any
field; only `'strict'` enforces them.

## Cast-free combinator writes

When you supply a `writeSchema`, the write-input types are inferred from it, so combinator fields
accept their native values / sentinels with **no cast** while reads stay typed by `readSchema`.
Without a `writeSchema`, the write type equals the read type (a combinator value such as a
`Date`/sentinel would then need a cast).

```typescript
await userRepo.create({ name: 'Ada', loginCount: 0, tags: [], updatedAt: 't' }); // no id required
await userRepo.update('u1', { loginCount: FieldValue.increment(1) }); // no cast
await userRepo.update('u1', { tags: FieldValue.arrayUnion('x') }); // no cast
```

### What the write types catch (and don't)

Everything else is enforced at runtime under `'strict'`:

- ✅ Combinator native values / sentinels are accepted with no cast; `create` needs no `id`.
- ✅ `create` rejects wrong scalar types at compile time (e.g. a string in a number field).
- ⚠️ `update` is looser (Firestore's `PartialWithFieldValue`): it catches wrong primitives but not,
  for example, a raw number written into a `Date`-typed field.
- ⚠️ The sentinel **kind** is never compile-checked — Firestore's `WithFieldValue` accepts any
  `FieldValue` on any field, so `arrayUnion` into a `zNumberWrite()` field compiles and is rejected
  only at runtime under `'strict'`.

The `writeSchema` overlay affects **only** these write value types — `id` handling is unchanged: no
schema declares a top-level `id`, write payloads never contain one, and the document name is the
sole source of `id` (see
[Schema Validation](/firestore-orm/guides/concepts/schema-validation/#no-top-level-id)).
`subcollection` takes the same `writeSchema` option with identical inference. (Converters are not
inherited from the parent repo.)

## Sharing schema-derived types with a front-end

The read type comes from `readSchema` and the write type from the `writeSchema` overlay, so the two
concerns split cleanly across packages. Keep a **plain base schema** in shared code as the single
source of truth for your API-contract types, and apply combinators in a thin **server-side overlay**
— the combinators (and `firebase-admin`) never reach shared/browser code.

```typescript
// shared/user.schema.ts — importable anywhere; depends only on zod
export const userBase = z.object({
  name: z.string().min(1),
  loginCount: z.number().int(),
  tags: z.array(z.string()),
});
export type User = z.infer<typeof userBase>; // clean contract type: no sentinels

// server/user.repo.ts — combinators live here only, as the write overlay.
import { zNumberWrite, zArrayWrite } from '@reggieofarrell/firestore-orm';
const userWrite = userBase.extend({
  loginCount: zNumberWrite(),
  tags: zArrayWrite(z.string()),
});
const userRepo = FirestoreRepository.withSchema(db, 'users', userBase, {
  writeSchema: userWrite,
  sentinelPolicy: 'strict',
});

// Reads return the plain `User` (loginCount: number); writes accept the combinator types with no
// cast, and `create` does not require `id`:
await userRepo.create({ name: 'Ada', loginCount: 0, tags: [] });
await userRepo.update('u1', { loginCount: FieldValue.increment(1) });
```

Because `userWrite` extends `userBase`, neither the shared read schema nor the server-side write
overlay declares a top-level `id`; the repository overlays `doc.id` from the document name.
