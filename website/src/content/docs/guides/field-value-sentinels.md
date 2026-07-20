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

Each combinator accepts `{ allowDelete: true }` to additionally permit `FieldValue.delete()`.

## Enabling strict mode

Declare a **read schema** with plain types and a **write overlay** (`writeSchema`) whose fields use
the combinators. Strict is the default, so no `sentinelPolicy` argument is needed (it is shown
explicitly below for clarity). Reads stay typed by the clean read schema while writes accept each
field's declared type or its approved sentinel with **no cast**. A plain field (no combinator)
accepts **no** sentinel under strict. The `readSchema` needs a required top-level `id: z.string()` —
the factory throws at construction otherwise; the write overlay need not include `id`.

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
  id: z.string(), // required top-level id
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

`sentinelPolicy` defaults to `'permissive'` and is fully backwards compatible; `'strict'` disables
the permissive escape hatch so only combinator-declared sentinels pass, and it is the mode that
actually **enforces** which sentinel **kind** each field accepts. The combinators are also useful in
`'permissive'` mode for documentation, but permissive still accepts any sentinel on any field — only
`'strict'` enforces them.

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

The `writeSchema` overlay affects **only** these write value types — `id` handling is unchanged: a
required `id` in the `readSchema`, never required on write inputs, and stripped from every write
payload (see [Schema Validation](./schema-validation/#schema-validation)). `subcollection` takes the
same `writeSchema` option with identical inference. (Converters are not inherited from the parent
repo.)

## Sharing schema-derived types with a front-end

The read type comes from `readSchema` and the write type from the `writeSchema` overlay, so the two
concerns split cleanly across packages. Keep a **plain base schema** in shared code as the single
source of truth for your API-contract types, and apply combinators in a thin **server-side overlay**
— the combinators (and `firebase-admin`) never reach shared/browser code.

```typescript
// shared/user.schema.ts — importable anywhere; depends only on zod
export const userBase = z.object({
  id: z.string(),
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

Because `userWrite` extends `userBase`, both the shared read schema and the server-side write
overlay carry the required top-level `id`, satisfying the factory's `id` requirement.
