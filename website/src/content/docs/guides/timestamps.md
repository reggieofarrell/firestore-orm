---
title: 'Storing a Timestamp, reading a millisecond number'
description: 'createMillisTimestampConverter and the write/read timestamp pattern.'
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

Build the repository with `eventBase` as the read schema and `eventWrite` as the `writeSchema`
overlay — a `Date` / `serverTimestamp()` is then accepted with **no cast**, while reads still return
`EventDoc` (`happenedAt: number`):

```typescript
const events = FirestoreRepository.withSchema(db, 'events', eventBase, {
  writeSchema: eventWrite,
  converter,
});

await events.create({ name: 'launch', happenedAt: FieldValue.serverTimestamp() });
await events.update(id, { happenedAt: new Date() }); // no cast
const ev = await events.getById(id); // ev.happenedAt is a number (ms)
```

Without a `writeSchema` overlay the write type equals the read type (`happenedAt: number`), so a
`Date` would need a cast (a `FieldValue` such as `serverTimestamp()` would not — `WithFieldValue`
widens every field to `| FieldValue`).

Pass a `fields` array to convert only specific top-level fields (each recursively) and leave every
other Timestamp intact:

```typescript
createMillisTimestampConverter<EventDoc>(['happenedAt']);
```

Notes:

- Write a `Date` or `serverTimestamp()`, not a raw `number` — the Admin SDK stores both as a
  `Timestamp` on every write path (including `update()`). A `FirestoreDataConverter.toFirestore` is
  **not** invoked on any update path (`update`, `patch`, `bulkUpdate`, `bulkPatch`,
  `query().update`, `updateInTransaction`, `patchInTransaction`) — it runs only on create/set paths
  — so the converter deliberately does no write-side conversion.
- Pass the combinator schema as the `writeSchema` overlay
  (`withSchema(db, 'events', eventBase, { writeSchema: eventWrite, converter })`): it infers the
  write type from `eventWrite`, so a `Date` is accepted on `create`/`update` with no cast, while
  reads stay typed as `EventDoc`. Without an overlay, write inputs are typed by the read type
  (`happenedAt: number`), so `zDateWrite()` only widens _runtime_ validation — a `FieldValue` such
  as `serverTimestamp()` is still accepted without a cast (`WithFieldValue` widens every field to
  `| FieldValue`), but a `Date` needs one. See
  [Per-Field Sentinel Approval](./field-value-sentinels/#per-field-sentinel-approval) for the full
  contract.

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
