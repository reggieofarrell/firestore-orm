# Follow-up: `Timestamp ↔ millis` converter helper

**Status:** planned fast-follow. Depends on the sentinel-validation work (which ships
`zDateWrite()`) having landed.

## Motivation

firestore-orm stores temporal fields as Firestore `Timestamp`s, but applications frequently want to
work with milliseconds-since-epoch `number`s. As of the sentinel-validation PR the supported recipe
is the **`zDateWrite()` + a small hand-written read converter** pattern (documented in the README).
This follow-up adds an ergonomic helper so callers don't hand-write `fromFirestore`.

## Constraints discovered (must respect)

- **Read transform is converter-only.** firestore-orm has no read/after-find lifecycle hook (hooks
  are write-only). `FirestoreDataConverter.fromFirestore` is the single read-transform seam; it runs
  on every `.get()`.
- **`toFirestore` is skipped on partial writes.** The Admin SDK invokes `toFirestore` on `add`/`set`
  (create, upsert, bulkCreate, tx-create) but **not** on `update()` / `batch.update` / `tx.update`.
  So a number→Timestamp transform in `toFirestore` would silently no-op on the update paths — a
  footgun. Do not put write conversion in the converter.
- **The repository overlays `id` itself** (`getById` returns `{ ...data, id }`), so `fromFirestore`
  must return the converted data **without** an `id`.
- **Native temporal writes need no conversion.** A JS `Date` and a resolved `serverTimestamp()` are
  stored as `Timestamp` by the Admin SDK on all write paths — so the recommended write path needs
  zero `toFirestore` work.
- **Single generic `T`** for read + write means a field that reads as `number` but is written as
  `Date`/`serverTimestamp()` needs a cast on write; this is existing library idiom (see the sentinel
  integration tests) and is a documentation matter, not solved here.

## Proposed API (new module `src/utils/timestamps.ts`)

- `convertTimestampToMillis(ts): number` — single value; throws if not a `Timestamp`.
- `convertMillisToTimestamp(ms): Timestamp` — single value; imports `Timestamp` from
  `firebase-admin/firestore` so callers don't pass the class in.
- `convertTimestampsToMillis<T>(data): T` — recursively converts every Firestore `Timestamp` in a
  value (objects + arrays) to an ms `number` via a structural `toMillis` duck-check. Stays
  `firebase-admin`-free so it is safe to reuse in shared/browser code.
- `createMillisTimestampConverter<T>(fields?: string[]): FirestoreDataConverter<T>` — builds a
  converter whose `fromFirestore` runs the read conversion (recursive by default, or scoped to the
  named top-level `fields`) and whose `toFirestore` is **pass-through**. Returns data without `id`.
- Re-export all four from `src/index.ts`.

## Decisions

- **No number→Timestamp in `toFirestore`** (the update() gap). For an "author works in `number` both
  directions" workflow, document the `before*`-hook approach using `convertMillisToTimestamp` (hooks
  run on every write path, before validation — so the write schema must then accept a `Timestamp`).
- **Recursive-by-default** `fromFirestore` is the convenient default; the `fields` parameter offers
  scoped, more predictable conversion.
- `convertTimestampsToMillis` only touches objects exposing `toMillis`, so a `VectorValue`
  (`{ _values }`, no `toMillis`) is left untouched — no collision with the vector module.

## Tests

- **Unit** (`src/tests/unit/timestamps.unit.test.ts`): both single-value conversions;
  `convertTimestampsToMillis` over nested objects, arrays, and mixed/absent fields; null/undefined
  safety; `createMillisTimestampConverter` `fromFirestore` recursive vs `fields`-scoped;
  `toFirestore` pass-through; non-Timestamp values untouched.
- **Integration**: a repo built with `createMillisTimestampConverter` + a `zDateWrite()` field;
  write `serverTimestamp()` on create and a `Date` on update; read back and assert an ms `number` on
  both paths.

## Docs

Promote the README Timestamp subsection to show the helper as the primary/ergonomic path, keeping
the manual `zDateWrite()` + hand-written `fromFirestore` recipe as the "under the hood" explanation.

## Rollout

Additive minor (new exports only; no breaking changes). Finalize naming
(`createMillisTimestampConverter` vs `millisTimestampConverter` vs `timestampMillisConverter`).

## Open questions

- `fromFirestore` recursive default vs required explicit `fields` (recommend recursive default +
  `fields` opt-in).
- Ship a write-side helper for the `number`-in case (hook-based) or leave it as a documented pattern
  only?
