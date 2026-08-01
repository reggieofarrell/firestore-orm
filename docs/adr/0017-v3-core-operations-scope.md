# ADR-0017: v3 scope is Firestore Core operations; server-parity features are deferred

- **Status:** Accepted (v3)
- **Date:** 2026-07-19
- **Deciders:** maintainer
- **Related:** ADR-0001 (fork and 2.0 re-architecture), ADR-0015 (express adapter subpath), ADR-0016
  (dual build & support floor); amended by ADR-0023 (composite filters land in 3.0.0) and ADR-0024
  (collection-group queries land in 3.0.0)

## Context

A follow-up to the v3 release review enumerated a large set of server-side Firestore features the
ORM does not expose first-class: composite `Filter.and(...)` / `Filter.or(...)` queries,
collection-group queries, read-only / PITR transaction options, conditional writes (create-only +
`lastUpdateTime` preconditions), generic multi-aggregation, multi-document `getAll`, `BulkWriter`,
Query Explain, the full cursor surface (`limitToLast`, typed bounds), richer listener metadata,
server-side distinct, and the pre-GA Enterprise Pipeline query model.

The round-2 review correctly noted that the round-1 response overstated completeness: its closing
line claimed "everything else in the review's final release gate is satisfied," but that gate lists
composite filters, transaction options, and conditional writes as pre-v3 items. Native query
streaming is the only follow-up item implemented on the v3 branch.

The original review's own guidance was that "the best v3 is a tightened, internally consistent
release rather than a larger one," and it did not recommend a broad new feature set. A repository
ORM also should not attempt to duplicate the entire server database plane, and the Enterprise
Pipeline API is still pre-GA.

## Decision

We will scope and describe **v3 as a type-safe ORM for Firestore _Core operations_**, not as full
server-side Firestore parity. Concretely:

1. **Ship the tightened contract set** already in v3 (create/read-model, strict sentinels,
   empty-update rejection, projection typing, native streaming, dual build, support floor, error
   normalization, security hardening) plus the cheap local guard for the SDK-invalid combination
   `select().onSnapshot()`.
2. **Document the scope and the escape hatch.** A "Scope & capability matrix" guide states which
   Core features are supported vs. deferred and documents the supported raw-SDK escape hatch:
   callers who own the injected `Firestore` instance can drop down to the Admin SDK for anything the
   ORM does not wrap. (`FirestoreQueryBuilder.getUnderlyingQuery()` remains `@internal` and returns
   `Query<any>`; it is not a re-entry point into the builder.)
