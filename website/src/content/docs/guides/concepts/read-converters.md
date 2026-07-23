---
title: 'Read Converters'
description:
  'The read-only readConverter contract — fromFirestore-only mapping, the required storedSchema, and
  the id overlay.'
---

FirestoreORM supports custom **read** deserialization (e.g. `Timestamp -> number` / `Date`) through
an optional **`readConverter`**. This page is the canonical reference for the converter contract —
other guides link here rather than restating it.

## Converters are read-only

A `readConverter` is just the `fromFirestore` half of a converter — a `(snapshot) => T` mapper (the
`ReadConverter<T>` type). The repository builds the full `FirestoreDataConverter` internally (your
mapper plus a pass-through `toFirestore`) and attaches it to the **read** ref only, so
`fromFirestore` runs on **every** read while writes go through a **raw** ref — a `toFirestore` is
never even expressible, let alone invoked.

This removes a long-standing footgun: the Admin SDK already skipped `toFirestore` on `update()`, so
relying on it was unreliable. For write-time normalization, use a `before*` hook (hooks run before
validation on all write paths) — see
[Lifecycle Hooks](/firestore-orm/guides/concepts/lifecycle-hooks/).

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

## `storedSchema` is required with a converter

When a `readConverter` is supplied, `storedSchema` is **required**. The converter changes the read
shape (`createdAt` reads as a `Date`, but is stored as a `Timestamp`), so query field paths — which
must reflect the **at-rest** shape `S` — need an explicit stored schema to derive from. Without a
converter, the stored shape defaults to the read shape.

## The id overlay

Because the mapper receives only the stored document body, it must return data **without** an `id`
field; the repository reads the snapshot's document id and overlays it onto the result afterward.
This is why reads resolve to `FirestoreDocument<T>` (`Omit<T, 'id'> & { readonly id: ID }`) even
though the mapper never sets `id` itself — see
[Document Identity](/firestore-orm/guides/concepts/document-identity/). A raw snapshot from a
trigger cloud function is **not** converter-applied and has no `id`; use
[`fromSnapshot`](/firestore-orm/guides/integrations/cloud-functions/) to reconstruct the read shape
there.

For the common `Timestamp -> number` case, the built-in
[`createMillisTimestampConverter`](/firestore-orm/guides/concepts/timestamps/) returns exactly this
mapper (recursive read conversion), ready to pass as `readConverter`.

## Converters are instance-local

Converter behavior is instance-local by design:

- Parent repositories and subcollections do not share converters automatically.
- Pass a converter explicitly via `subcollection(..., { readConverter })` for each subcollection
  that needs converter behavior — see
  [Subcollections](/firestore-orm/guides/working-with-data/subcollections/).

## Normalizing across schema changes

Because a `readConverter` runs on every read, it is also the seam for coercing documents written
under an older schema into the current shape — without a data migration. See
[Schema Evolution](/firestore-orm/guides/designing/schema-evolution/) for that pattern. The
`ReadConverter<T>` type is listed under [Exported Types](/firestore-orm/reference/types/).
