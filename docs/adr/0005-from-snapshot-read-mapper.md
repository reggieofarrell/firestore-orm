# ADR-0005: `fromSnapshot()` read-mapper for raw Firestore snapshots

- **Status:** Accepted
- **Date:** 2026-07-17
- **Deciders:** Reggie O'Farrell
- **Related:** [`src/core/FirestoreRepository.ts`](../../src/core/FirestoreRepository.ts); the
  Firestore triggers usage guide; builds on the converter/`id`-overlay read semantics in
  [ADR-0003](0003-timestamp-millis-converter-helper.md)

## Context

Firestore trigger cloud functions (`onDocumentCreated`/`onDocumentUpdated`/…) hand the handler a raw
`QueryDocumentSnapshot`. That snapshot is **not** the shape a repository read produces, for two
reasons rooted in Admin-SDK behavior:

- **Converters are ref-scoped.** The SDK invokes a `FirestoreDataConverter.fromFirestore` only for
  references built with `withConverter(...)`. The repository applies its converter that way
  (`createCollectionReference`), so every repository read is converter-transformed — but a trigger
  snapshot is not, so converter-mapped fields (e.g. a `Timestamp` that
  `createMillisTimestampConverter` exposes as a `number`) remain their raw stored type.
- **`id` is overlaid by the repository, not stored.** `snapshot.data()` never contains `id`; the
  repository reads `snapshot.id` and overlays it (reads resolve to `T & { id }`).

Consequently the ergonomic-but-wrong `snapshot.data() as T` cast mislabels both the converted fields
and the (absent) `id`. Consumers were hand-writing the reconstruction at every trigger, or casting
and hitting the footgun. There was no shared snapshot→document helper in the codebase.

## Decision

Add a public instance method `fromSnapshot(snapshot: DocumentSnapshot): (T & { id: ID }) | null` to
`FirestoreRepository` that reconstructs the read shape exactly as a normal read does:

1. Return `null` when `!snapshot.exists`.
2. Apply `this.converter.fromFirestore(snapshot)` when a converter is configured; otherwise use
   `snapshot.data()`.
3. Overlay `id` from `snapshot.id` last (`{ ...data, id }`), so it wins over any `id` in the body.

Deliberate scope choices:

- **No validation.** Every other read in the library is a compile-time cast, not a runtime parse;
  `fromSnapshot` matches that so it is not surprisingly stricter or slower than `getById`. Callers
  who want a runtime guarantee at the trigger trust boundary parse the result with the
  already-exposed read schema (`repo.schemas?.read.parse(repo.fromSnapshot(snap))`). No
  `{ validate }` option ships.
- **`null` on a non-existent snapshot**, mirroring `getById`, rather than throwing — keeps
  `onDelete`/guard code clean.
- **Returns the read model `T`, not the write model `W`** — it is a read.
- **Parameter typed `FirebaseFirestore.DocumentSnapshot`** (a `QueryDocumentSnapshot` is a subtype,
  so trigger payloads pass directly). `firebase-functions` is not a dependency; the method depends
  only on the Admin-SDK snapshot type already available.

## Consequences

**Positive**

- One call reconstructs a trigger snapshot correctly; the two footguns (unconverted fields, missing
  `id`) are closed in shared, tested code.
- Purely additive (minor): a new instance method on an already-exported class — no signature or
  behavior change to existing API, no new dependency, no `src/index.ts` change.

**Negative / costs**

- `fromSnapshot` reconstructs but does not validate, so a stored document that has drifted from the
  schema is not caught unless the caller opts into parsing — documented in the Firestore triggers
  usage guide.
- It is the first extraction of the `{ ...data, id }` read overlay; the ~12 inline read sites are
  left as-is (not refactored to route through it) to keep this change minimal.

## Alternatives considered

- **A standalone `snapshotToDoc(snapshot, { converter, schema })` function.** Rejected: the
  repository already holds the converter (and schema), so an instance method is the ergonomic
  "import the repo, call it" shape the feature is for.
- **Validate by default (or a `{ validate: true }` option).** Rejected for v1: inconsistent with the
  rest of the read path and easy to add later; the read schema is already exposed for opt-in
  parsing.
- **Throw on a non-existent snapshot.** Rejected: `null` matches `getById` and reads cleaner in
  trigger guards.

## References

- [`src/core/FirestoreRepository.ts`](../../src/core/FirestoreRepository.ts) — `fromSnapshot`
  implementation, next to the by-id reads.
- Consumer usage: the "Using with Firestore triggers" guide and the `fromSnapshot` entry in the API
  Reference (published docs).
- Branch `feat/from-snapshot`.
