# ADR-0001: Fork `spacelabs-firestoreorm` and re-architect as a deliberate `2.0.0` break

- **Status:** Accepted
- **Date:** 2026-07-08
- **Deciders:** Reggie O'Farrell
- **Related:** [`CHANGELOG.md` → 2.0.0](../../CHANGELOG.md), [`NOTICE`](../../NOTICE),
  [README → Fork & Attribution](../../README.md#fork--attribution), PR #1, ADR-0002

## Context

This project began as a fork of
[`spacelabs-firestoreorm`](https://github.com/HBFLEX/spacelabs-firestoreorm) (published as
`@spacelabstech/firestoreorm`, MIT, © 2025 HBFL3Xx). The upstream `1.x` line gave us a solid
foundation — repository pattern, Zod validation, a chainable query builder, lifecycle hooks,
subcollections, transactions — but several core contracts fought Firestore's native behavior and
carried assumptions we did not want to keep:

- **Client-side merge writes.** `update()` performed a read-modify-write via
  `set(..., { merge: true })`, which is an extra read, races under concurrency, and diverges from
  how Firestore field paths and `FieldValue` sentinels actually behave.
- **Implicit soft-delete everywhere.** A `deletedAt` field was written on every create and an
  implicit `deletedAt == null` filter was applied to reads/counts/updates/deletes, with a large
  surface of soft-delete/restore methods and hooks. This coupled every consumer to one opinionated
  lifecycle model.
- **Return contracts that force reads.** Update paths returned the full (re-read) document by
  default, making the common "just write it" case pay for a read.
- **Client-side aggregation.** `aggregate(field, 'sum'|'avg')` fetched every matching document and
  reduced in memory — unacceptable on large collections now that Firestore has server-side
  aggregation.
- **`FieldValue` sentinels vs. schema validation.** Atomic writes (`serverTimestamp`, `increment`,
  `arrayUnion`/`arrayRemove`, `delete`, `vector`) did not compose cleanly with Zod schema
  validation.
- Weaker packaging/runtime guarantees (transitive deps, older Node/`zod` floors) and no
  emulator-backed test tier or coverage enforcement.

We had to decide whether to evolve within upstream `1.x` compatibility or make a clean break. The
changes to write/return semantics and the soft-delete removal are inherently breaking, so
`1.x`-compatible evolution was not viable without carrying the very behaviors we wanted to remove.

## Decision

We forked upstream and shipped a deliberate, breaking **`2.0.0`** under
`@reggieofarrell/firestore-orm`. Consumers migrating from `@spacelabstech/firestoreorm` target
`2.0.0`, not `1.x` continuity. The re-architecture groups into the following decisions (the
`CHANGELOG` 2.0.0 entry is the exhaustive, itemized record; this ADR captures intent).

1. **Fork, ownership, and licensing.** Continue development under a new package name, preserving the
   upstream MIT license and copyright and adding our own via `LICENSE` + `NOTICE`. Provide explicit
   attribution and migration guidance in the README.

2. **Firestore-native write semantics.** `update()` / `updateInTransaction()` call `docRef.update()`
   / `tx.update()` directly instead of read-modify-write merge. A nested object therefore replaces
   that entire map field unless `{ merge: true }` (or the new `patch()` aliases) is used; top-level
   `undefined` is stripped; an empty payload is a no-op; a missing document surfaces as
   `NotFoundError`.

3. **ID-returning write contracts with opt-in read-back.** `update()`, `bulkUpdate()`, and
   `upsert()` return `{ id }` / `{ id }[]` by default; `{ returnDoc: true }` (new `UpdateOptions`)
   re-reads and returns the document. `after*` update hooks receive `{ id }` / `{ ids }`.

4. **Deterministic hook ordering.** `before*` → validation → write → `after*`. `before*` hooks run
   _before_ schema validation and receive the raw caller input, so they can enrich/normalize a
   payload that is then validated.

5. **Remove the soft-delete subsystem entirely.** Deletes are explicit. Dropped all
   soft-delete/restore methods, query-builder helpers, the eight soft-delete hook events, the
   automatic `deletedAt: null` on create, the `includeDeleted` parameters, and every implicit
   `deletedAt == null` read filter.

6. **Sentinel-aware schema validation.** Write validation recognizes `FieldValue` sentinels and
   `FieldValue.vector()` values, accepting a write when the only schema violations are scoped to
   sentinel-valued paths while still rejecting genuine violations. (This "permissive" model is later
   tightened — see ADR-0002.)

7. **Read-centric schema + typed write inputs.** `withSchema(...)` / `subcollection(..., schema)`
   require a top-level required string `id` and throw at construction otherwise. `makeValidator`
   treats its first argument as the canonical read schema and derives `create = read.omit({ id })`
   and `update = create.partial()`. Write inputs are typed `CreateInput<T>` (`WithFieldValue<T>`) /
   `UpdateInput<T>` (`PartialWithFieldValue<T>`), and a top-level `id` in a payload is stripped
   before persistence.

8. **Server-side query operations.** Replace client-side `aggregate()` with `query().sum()` /
   `query().average()` (Firestore `AggregateField`). Replace `list()` / `startAfterId()` with opaque
   base64url cursor pagination returning `{ items, nextCursor, hasMore }`, requiring an `orderBy()`
   and throwing on stale cursors.

9. **Optional Firestore converter support.** Accept a `FirestoreDataConverter` on the constructor,
   `withSchema`, and `subcollection`. Converters are instance-local — subcollections do not inherit
   a parent's converter.

10. **Vector search as an opt-in subpath.** KNN search ships only under
    `@reggieofarrell/firestore-orm/vector`; the main entry point does not re-export it, keeping the
    core surface and dependency footprint unchanged for non-vector users.

11. **Stricter packaging and runtime floors.** `firebase-admin` and `zod` become peer dependencies
    only (no transitive install); `zod` tightened to `^3.25.0 || ^4.0.0`; minimum Node raised to
    `>=18` (aligns with `firebase-admin@13`; Node 16 is EOL).

12. **Two-tier testing and release tooling.** A Jest unit tier plus an emulator-backed integration
    tier, enforced by **dual per-suite, path-specific coverage gates** (merged LCOV intentionally
    not gated). Conventional Commits + commitlint + `commit-and-tag-version`, and a tag-triggered
    OIDC npm publish workflow.

## Consequences

**Positive**

- Writes match Firestore semantics: fewer reads, no read-modify-write races, honest `FieldValue`
  behavior.
- Consumers are no longer forced into a soft-delete data model; delete behavior is explicit.
- Cheaper aggregation and pagination at scale; resilient cursors across subcollections.
- Stronger correctness guarantees from the emulator tier and enforced coverage gates.
- Clear licensing/attribution posture for a derivative work.

**Negative / costs**

- Hard break from upstream `1.x`: package rename, changed return/write/hook contracts, removed
  soft-delete, changed pagination and error mapping (`parseFirestoreError` now maps not-found →
  `NotFoundError`). Migration requires code changes; guidance lives in the README and `CHANGELOG`.
- Peer-dependency-only + higher Node/`zod` floors can require consumer environment updates.
- Native `update()` replacing whole map fields is a sharp edge for anyone who relied on the old
  implicit deep-merge; `patch()` / `{ merge: true }` is the intended path.
- Two test tiers and coverage gates raise contributor setup (Firestore emulator) and CI cost.

## Alternatives considered

- **Evolve within upstream `1.x` compatibility.** Rejected: the write-semantics change and
  soft-delete removal are inherently breaking, so this would have meant carrying the behaviors we
  set out to remove.
- **Keep soft-delete behind a flag.** Rejected: the implicit filtering leaked into every read/query
  path; a flag would preserve the complexity and footguns we wanted gone. Explicit deletes are
  simpler and predictable.
- **Bundle vector search into the main entry.** Rejected: it would enlarge the core surface and pull
  vector-only concerns onto every consumer; a `./vector` subpath keeps it strictly opt-in.
- **Single merged-coverage gate.** Rejected in favor of per-suite gates — a merged LCOV lets a line
  covered in either suite count as covered, inflating confidence for code that should be exercised
  against the emulator.

## References

- [`CHANGELOG.md` → 2.0.0](../../CHANGELOG.md) — the itemized, authoritative change list relative to
  `@spacelabstech/firestoreorm@1.1.0`.
- [`NOTICE`](../../NOTICE), [`LICENSE`](../../LICENSE) — fork attribution and dual copyright.
- [README → About / Fork & Attribution](../../README.md#about-this-project).
- Upstream: [HBFLEX/spacelabs-firestoreorm](https://github.com/HBFLEX/spacelabs-firestoreorm).