3. **Defer the parity features to tracked v3.x work**, each recorded as a GitHub issue labeled
   `parity` / `v3.x`: composite filters (#30), collection-group queries (#31), transaction options /
   PITR (#32), conditional writes / preconditions (#33), generic multi-aggregation (#34), `getMany`
   multi-document reads (#35), typed lower-level bounds + `limitToLast` (#36), Query Explain (#37),
   BulkWriter + recursive delete (#38), snapshot/write metadata + detailed listeners (#39),
   server-side / structured-equality distinct (#40), and an experimental Enterprise Pipeline subpath
   (#41).

   > Amendment (3.0.0, issue #30): composite filters are **no longer deferred** — they ship in 3.0.0
   > as `FirestoreQueryBuilder.whereFilter(build)`, plus the matching `VectorQueryBuilder`
   > prefilter, so #30 leaves this list. The remaining deferrals (#31–#41) are unchanged, as is the
   > decision not to pursue full server-side or Enterprise Pipeline parity. Rationale and contract:
   > ADR-0023.

   > Amendment (3.0.0, issue #31): collection-group queries are **no longer deferred** — they ship
   > in 3.0.0 as `FirestoreRepository.collectionGroup()`, a read-only query surface whose results
   > carry full-path identity (`path` / `parentPath`), so #31 leaves this list. The surface is
   > deliberately narrower than the collection builder: no `update()` / `delete()`, because the bulk
   > hooks they run are `id`-keyed and ids are not unique across a group. The remaining deferrals
   > (#32–#41) are unchanged, as is the decision not to pursue full server-side or Enterprise
   > Pipeline parity. Rationale and contract: ADR-0024.

   > Amendment (3.0.0, issue #32): transaction options (read-only / PITR / `maxAttempts`) are **no
   > longer deferred** — they ship in 3.0.0 as a second argument on
   > `runInTransaction(fn, options?)`, a `runReadOnlyAt(readTime, fn)` convenience, and a
   > type-narrowed `ReadOnlyTransactionalRepository` callback when `readOnly: true`. The same change
   > renames `getForUpdateInTransaction` → `getInTransaction` (mode-agnostic name; locking is a
   > property of the transaction mode). So #32 leaves this list. The remaining deferrals (#33–#41)
   > are unchanged, as is the decision not to pursue full server-side or Enterprise Pipeline parity.
   > Rationale and contract: ADR-0025.

   > Amendment (3.0.0, issue #33): conditional writes / preconditions are **no longer deferred** —
   > they ship in 3.0.0 as explicit-id create-only writes (`createWithId`, `bulkCreateWithIds`,
   > `createWithIdInTransaction`, all backed by the SDK's `create()`), an optional `lastUpdateTime`
   > precondition on every update/delete surface (single, bulk, and transaction), and
   > `getByIdWithUpdateTime` to read the token. A failed precondition normalizes to a new
   > `PreconditionFailedError` (HTTP 412) and a create-only collision to the existing
   > `ConflictError` (HTTP 409). `upsert()` is deliberately unchanged. So #33 leaves this list. The
   > remaining deferrals (#34–#41) are unchanged, as is the decision not to pursue full server-side
   > or Enterprise Pipeline parity. Rationale and contract: ADR-0026.

   > Amendment (3.0.0, issue #34): generic multi-aggregation is **no longer deferred** — it ships in
   > 3.0.0 as `FirestoreQueryBuilderBase.aggregate(spec)`, a plain descriptor map of aliased `count`
   > / `sum` / `average` entries with typed numeric field paths and a three-branch result mapping
   > (`average` stays `number | null` per ADR-0020). So #34 leaves this list. The remaining
   > deferrals (#35–#41) are unchanged, as is the decision not to pursue full server-side or
   > Enterprise Pipeline parity. Rationale and contract: ADR-0027.

   > Amendment (3.0.0, issue #35): multi-document reads are **no longer deferred** — they ship in
   > 3.0.0 as `FirestoreRepository.getMany(ids, options?)` /
   > `getManyInTransaction(tx, ids, options?)` (positional `(FirestoreDocument | null)[]`, optional
   > field mask, empty-input short-circuit) plus a `bulkDelete` pre-read rewire onto `db.getAll` for
   > a single consistent snapshot. So #35 leaves this list. The remaining deferrals (#36–#41) are
   > unchanged, as is the decision not to pursue full server-side or Enterprise Pipeline parity.
   > Rationale and contract: ADR-0029.

   > Amendment (3.0.0, issue #36): typed lower-level query bounds + `limitToLast` are **no longer
   > deferred** — they ship in 3.0.0 as `startAt` / `startAfter` / `endAt` / `endBefore`, `offset`,
   > and `limitToLast` on `FirestoreQueryBuilderBase` (SDK-matching snapshot / field-value
   > overloads), with local guards for `limitToLast`+`orderBy`, `stream`, and opaque
   > `paginate`/`offsetPaginate`. Opaque path-only `paginate` tokens are unchanged. So #36 leaves
   > this list. The remaining deferrals (#37–#41) are unchanged, as is the decision not to pursue
   > full server-side or Enterprise Pipeline parity. Rationale and contract: ADR-0030.

   > Amendment (3.0.0, issue #37): Query Explain is **no longer deferred** for the non-streaming
   > path — it ships in 3.0.0 as `explain(options?)` on `FirestoreQueryBuilderBase` (collection +
   > collection-group) and on `VectorQueryBuilder` after `findNearest()`, returning
   > `QueryExplainResult<R> = { metrics, documents }` with ORM-mapped rows (`null` plan-only / `[]`
   > analyzed empty). `explainStream` remains deferred (Core-only follow-up). Emulator does not
   > return explain metrics. So #37 leaves this list for `explain()`. The remaining deferrals
   > (#38–#41) are unchanged, as is the decision not to pursue full server-side or Enterprise
   > Pipeline parity. Rationale and contract: ADR-0031.

   > Amendment (3.0.0, issue #65): Core Query `explainStream()` is **no longer deferred** — it ships
   > in 3.0.0 as `explainStream(options?)` on `FirestoreQueryBuilderBase` (collection +
   > collection-group), returning `AsyncGenerator<QueryExplainStreamResult<R>>` with builder-mapped
   > document chunks and optional metrics chunks. Local `hasLimitToLast` reject; vector/Aggregate
   > surfaces stay absent. Emulator streams documents without metrics. #65 was a separately tracked
   > Core-only follow-up to #37, **not** an original ADR-0017 `#35–#41` item, so the remaining
   > deferral (**#41**) wording is unchanged. Rationale and contract: ADR-0036.

   > Amendment (3.0.0, issue #38): BulkWriter high-throughput writes and explicit recursive delete
   > are **no longer deferred** — they ship in 3.0.0 as `bulkWrite(operations, options?)` (mixed
   > verbs, positional per-item results, no lifecycle hooks — throws if any bulk hook is registered
   > unless `{ skipHooks: true }`) and document-scoped `recursiveDelete(id)` (document +
   > descendants, no hooks, no count). A collection-wide recursive delete stays deferred
   > ([#69](https://github.com/reggieofarrell/firestore-orm/issues/69)). So #38 leaves this list.
   > The remaining deferrals (#39–#41) are unchanged, as is the decision not to pursue full
   > server-side or Enterprise Pipeline parity. Rationale and contract: ADR-0032.

   > Amendment (3.0.0, issue #39): Snapshot **read** metadata and detailed listeners are **no longer
   > deferred** — they ship in 3.0.0 as `{ withMetadata: true }` on the core reads and query
   > terminals, plus `onSnapshotDetailed()` / `listenOneDetailed()`. **Write** metadata stays
   > deferred ([#72](https://github.com/reggieofarrell/firestore-orm/issues/72)). So #39 leaves this
   > list for read metadata and detailed listeners. The remaining deferrals **(#40–#41)** are
   > unchanged, as is the decision not to pursue full server-side or Enterprise Pipeline parity.
   > Rationale and contract: ADR-0033.

   > Amendment (3.0.0, issue #40): `distinctValues` Firestore-aware semantic equality is **no longer
   > deferred** — it ships in 3.0.0 as default-on client-side dedupe by a Firestore-aware canonical
   > key (maps/arrays structural, key order irrelevant; `Timestamp` / `GeoPoint` /
   > `DocumentReference` / `Bytes` / `VectorValue` by value; unrecognized `readConverter` output
   > falls back to identity). Signature, constraint and return type are unchanged. The method stays
   > client-side (downloads matching documents). A field-mask download-size optimization is tracked
   > separately as [#75](https://github.com/reggieofarrell/firestore-orm/issues/75); server-side /
   > Pipeline distinct remains [#41](https://github.com/reggieofarrell/firestore-orm/issues/41). So
   > #40 leaves this list. The remaining deferral (**#41**) is unchanged, as is the decision not to
   > pursue full server-side or Enterprise Pipeline parity. Rationale and contract: ADR-0034.

   > Amendment (3.0.0, issue #72): Opt-in **write** metadata (`writeTime` on non-transactional
   > repository writes via `{ withMetadata: true }`) is **no longer deferred** — it ships in 3.0.0
   > as enriched write results (`WriteMetadata` / `WriteResultWithMetadata`), with `returnDoc`
   > mutually exclusive and transactional helpers excluded. So the original #39 deferral is **fully
   > closed** (read half: ADR-0033; write half: this amendment / ADR-0037). The remaining deferral
   > (**#41**) is unchanged, as is the decision not to pursue full server-side or Enterprise
   > Pipeline parity. Rationale and contract: ADR-0037.

   > Amendment (3.0.0, issue #69): Collection-wide recursive delete is **no longer deferred** — it
   > ships in 3.0.0 as `recursiveDeleteCollection(): Promise<void>` (distinct zero-argument method;
   > no confirmation flag; no hooks; no count; raw `CollectionReference` SDK delegation). #69 is a
   > separately tracked follow-up to the document-scoped half shipped under #38 / ADR-0032; the
   > historical issue #38 amendment above is left intact. #69 was **not** an original ADR-0017
   > `#35–#41` item, so the remaining deferral (**#41**) wording is unchanged. Rationale and
   > contract: ADR-0038.

We explicitly do **not** block v3 on any of the deferred items.

## Consequences

The v3 release message is honest: a Core-operations ORM with documented Admin SDK escape hatches,
not a claim of full server-side or Enterprise Pipeline parity. Consumers needing a deferred
capability use the raw SDK today and can track/ upvote the corresponding issue. The round-1
response's completeness claim is corrected (see
`docs/development/v3-release-review-response-round2.md`). Future adapters (e.g. Pipelines) follow
the ADR-0015 pattern: a separate subpath, generic over an explicit output schema, rather than
overloading the Core builder that always returns `T & { id }`.

## Alternatives considered

**Implement the narrower pre-v3 parity set now** (composite filters, transaction options,
conditional writes, collection-group): rejected for v3 — it materially expands scope and delays the
release, and runs against the review's "tightened, not larger" guidance. These remain the
highest-priority v3.x additions.

**Narrow the release message to only the five original blockers and say nothing about parity:**
rejected — silence would let the package imply broader parity than it provides. An explicit
capability matrix is the honest middle ground.

## References

- The v3 release review and its round-2 response — "Server-side Firestore feature parity follow-up"
  (maintainer-local review records under `reviews/`, not committed to the repo).
- GitHub issue #41 (labels `parity`, `v3.x`); #30 is closed by the 3.0.0 `whereFilter` API
  (ADR-0023), #31 by the 3.0.0 `collectionGroup()` API (ADR-0024), #32 by the 3.0.0 transaction
  options / `runReadOnlyAt` / `getInTransaction` rename (ADR-0025), #33 by the 3.0.0 conditional
  writes / `lastUpdateTime` preconditions API (ADR-0026), #34 by the 3.0.0 `aggregate(spec)` API
  (ADR-0027), #35 by the 3.0.0 `getMany(ids)` / `getManyInTransaction` API (ADR-0029), #36 by the
  3.0.0 typed bounds / `offset` / `limitToLast` API (ADR-0030), #37 by the 3.0.0 `explain()` API
  (ADR-0031; `explainStream` remains tracked separately), #38 is closed by the 3.0.0 `bulkWrite` /
  `recursiveDelete` API (ADR-0032; collection-wide recursive delete remains tracked as #69), #39 is
  closed by the 3.0.0 `withMetadata` / `onSnapshotDetailed` API (ADR-0033; write metadata remains
  tracked as #72), and #40 is closed by the 3.0.0 `distinctValues` semantic-equality fix (ADR-0034;
  field-mask download optimization remains tracked as #75; server-side distinct remains #41).

> Amendment (3.0.0, issue #65): Core `explainStream` later shipped under ADR-0036 / #65 (see the
> Amendment block under Decision above). The References living-summary parenthetical for #37 is left
> as historically written; #65 was never an original `#35–#41` living-index item. Remaining deferral
> **#41** is unchanged.

> Amendment (3.0.0, issue #72): Write metadata later shipped under ADR-0037 / #72 (see the Amendment
> block under Decision above). The References living-summary parenthetical for #39 is left as
> historically written; #72 closes the remaining write-metadata half. Remaining deferral **#41** is
> unchanged.

> Amendment (3.0.0, issue #69): Collection-wide recursive delete later shipped under ADR-0038 / #69
> (see the Amendment block under Decision above). The References living-summary parenthetical for
> #38 is left as historically written; #69 closes the separately tracked collection-wide half.
> Remaining deferral **#41** is unchanged.
