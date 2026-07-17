# ADR-0003: `Timestamp ↔ millis` converter helper

- **Status:** Accepted (implemented on branch `feat/timestamp-millis-converter`; pending
  merge/release)
- **Date:** 2026-07-17
- **Deciders:** Reggie O'Farrell
- **Related:** Fast-follow to [ADR-0002](0002-per-field-sentinel-write-validation.md) (which shipped
  `zDateWrite()`); [`src/utils/timestamps.ts`](../../src/utils/timestamps.ts)

## Context

firestore-orm stores temporal fields as Firestore `Timestamp`s, but applications frequently want to
read and write milliseconds-since-epoch `number`s. ADR-0002 shipped `zDateWrite()` and documented a
"write a `Date`/`serverTimestamp()`, convert `Timestamp → number` on read with a hand-written
`FirestoreDataConverter`" recipe. That recipe is correct but boilerplate every consumer must
re-author. Two Admin-SDK behaviors constrain any helper:

- **`fromFirestore` is the only read-transform seam.** firestore-orm's lifecycle hooks are
  write-only — there is no read/after-find hook — so a read conversion must live in the converter.
- **`toFirestore` is skipped on partial writes.** The Admin SDK invokes `toFirestore` on `add`/`set`
  (create, upsert, bulkCreate, tx-create) but **not** on `update()` / `batch.update` / `tx.update`.
  A `number → Timestamp` transform placed in `toFirestore` would therefore silently no-op on the
  update paths — a footgun.

Additionally, the repository overlays the document `id` itself (`getById` returns
`{ ...data, id }`), so `fromFirestore` must not synthesize one; and `snapshot.data()` returns other
Firestore value types (`VectorValue`, `GeoPoint`, `DocumentReference`) that a naive recursive walk
could corrupt.

## Decision

Ship an ergonomic converter plus the primitives it is built from, as additive exports from the main
entry.

1. **`createMillisTimestampConverter<T>(fields?)`** builds a `FirestoreDataConverter` whose
   `fromFirestore` converts stored `Timestamp`s to ms `number`s (recursively by default, or scoped
   to named top-level `fields`) and whose `toFirestore` is a **pass-through**. Write-side conversion
   is deliberately omitted because of the `update()` gap above; the recommended write path is native
   `Date` / `serverTimestamp()` (stored as `Timestamp` on every write path).

2. **Three primitives**: `convertTimestampToMillis(ts)` and `convertMillisToTimestamp(ms)` for
   single values, and `convertTimestampsToMillis<T>(data)` for the recursive walk.

3. **Structural, admin-free detection.** The recursive walk uses a `toMillis` duck-check (not
   `instanceof Timestamp`) and only rebuilds **plain objects and arrays**, so
   `convertTimestampsToMillis` references no `firebase-admin` value and is safe to copy into
   shared/browser code, and non-plain Firestore value types (`VectorValue`, `GeoPoint`,
   `DocumentReference`) pass through untouched.

4. **`number` on both sides is a documented hook pattern, not a `toFirestore` transform.** Callers
   who want to author `number`s on write convert in a `beforeCreate`/`beforeUpdate` hook with
   `convertMillisToTimestamp` (hooks run on every write path, before validation) and widen the write
   schema to accept a `Timestamp`.

## Consequences

**Positive**

- The documented recipe collapses to one call; the hand-written converter becomes an "under the
  hood" explanation.
- `convertTimestampsToMillis` is a reusable, dependency-free primitive; other Firestore value types
  are never corrupted by the walk.
- Fully additive (minor): four new exports, no signature or behavior changes to existing API.

**Negative / costs**

- Read and write still share one generic `T`, so writing a `Date`/`serverTimestamp()` into a field
  typed as its read shape (`number`) needs a cast — existing library idiom, not solved here.
- The converter handles only the read direction; the `number`-in-both-directions workflow remains a
  documented hook pattern rather than a turnkey option.
- Detection is structural (`toMillis`), so a non-`Timestamp` object that happens to expose a
  `toMillis` method would be converted — an accepted, low-risk trade for staying admin-free.

## Alternatives considered

- **`number → Timestamp` in `toFirestore`.** Rejected: skipped on `update()`, so it would convert on
  create but silently no-op on updates.
- **Require an explicit `fields` list (no recursive default).** Rejected: the recursive default is
  the more ergonomic primary path; `fields` remains available for scoped, predictable conversion.
- **`instanceof Timestamp` detection.** Rejected: it couples the recursive walk to `firebase-admin`,
  defeating the "safe to reuse in shared code" property of `convertTimestampsToMillis`.

## References

- [`src/utils/timestamps.ts`](../../src/utils/timestamps.ts) — the four helpers.
- [Docs → Storing a Timestamp, reading a millisecond number](../usage/timestamps.md#storing-a-timestamp-reading-a-millisecond-number).
- Branch `feat/timestamp-millis-converter`.
