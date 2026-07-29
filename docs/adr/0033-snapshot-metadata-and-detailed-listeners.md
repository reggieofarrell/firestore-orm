# ADR-0033: Opt-in snapshot read metadata and detailed listeners

- **Status:** Accepted (v3.x, pending merge/release)
- **Date:** 2026-07-28
- **Deciders:** maintainer
- **Related:** [Issue #39](https://github.com/reggieofarrell/firestore-orm/issues/39),
  [Follow-up #72](https://github.com/reggieofarrell/firestore-orm/issues/72) (write metadata),
  [ADR-0017](0017-v3-core-operations-scope.md) (amended — #39 read half leaves the deferred list),
  [ADR-0018](0018-document-identity-and-data-model.md) (overlay collision),
  [ADR-0026](0026-conditional-writes-preconditions.md) (`getByIdWithUpdateTime` pair precedent),
  [ADR-0024](0024-collection-group-queries.md) (collection-group identity overlay),
  [ADR-0029](0029-get-many-multi-document-reads.md) (`getMany`), [ADR-0031](0031-query-explain.md) /
  [ADR-0032](0032-bulkwriter-high-throughput-writes-and-recursive-delete.md) (split precedents),
  [`src/core/SnapshotMetadata.ts`](../../src/core/SnapshotMetadata.ts),
  [`src/core/FirestoreRepository.ts`](../../src/core/FirestoreRepository.ts),
  [`src/core/QueryBuilder.ts`](../../src/core/QueryBuilder.ts)

## Context

Issue #39 asked for Admin SDK snapshot metadata and a detailed listener surface the ORM did not
expose. Deferred by ADR-0017 as part of the parity backlog.

The Firebase Admin SDK already surfaces, on every read snapshot:

- **`DocumentSnapshot` / `QueryDocumentSnapshot`:** `ref`, `createTime`, `updateTime`, `readTime`
- **`QuerySnapshot`:** `readTime`, `docChanges()` (per-change `type`, `oldIndex`, `newIndex`, and a
  mappable `doc`)

The ORM mapped document data and `id` (or collection-group `path` / `parentPath`) but dropped the
provenance fields. Consumers needing `updateTime` for optimistic concurrency already had
`getByIdWithUpdateTime` (ADR-0026), but there was no general opt-in for read metadata and no mapped
`docChanges()` listener.

Planning probes (emulator, `@google-cloud/firestore@8.6.0`) established:

- Field masks (`select`, `getAll` `fieldMask`) and `readConverter` do **not** strip metadata.
- Only **non-existent** document snapshots omit `createTime` / `updateTime` — every ORM read path
  already excludes those before mapping.
- On a **`removed`** `docChanges()` entry, `change.doc` is still a `QueryDocumentSnapshot` with
  `exists === true` and full last-known data — consumers must branch on `change.type`, not on the
  snapshot.
- On single-document listener **deletion**, the snapshot becomes a plain `DocumentSnapshot` with
  `exists === false` and no `createTime` / `updateTime` — metadata cannot be built without a
  nullable shape.

Write-time metadata (`writeTime` on create/update/delete) is a separate capability. Planning found
two hard constraints: `CollectionReference.add()` yields no `WriteResult`, and transaction writes
cannot yield a `writeTime` at all — so write metadata is re-parked on
[#72](https://github.com/reggieofarrell/firestore-orm/issues/72).

## Decision

**D1 — Ship read metadata and detailed listeners; defer write metadata to #72.** Follows the #37→#65
and #38→#69 split pattern — roughly thirty read overloads across repository and query terminals is
enough for one change; write metadata needs a different return-contract design.

**D2 — Opt-in via `{ withMetadata: true }` on an options bag**, mirroring `{ returnDoc: true }`.
Paired overloads preserve default return types; no `QueryBuilder.withMetadata()` toggle that would
widen `R` through `FirestoreQueryBuilderBase`, collection-group builders, and the vector wrapper.

**D3 — Bounded read surface:**

| In                                                                                                                                         | Out                                                                     | Reason                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Core `FirestoreRepository` reads: `getById`, `getByIdOrThrow`, `getMany`, `getAll`, `findByField`, `getOneByField`, `getOneByFieldOrThrow` | Vector `get()` / `getOne()` / `explain()`                               | Composition wrapper (R-5); nobody asked yet                          |
| Query terminals: `get`, `getOne`, `stream`, `paginate`, `offsetPaginate`, `paginateWithCount`                                              | Transaction reads (`getInTransaction`, `getManyInTransaction`)          | D3 membership rule (ADR-0025)                                        |
| `onSnapshotDetailed()` on `FirestoreQueryBuilderBase`                                                                                      | `explain()` metadata variant                                            | Diagnostic surface; `QueryExplainResult` already carries `documents` |
| `listenOneDetailed()` on `FirestoreRepository`                                                                                             | `count` / `sum` / `average` / `aggregate` / `distinctValues` / `exists` | Scalar / aggregate returns, not document snapshots                   |
| Collection-group builder inherits overloads + `onSnapshotDetailed` via `extends`                                                           | `fromSnapshot()`                                                        | Caller already holds the raw snapshot                                |

`AggregateQuerySnapshot.readTime` is **not** in this surface — it re-parks on #72 with write
metadata.

**D4 — New sibling listener methods** `onSnapshotDetailed()` and `listenOneDetailed()`. Existing
`onSnapshot` / `listenOne` callbacks are untouched. Rejected an options overload on `onSnapshot`
(callback-position overloads resolve wrong when the arrow is untyped) and a second callback argument
(which would change the existing callback type).

**D5 — `listenOneDetailed` routes deletion to `onError(NotFoundError)`**, mirroring `listenOne`. The
callback stays non-nullable `WithMetadata<FirestoreDocument<T>>`; no `DetailedDocumentEvent` with
nullable `doc` / `metadata`. On deletion the underlying snapshot has no `createTime` / `updateTime`
to build metadata from.

**D6 — Shared types in `src/core/SnapshotMetadata.ts`**, deliberately in neither coverage gate (same
class as `DocumentId.ts`). Not folded into `DocumentId.ts` (identity vs provenance); not added to
`check-coverage-gates.mjs` (would trigger testing-docs-sync for a ~45-line module).

**D7 — `ref` is included in `DocumentMetadata`.** The issue names it explicitly. The
`{ doc, metadata }` split keeps **`doc` JSON-serializable**; only the sibling `metadata` (with its
live `DocumentReference`) is not.

**D8 — Sibling wrapper `{ doc, metadata }`, never a flat overlay.** Overlaying `createTime`,
`updateTime`, or `path` onto the document would shadow stored fields — the collision ADR-0018 avoids
for `id` and ADR-0026 avoids for `updateTime` (`getByIdWithUpdateTime` returns a pair for this
reason). `getByIdWithUpdateTime` remains the narrow CAS-token accessor; `{ withMetadata: true }` is
the general shape.

Exported types: `DocumentMetadata`, `WithMetadata<D>`, `DetailedDocumentChange<R>`,
`DetailedQuerySnapshot<R>`. Re-exported from `src/index.ts` and `src/vector/index.ts`.

## Consequences

- Capability matrix: #39 moves Deferred → Supported for **read** metadata and detailed listeners;
  **write** metadata tracked as [#72](https://github.com/reggieofarrell/firestore-orm/issues/72).
- Callers can obtain provenance on any in-scope read without dropping to raw snapshots.
- `getMany(ids, { withMetadata: true })` supersedes the deferred `getManyWithUpdateTime` idea
  (ADR-0029).
- Collection-group rows: `metadata.path` equals the row's own `path` (T9).
- **Hoisted-options ergonomics (T10):** `const opts = { withMetadata: true }` widens to
  `{ withMetadata: boolean }` and matches no overload — TypeScript cannot pick a return type from a
  runtime boolean. This is intentional; pass `{ withMetadata: true }` inline or use `as const`. No
  `boolean`-accepting overload (which would union every caller's return type).
- Detailed listeners: first emission is all `'added'` changes; `'removed'` changes still carry
  mappable last-known `doc` / `metadata` — branch on `type`, never on `exists` on the change doc.
- `listenOneDetailed` deletion → `onError`, not a callback with `doc: null`.

## Alternatives considered

**All three #39 deliverables in one PR** (read + write metadata + listeners). Rejected — ~30 methods
across four files; write metadata needs a different return contract (#72 constraints).

**Listener only, no read metadata overloads.** Rejected — leaves the larger half of #39 unaddressed
and sibling reads visibly inconsistent.

**Named `*WithMetadata` methods** (like `getByIdWithUpdateTime`). Rejected — roughly doubles the
read-method count.

**`QueryBuilder.withMetadata()` toggle rebinding `R`.** Rejected — widened-generic change through
base class, collection group, and vector wrapper.

**Everything readable** (vector terminals, transaction reads, aggregate `readTime`, `explain()`).
Rejected — each surface adds trap classes for capabilities nobody requested yet.

**`getById` + `get()` only.** Rejected — leaves sibling reads inconsistent.

**Options overload on `onSnapshot`.** Rejected — silent wrong resolution for untyped callbacks.

**Second callback argument on `onSnapshot`.** Rejected — changes existing callback type.

**`listenOneDetailed` delivers deletion as `{ doc: null, exists: false }`.** Rejected — needs a
nullable event type and diverges from `listenOne`; deletion snapshot lacks metadata fields anyway.

**Fold metadata types into `DocumentId.ts` or add a coverage gate row.** Rejected — see D6.

**Omit `ref` from metadata.** Rejected — issue names it; `{ doc, metadata }` split keeps `doc`
serializable.

**Flat overlay `FirestoreDocument<T> & { createTime, … }`.** Rejected — stored-field shadowing
(ADR-0018 / ADR-0026 precedent).

**`boolean`-accepting overload to fix T10.** Rejected — unions return types onto every caller.

## References

- [Issue #39](https://github.com/reggieofarrell/firestore-orm/issues/39)
- [Follow-up #72](https://github.com/reggieofarrell/firestore-orm/issues/72) (write metadata)
- Implementation: `src/core/SnapshotMetadata.ts`, `src/core/FirestoreRepository.ts`,
  `src/core/QueryBuilder.ts`, `src/index.ts`, `src/vector/index.ts`
- Tests: `src/tests/types/snapshot-metadata.type-test.ts`,
  `src/tests/integration/repository-snapshot-metadata.integration.test.ts`,
  `src/tests/integration/repository-detailed-listener.integration.test.ts`
- [ADR-0017](0017-v3-core-operations-scope.md),
  [ADR-0018](0018-document-identity-and-data-model.md),
  [ADR-0026](0026-conditional-writes-preconditions.md),
  [ADR-0024](0024-collection-group-queries.md), [ADR-0029](0029-get-many-multi-document-reads.md),
  [ADR-0031](0031-query-explain.md) /
  [ADR-0032](0032-bulkwriter-high-throughput-writes-and-recursive-delete.md) (split precedents)
- Plan / probes (maintainer-local): `docs/plans/issue-39-snapshot-metadata-detailed-listener/`

This record **amends ADR-0017**: opt-in snapshot **read** metadata and detailed listeners are no
longer deferred. The remaining deferrals (#40–#41) and the decision not to pursue full server-side
or Enterprise Pipeline parity are unchanged. (#39 read metadata / detailed listeners have since
shipped — see this ADR; write metadata is tracked separately as
[#72](https://github.com/reggieofarrell/firestore-orm/issues/72). This footer is a living index of
remaining ADR-0017 deferrals — see [`docs/adr/README.md`](README.md) Conventions.)
