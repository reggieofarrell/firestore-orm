# ADR-0008: Firestore converters are read-only (`readConverter`)

- **Status:** Accepted (implemented on branch `feat/read-only-converters`; pending merge/release)
- **Date:** 2026-07-18
- **Deciders:** Reggie O'Farrell
- **Related:** [issue #11](https://github.com/reggieofarrell/firestore-orm/issues/11); builds on
  [ADR-0003](0003-timestamp-millis-converter-helper.md) (which already documented `fromFirestore` as
  the only read-transform seam and `toFirestore`'s update-path gap);
  [`src/core/FirestoreRepository.ts`](../../src/core/FirestoreRepository.ts)

## Context

A repository converter was applied through a single seam: the collection reference was wrapped with
`.withConverter(this.converter)` and that **one** ref backed both reads and writes. That coupling
produced an asymmetry rooted in Admin SDK behavior:

- `fromFirestore` runs on **every** read — reliable, idiomatic, and what backs
  `createMillisTimestampConverter` (ADR-0003).
- `toFirestore` runs on the create-family writes that call `add`/`set` (`create`, `bulkCreate`,
  `upsert` when creating, `createInTransaction`) but the Admin SDK **never** invokes it on
  `update`/`batch.update`/`tx.update`. So a `toFirestore` write transform silently applied on create
  and no-op'd on every update — a footgun documented but not removed.

The converter concept was also a source of user confusion: an option literally named `converter`
implies bidirectional transformation, but only the read direction was ever dependable.

## Decision

We will make converters **strictly read-only** and name the option accordingly.

1. **Accept only the `fromFirestore` half.** The public option is `converter` → **`readConverter`**
   (on the `withSchema` / `subcollection` options, the constructor's positional parameter, and the
   private field), typed as a new exported
   `ReadConverter<T> = (snapshot: QueryDocumentSnapshot) => T` — the `fromFirestore` mapper only.
   The repository builds the full `FirestoreDataConverter` internally (the user's mapper plus a
   pass-through `toFirestore`) and applies it to the read ref. A `toFirestore` is therefore not even
   expressible by callers, which is what removes the confusion.
   `createMillisTimestampConverter<T>()` now returns this mapper (its return type changed from
   `FirestoreDataConverter<T>` to the `fromFirestore` mapper) so it remains a drop-in
   `readConverter`.

2. **Split the collection reference into a read ref and a write ref.** `readCol()` builds and
   attaches the internal converter (so `fromFirestore` runs on all read paths); `writeCol()` is the
   raw `db.collection(path)` and is used by every write path (`create`, `bulkCreate`, `upsert`,
   `createInTransaction`, and all update/patch/delete document refs). `toFirestore` is therefore
   **never** invoked on any write path. Delete paths read through `readCol()` to preserve the
   `fromFirestore`-transformed hook payloads; deletes never call `toFirestore` regardless.

3. **Write-time conversion stays a `before*` hook concern.** Hooks run on every write path before
   validation; that is the sanctioned seam for normalizing write payloads.

## Consequences

**Positive**

- The create-vs-update asymmetry is gone: converters affect reads only, on every read path, with no
  silent write behavior to reason about.
- The `readConverter` name **and shape** remove the "does my `toFirestore` run?" confusion by
  construction — callers cannot supply a `toFirestore` at all.
- `createMillisTimestampConverter` keeps doing exactly what it did (recursive `Timestamp -> number`
  on read); only its return type narrows from a full `FirestoreDataConverter<T>` to the
  `fromFirestore` mapper it always centered on.
- Read coverage stays native (the Admin SDK applies `fromFirestore` for free across `getById`,
  `getAll`, query terminals, `listenOne`, transaction reads) — nothing is hand-reimplemented.

**Negative / costs**

- Breaking (v3 major): the `converter` option is renamed to `readConverter` and now takes the
  `fromFirestore` mapper (not a full `FirestoreDataConverter`); `createMillisTimestampConverter`'s
  return type narrows accordingly; and any create-time `toFirestore` serialization no longer runs.
  Migration: pass `converter.fromFirestore` (or just the mapper) as `readConverter`; move any
  create-time write transform into a `before*` hook. This is a cleanup, not a regression of working
  behavior — `toFirestore` was already skipped on updates.
- Read transforms remain synchronous and repo-context-free (a `FirestoreDataConverter` limitation).
  Async or enrichment-on-read is not covered; see the read-hook note below.

## Alternatives considered

- **Drop converters entirely and add an `afterRead`/`afterFind` hook.** Rejected: it rebuilds
  `createMillisTimestampConverter` (shipped one release earlier, ADR-0003), re-implements read
  coverage the SDK already provides for free, and must handle `select`/aggregation partial-document
  edge cases across every read path — far more churn for no read-side benefit today. A read hook can
  still be added **additively later** if demand for async/repo-context read transforms appears;
  keeping read-only converters does not foreclose it.
- **Keep the name `converter` but only apply it to reads.** Rejected: it fixes the behavior but not
  the confusion — the name still implies a write direction that never runs.
- **Accept a full `FirestoreDataConverter<T>` as `readConverter` and ignore its `toFirestore`.**
  Rejected: it keeps `createMillisTimestampConverter()` a drop-in but still lets callers write a
  `toFirestore` that is silently discarded — a smaller version of the same footgun. Accepting only
  the `fromFirestore` mapper makes the read-only contract unforgeable at the type level.

## References

- [`src/core/FirestoreRepository.ts`](../../src/core/FirestoreRepository.ts) — `readCol()` /
  `writeCol()` split, `readConverter` field/option, `fromSnapshot`.
- [`src/tests/integration/repository-read-only-converter.integration.test.ts`](../../src/tests/integration/repository-read-only-converter.integration.test.ts)
  — asserts `toFirestore` is never called on any write path while reads still transform.
- Consumer usage: the "Core Concepts → Firestore Converters" and "Timestamps ↔ Millis" guides in the
  published docs.
- Branch `feat/read-only-converters`.
