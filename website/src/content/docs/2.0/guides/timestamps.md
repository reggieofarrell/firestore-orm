---
title: Storing a Timestamp, reading a millisecond number
description: createMillisTimestampConverter and the write/read timestamp pattern.
slug: 2.0/guides/timestamps
---

Store Firestore `Timestamp`s on write but read and work with milliseconds-since-epoch `number`s in
application code.

A common pattern is to store a Firestore `Timestamp` but work with milliseconds-since-epoch
`number`s in application code. Define a plain **base schema** as the read shape (so `z.infer` gives
a clean, shareable type), then `.extend` the temporal field with `zDateWrite()` for write
validation, and convert `Timestamp -> number` on read with `createMillisTimestampConverter`:

```typescript
import { FieldValue } from 'firebase-admin/firestore';
import {
  FirestoreRepository,
  zDateWrite,
  createMillisTimestampConverter,
} from '@reggieofarrell/firestore-orm';
import { z } from 'zod';

// Base schema = the read shape. `happenedAt` reads as an ms number. This is zod-only, so its
// inferred type is a clean API-contract type you can share (e.g. with a front-end). The required
// top-level `id: z.string()` is mandatory — the factory throws at construction without it.
const eventBase = z.object({
  id: z.string(),
  name: z.string().min(1),
  happenedAt: z.number(), // ms since epoch on read
});
type EventDoc = z.infer<typeof eventBase>;

// Write overlay: swap the temporal field to accept a Date or serverTimestamp() (a raw number is
// rejected). Only write validation widens — the read type stays the plain `EventDoc`.
const eventWrite = eventBase.extend({
  happenedAt: zDateWrite(),
});

// The read converter recursively maps stored Timestamps to ms numbers and returns data WITHOUT
// `id` (the repository overlays the document id afterward); toFirestore is a pass-through.
const converter = createMillisTimestampConverter<EventDoc>();
```

Build the repository with the **curried** form so write inputs are inferred from `eventWrite` — a
`Date` / `serverTimestamp()` is then accepted with **no cast**, while reads still return `EventDoc`
(`happenedAt: number`):

```typescript
const events = FirestoreRepository.withSchema<EventDoc>()(db, 'events', eventWrite, converter);

await events.create({ name: 'launch', happenedAt: FieldValue.serverTimestamp() });
await events.update(id, { happenedAt: new Date() }); // no cast
const ev = await events.getById(id); // ev.happenedAt is a number (ms)
```

The **direct** form is equivalent at runtime but types write inputs by the read type, so a `Date`
needs a cast (a `FieldValue` such as `serverTimestamp()` does not — every field already accepts
one):

```typescript
const events = FirestoreRepository.withSchema<EventDoc>(db, 'events', eventWrite, converter);

await events.create({ name: 'launch', happenedAt: FieldValue.serverTimestamp() });
await events.update(id, { happenedAt: new Date() as unknown as number }); // cast required
```

Pass a `fields` array to convert only specific top-level fields (each recursively) and leave every
other Timestamp intact:

```typescript
createMillisTimestampConverter<EventDoc>(['happenedAt']);
```

Notes:

* Write a `Date` or `serverTimestamp()`, not a raw `number` — the Admin SDK stores both as a
  `Timestamp` on every write path (including `update()`). A `FirestoreDataConverter.toFirestore` is
  **not** invoked on any update path (`update`, `patch`, `bulkUpdate`, `bulkPatch`,
  `query().update`, `updateInTransaction`, `patchInTransaction`) — it runs only on create/set paths
  — so the converter deliberately does no write-side conversion.
* Prefer the **curried** `withSchema<EventDoc>()(...)`: it infers the write type from `eventWrite`,
  so a `Date` is accepted on `create`/`update` with no cast, while reads stay typed as `EventDoc`.
  The **direct** form types write inputs by the read type (`happenedAt: number`), so `zDateWrite()`
  only widens *runtime* validation there — a `FieldValue` such as `serverTimestamp()` is still
  accepted without a cast (`WithFieldValue` widens every field to `| FieldValue`), but a `Date`
  needs one. See [Per-Field Sentinel Approval](./field-value-sentinels/#per-field-sentinel-approval)
  for the full contract.

## Converter helpers

The main entry also exports the primitives the converter is built from:

| Export                                       | Purpose                                                                             |
| -------------------------------------------- | ----------------------------------------------------------------------------------- |
| `createMillisTimestampConverter<T>(fields?)` | Build a `FirestoreDataConverter` (recursive read conversion, pass-through write)    |
| `convertTimestampsToMillis<T>(data)`         | Recursively convert every `Timestamp` in a value to an ms `number` (returns a copy) |
| `convertTimestampToMillis(ts)`               | Convert a single `Timestamp` to an ms `number` (throws if not a `Timestamp`)        |
| `convertMillisToTimestamp(ms)`               | Convert an ms `number` to a `Timestamp`                                             |

`convertTimestampsToMillis` uses a structural `toMillis` duck-check and never references
`firebase-admin`, so it is safe to reuse in shared/browser code; non-`Timestamp` value types (a
`VectorValue`, `GeoPoint`, or `DocumentReference`) are left untouched.

## Working in `number` on both sides

The converter only handles the read direction (writes go through native `Date` /
`serverTimestamp()`). If you want application code to author `number`s on write too, convert in a
`beforeCreate` / `beforeUpdate` hook with `convertMillisToTimestamp` (before-hooks run on the
standard create/update write paths, ahead of validation) and widen the write schema to accept a
`Timestamp` at that field.

## Under the hood

`createMillisTimestampConverter()` is equivalent to a hand-written converter whose `fromFirestore`
maps stored Timestamps to ms and whose `toFirestore` is a pass-through:

```typescript
import { Timestamp, FirestoreDataConverter } from 'firebase-admin/firestore';

const eventConverter: FirestoreDataConverter<EventDoc> = {
  toFirestore: data => data as FirebaseFirestore.DocumentData, // pass-through
  fromFirestore: snap => {
    const data = snap.data();
    return {
      name: data.name,
      happenedAt: (data.happenedAt as Timestamp).toMillis(),
    } as EventDoc; // `id` is overlaid by the repository, so it is omitted here
  },
};
```
