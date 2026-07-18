---
title: 'Using with Firestore Triggers'
description: 'Map Cloud Function trigger snapshots to read types with fromSnapshot().'
---

Map the raw snapshot a trigger cloud function receives back to your repository's read type with
`fromSnapshot`.

Firestore trigger functions (`onDocumentCreated`, `onDocumentUpdated`, `onDocumentDeleted`, …) hand
your handler a **raw** `QueryDocumentSnapshot` — not the shape a repository read produces. Two
things make a bare `snapshot.data() as User` cast unsafe:

1. **The converter is not applied.** The Admin SDK only runs a `FirestoreDataConverter`'s
   `fromFirestore` for references built with `withConverter(...)`. A trigger snapshot is not one of
   those, so converter-transformed fields are still their raw stored type — e.g. a field that
   [`createMillisTimestampConverter`](./timestamps/) exposes as a `number` is still a Firestore
   `Timestamp` on the trigger snapshot.
2. **There is no `id`.** `snapshot.data()` never contains the document id; it lives on
   `snapshot.id`.

A cast silently mislabels both. See [Core Concepts → Firestore Converters](./core-concepts/) for the
underlying read semantics.

## `repo.fromSnapshot(snapshot)`

Import your already-configured repository and hand it the snapshot. `fromSnapshot` mirrors a normal
read: it applies the repository's `readConverter` (the `fromFirestore` mapper) when one is
configured, then overlays `id` from `snapshot.id`.

```typescript
fromSnapshot(snapshot: DocumentSnapshot): (T & { id: ID }) | null;
```

- Returns the **read model** `T & { id }` (never the write model `W`).
- Returns `null` when the snapshot does not exist.
- Does **no** Firestore I/O — it operates purely on the snapshot you pass in.

## Example (`firebase-functions` v2)

```typescript
import { onDocumentCreated, onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { userRepo } from './repositories'; // your configured FirestoreRepository<User>

export const onUserCreated = onDocumentCreated('users/{userId}', event => {
  const user = event.data && userRepo.fromSnapshot(event.data);
  if (!user) return;
  // `user` is a fully reconstructed `User & { id }` — converter applied, id overlaid.
});

export const onUserUpdated = onDocumentUpdated('users/{userId}', event => {
  const before = event.data?.before && userRepo.fromSnapshot(event.data.before);
  const after = event.data?.after && userRepo.fromSnapshot(event.data.after);
  if (!after) return;
  // Compare `before` and `after` as typed `User` values.
});
```

For `onDocumentUpdated` you get `event.data.before` and `event.data.after` (both snapshots); map
each with `fromSnapshot`.

## Validating at the boundary

Like every other read, `fromSnapshot` does **not** run schema validation — it reconstructs and
casts. A trigger is an external input boundary, so if you want a runtime guarantee that the stored
document still matches your schema, compose `validate` after a null guard:

```typescript
const mapped = event.data && userRepo.fromSnapshot(event.data);
if (!mapped) return;
const user = userRepo.validate(mapped); // throws ValidationError on mismatch
```

For a non-throwing check (or to filter bad docs from a list), use `safeValidate`:

```typescript
const result = userRepo.safeValidate(mapped);
if (!result.success) {
  console.error(result.error.issues);
  return;
}
// result.data is the parsed User & { id }
```

Both methods require a schema-configured repository (`withSchema`). Failures are normalized to
`ValidationError` — the same type write paths throw. See [Schema Validation](./schema-validation/).
