# ADR-0024: Collection-group queries are a read-only surface with full-path result identity

- **Status:** Accepted (3.0.0)
- **Date:** 2026-07-25
- **Deciders:** maintainer
- **Related:** ADR-0017 (v3 core-operations scope — amended by this record), ADR-0018 (document
  identity and data model), ADR-0021 (v3 query-builder API cleanups), ADR-0023 (composite filter
  factory — this resolves its forward-compat note for #31)

## Context

Issue #31 asked for a "query-source abstraction / collection-group factory whose result retains
stable path identity (`path`/`ref`/parent), since document IDs are not globally unique across a
group."

Two facts about Firestore drive the whole design, both verified against the emulator rather than
assumed:

1. **A collection group is not a collection.** `Firestore.collectionGroup(id)` returns a
   `CollectionGroup extends Query` — no `.doc(id)`, no `.add()`, no `.path`, no single parent. As
   soon as `.where()` is applied it degrades to a plain `Query`, so an unfiltered handle has to be
   retained separately for a whole-group count (exactly as `collectionRef` already was).
2. **Ids are ambiguous.** A group matches purely on collection id, so `users/u1/posts/p1` and
   `users/u2/posts/p1` are two documents that both report `id: 'p1'`. Membership is broader than
   people expect: a same-named **root** collection is a member, and so is a same-named collection
   nested _under_ a group member (`users/u1/posts/p1/posts/deep`).

Three further behaviors shaped specific decisions:

- `where(FieldPath.documentId(), '==', 'p1')` **throws** on a group — the operand must be a full,
  even-segment document path or a `DocumentReference`. This is the exact case ADR-0023 flagged as a
  forward-compat problem: `validateDocumentId` rejects `/`.
- A `..` or reserved `__…__` segment inside a path operand reaches the server and fails there as
  `INVALID_ARGUMENT`, so the local validation boundary is load-bearing for paths just as it is for
  leaf ids. The SDK also silently tolerates a leading/trailing `/`.
- `startAfter(foreignSnapshot)` on a group **succeeds silently** and returns the whole result set.
  Firestore enforces nothing about cursor provenance; the ORM's cursor binding is the only check.

The existing `FirestoreQueryBuilder` already carried ~90% of what a group query needs, and the
composite-filter work (#30) had just demonstrated the cost of a second copy: any future query
feature would have to be written twice.

## Decision

Ship collection groups as a **read-only** query surface with **full-path result identity**, derived
from an existing repository.

1. **Entry point: `repo.collectionGroup()`** returns a stateless, reusable
   `FirestoreCollectionGroup<T, S>` handle exposing `collectionId`, `query()` (a fresh builder per
   call, mirroring `repo.query()`), and `fromSnapshot()`. The group id is the last segment of the
   repository's collection path — already proven a legal collection segment by the construction-time
   `validateCollectionPath`, so it is not re-validated. The handle inherits the repository's read
   model, stored (query-path) model, `readConverter`, and `allowLegacyDatastoreIds` policy.

   No standalone static factory. It would have to duplicate the entire `withSchema` overload set
   (write/stored schema, converter, sentinel policy) for a query-only surface; for a group with no
   concrete parent, a top-level handle
   (`FirestoreRepository.withSchema(db, 'posts', schema).collectionGroup()`) does no I/O at
   construction, so the collection it names does not have to exist.

2. **Results are `CollectionGroupDocument<T>`:** `Omit<T, 'id' | 'path' | 'parentPath'>` plus a
   readonly `id`, the full document `path`, and the containing collection's `parentPath`.

   All three are **plain strings**. A live `DocumentReference` was rejected despite the issue text
   naming `ref`: `JSON.stringify` of a ref emits SDK internals
   (`{"_firestore":{"projectId":…},"_path":{"segments":[…]},"_converter":{}}` — verified: it does
   not throw and leaks no credentials, but it is noise in every serialized response), it is not
   round-trippable, and it claims a third plausible field name off the model. Callers already own
   the `Firestore` instance, so `db.doc(row.path)` recovers a ref in one expression.

3. **Identity shadows same-named model fields, and that is enforced where it can be.** The overlay
   order (`{ ...data, id, path, parentPath }`) is the same contract `id` has had since ADR-0018, and
   the `Omit` makes it visible in the type. Because `path` is a plausible real field name (verified:
   a document with a stored `path` field round-trips normally), `collectionGroup()` **throws** when
   a schema-validated repository's read schema declares a top-level `path` or `parentPath` — the
   same remedy `assertSchemaHasNoTopLevelId` applies to `id`, but checked at `collectionGroup()` so
   an ordinary repository with a stored `path` field stays fully usable. Unvalidated repositories
   have no schema to inspect; the `Omit` in the result type is what surfaces it there.

   > Amendment (review H1, same release): as first written this checked the **read** schema only,
   > which left the dual-schema axis the library otherwise first-classes wide open. `withSchema`
   > already rejects a top-level `id` in a `storedSchema`, so identity fields were inconsistent with
   > the very precedent this decision cites. A repository with a clean read model and a divergent
   > `storedSchema` declaring `path` was accepted, and `where('path', …)` — typed against `S` —
   > filtered the stored field while `row.path` came back as the document path, leaving the caller's
   > own value unreachable (verified on the emulator; with a `readConverter` there is no silent
   > replacement, because the converter drops the stored field, but the filter/result mismatch
   > remains, so the check is unconditional). The stored schema was not retained at runtime at all —
   > `RepositorySchemaSet` carried only `read` / `create` / `update` — so it now also carries the
   > **effective** `stored` shape (the supplied `storedSchema`, or the read schema when none was
   > given), an optional and therefore non-breaking addition. The guard checks both models. Checking
   > stays at `collectionGroup()` rather than construction for the reason above: a `files`
   > collection with a stored `path` field is an ordinary model and must keep working for non-group
   > users.

4. **`CollectionGroupDocument`'s `Omit` distributes over unions** (`ReadData extends unknown ? …`),
   unlike `FirestoreDocument`. That non-distributive defect is tracked as #54 across every existing
   site; the new type is written correctly rather than adding to the debt.

5. **No `update()` / `delete()` — absent from the type, not present and throwing.** The bulk hooks
   those terminals run carry `{ ids }` / `{ ids, documents }` payloads, and an `id` is ambiguous
   across a group, so every registered hook would observe identity it cannot resolve. Path-keyed
   bulk hook events would be a hook-contract change well beyond #31's acceptance criterion. The
   documented alternative is a batch over `db.doc(row.path)`, which the group query hands the caller
   directly.

6. **The builder hierarchy is split to make that absence real.**
   `FirestoreQueryBuilderBase<T, S, R>` holds the source-agnostic read surface;
   `FirestoreQueryBuilder` adds the collection-only members (`whereId`, `orderById`,
   `collectionCount`, `update`, `delete`) and `FirestoreCollectionGroupQueryBuilder` adds the
   group-only ones (`wherePath`, `orderByPath`, `groupCount`). Four things are abstract: `toResult`
   (result materialization — now the single site all six terminal reads share),
   `assertCursorBelongsToSource`, `documentNameFilter`, and `compositeFilterHints`. Subclassing with
   throwing overrides was rejected: a runtime throw is not what a type-safe ORM should offer when
   the compiler can say it.

7. **Document-name operations take the full path.** `wherePath(op, string | DocumentReference)` and
   `orderByPath(direction?)` replace `whereId` / `orderById`, and the group's composite-filter
   factory (`CollectionGroupFilterFactory`) exposes `f.wherePath(...)` instead of `f.whereId(...)`.
   Offering `whereId` on a group would be actively wrong — the SDK rejects a bare id there.

   A new `validateDocumentPath` mirrors `validateCollectionPath` (even segment count; every segment
   through `validatePathSegment`; `allowLegacyDatastoreIds` on document segments only). It is
   **stricter than the SDK** about a leading/trailing `/`, which the SDK silently normalizes. It
   does **not** check group membership: a range bound legitimately sits outside the group, so making
   `==` behave differently from `>` would be a surprising asymmetry. A well-formed non-member path
   matches nothing, which is documented.

8. **Cursor binding is by collection id, not parent path.** `assertCursorBelongsToSource` compares
   `docRef.parent.id` to the group id. A cursor from a _different parent in the same group_ must be
   valid — that is the point of a group — while one from any other collection is rejected, closing
   the forged-cursor probe Firestore itself allows.

9. **`getPartitions()` is not wrapped.** The issue defers it ("consider later"), and it belongs with
   parallel-scan tooling rather than the read surface.

This record **amends ADR-0017**: collection-group queries are no longer deferred. The remaining
deferrals (#34–#41) and the decision not to pursue full server-side or Enterprise Pipeline parity
are unchanged. (#32 transaction options and #33 conditional writes have since shipped — see ADR-0025
/ ADR-0026; this footer is kept as a living index — see [`docs/adr/README.md`](README.md)
Conventions.)

## Consequences

- The public API gains `FirestoreCollectionGroup`, `FirestoreCollectionGroupQueryBuilder`,
  `CollectionGroupDocument`, and `CollectionGroupFilterFactory`. `FirestoreQueryBuilder`'s own
  observable shape is unchanged — it gains a base class but no member changes, and its constructor
  signature is identical.
- `FirestoreQueryBuilderBase`, `QueryFilterFactoryBase`, `CompositeFilterHints`, and
  `createFilterFactoryCore` are exported from their modules (they appear in emitted declarations and
  cannot be `@internal` under `stripInternal`) but are **not** re-exported from the package root.
- **Collection-group queries need collection-group-scoped indexes.** Firestore's automatic
  single-field indexes are collection-scoped, so even a single `where(...)` on a group requires an
  explicitly created index in production — and the emulator enforces nothing, so a green local run
  is no evidence a deployed group query is indexed. Documented in the queries guide and
  Troubleshooting.
- A schema-validated repository whose read schema has a top-level `path` / `parentPath` can still do
  everything except `collectionGroup()`, which throws with the rename remedy.
- **Fixed in passing:** `orderById('desc')` as a query's _only_ ordering has always failed with
  `FAILED_PRECONDITION: Firestore does not support descending key scans` — undocumented until now.
  Found because `orderByPath('desc')` inherits it. Both methods now document the workaround (add an
  equality `where` or a preceding `orderBy`), and both are pinned by a regression test.
- `FirestoreCollectionGroup.fromSnapshot()` rejects a snapshot from outside the group (review M2).
  Its collection id must match — otherwise an outsider snapshot is reshaped into a perfectly
  well-typed `CollectionGroupDocument` carrying the outsider's `path`, so a trigger wired to the
  wrong path would look correct and silently lie. `FirestoreRepository.fromSnapshot()` is unbound by
  comparison, but the decisive argument is _in-module_ consistency: `assertCursorBelongsToSource`
  already applies exactly this test to pagination cursors, at one comparison and no I/O.
- `distinctValues()` deliberately does **not** go through `toResult`, and so reports a stored field
  named `path` rather than the document path the row terminals overlay (review M1). Restricting its
  key space was rejected: reading `doc.data()` directly makes it the only surface that can still see
  a field the identity overlay shadows, so removing identity-named keys would close the sole escape
  hatch for exactly the data a caller would be trying to recover. Documented and pinned instead.
- Result materialization moved into `toResult`, so `get` / `getOne` / `paginate` / `offsetPaginate`
  / `stream` / `onSnapshot` can no longer drift apart in how they overlay identity — previously six
  independent copies of `{ ...doc.data(), id: doc.id }`.
- The empty-`f.or()` rejection and the non-`Filter` callback error are now source-aware: an empty
  group widens a collection query to one collection but a group query to every collection with that
  id at any depth, so the two messages must not be interchangeable.
- Vector search is unchanged and stays collection-only; `VectorQueryBuilder` still wraps a
  `FirestoreQueryBuilder`.

## Alternatives considered

**A `FirestoreRepository` in "group mode."** Rejected: a collection group has no
`CollectionReference`, so `create` / `getById` / `update` / `delete` / `upsert` / `newId` /
`subcollection` would all have to throw. That is a refused bequest on the library's central class.

**Reuse `FirestoreQueryBuilder` with a mode flag** (the `hasSelect` precedent). Rejected: it cannot
remove `update` / `delete` from the type, and `select()`'s return type would need a conditional on a
structural marker to stay group-typed. The flag would have bought a smaller diff at the cost of the
one guarantee the feature needs.

**A standalone `FirestoreCollectionGroupQueryBuilder` with no shared base.** Rejected: ~20
duplicated read methods, and the #30 work would have had to be done twice.

**Group-wide `update()` / `delete()` with new path-keyed bulk hook events.** Rejected for this
change: it alters the hook contract, which is a separate decision from "collection-group reads with
full-path identity." Reconsider if demand appears.

**Enforce group membership on `wherePath` operands** (reject a path whose second-to-last segment is
not the group id). Rejected: correct for `==` / `in`, wrong for range bounds, and the asymmetry
would be harder to explain than the documented "a non-member path matches nothing."

**Include a non-enumerable `ref`.** Rejected: `doc.ref` would work while `{ ...doc }` and
`JSON.stringify` silently dropped it — a subtler trap than not having it.

## References

- GitHub issue #31 (labels `parity`, `v3.x`); ADR-0017 §3 deferral list.
- Source: `src/core/CollectionGroup.ts`, `src/core/QueryBuilder.ts` (`FirestoreQueryBuilderBase`),
  `src/core/DocumentId.ts` (`CollectionGroupDocument`), `src/utils/documentId.ts`
  (`validateDocumentPath`), `FirestoreRepository.collectionGroup()`.
- Tests: `src/tests/integration/repository-collection-group.integration.test.ts`,
  `src/tests/types/collection-group.type-test.ts`, `src/tests/unit/documentId.unit.test.ts`, and the
  group negatives in `scripts/check-packed-consumer.mjs`.
- Issue #54 (non-distributive `Omit` on the existing identity helpers).
