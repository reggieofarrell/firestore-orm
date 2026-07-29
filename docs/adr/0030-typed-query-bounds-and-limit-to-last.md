# ADR-0030: Typed query bounds, `offset`, and `limitToLast`

- **Status:** Accepted (v3.x, pending merge/release)
- **Date:** 2026-07-28
- **Deciders:** maintainer
- **Related:** [Issue #36](https://github.com/reggieofarrell/firestore-orm/issues/36),
  [ADR-0017](0017-v3-core-operations-scope.md), [ADR-0001](0001-fork-and-2.0.0-rearchitecture.md),
  [ADR-0024](0024-collection-group-queries.md), [ADR-0027](0027-generic-multi-aggregation.md),
  [ADR-0018](0018-document-identity-and-data-model.md)

## Context

Issue #36 asks for typed lower-level cursor bounds (`startAt` / `startAfter` / `endAt` /
`endBefore`), `offset`, and `limitToLast` alongside the existing opaque `paginate` helper, with
acceptance: **bounded ranges, inclusive cursors, and reverse pagination available and guarded.**
`limitToLast` must require `orderBy` and be rejected by native `stream()`. The issue also
"considers" cursor tokens that encode ordered field values (not only a document path).

Emulator probes against `@google-cloud/firestore@8.6.0` / `firebase-admin@14.2.0` established:

- Field-value and `DocumentSnapshot` overloads for inclusive/exclusive bounds and bounded ranges.
- `limitToLast` returns the last _N_ docs still in `orderBy` order; `endAt` + `limitToLast` is the
  reverse-page pattern.
- `stream()` rejects `limitToLast`; `onSnapshot` does **not**.
- `limit` / `limitToLast` are SDK last-wins.
- Opaque `paginate` applies `.limit(pageSize+1)`, which would silently override `limitToLast`.
- Collection-group foreign **typed** snapshots are accepted and use the snap's `orderBy` field
  values as the cursor (empty when those values fall past the set, or a suffix otherwise) —
  membership is **not** checked. Single-collection foreign snapshots throw. ADR-0024's older claim
  that foreign `startAfter` "succeeds silently and returns the whole result set" is **stale on this
  emulator** for those cases (opaque `paginate` still binds cursors by collection id / group
  membership for forged tokens).

No peer bump is required — these Admin SDK APIs exist on the supported peer floor.

## Decision

We will ship typed bounds and `limitToLast` as follows:

1. **Opaque `paginate` tokens stay path-only** (base64url `{ path }`). Field values are arguments to
   the new bound methods, not a token-format change. Evolving tokens would break projected
   pagination (cursor re-fetches a full snapshot by path) and weaken path membership binding.
2. **`startAt` / `startAfter` / `endAt` / `endBefore`** live on `FirestoreQueryBuilderBase` with
   SDK-matching overloads: `(snapshot: DocumentSnapshot)` and `(...fieldValues: unknown[])`. Field
   values follow the stored-shape rule (same as `where`).
3. **`offset(n)`** is public on the base; `n` must be a non-negative finite integer (`0` allowed).
   Sets `hasOffset`. **`paginate()`** and **`offsetPaginate()`** reject when `hasOffset` (caller
   offset re-applies after page cursors / desyncs `count` totals). `offsetPaginate` itself is
   unchanged for callers that never chain a prior `offset()`.
4. **`limitToLast(n)`** requires `hasOrderBy` (local `Error`), sets `hasLimitToLast`, and validates
   non-negative `n`. **`stream()`**, **`paginate()`**, and **`offsetPaginate()`** reject when
   `hasLimitToLast`. **`onSnapshot` is not rejected.** **`getOne()` / `exists()`** skip their
   `.limit(1)` narrowing when `hasLimitToLast` so last-wins does not pull a document from outside
   the last-N window (or report existence for `limitToLast(0)`).
5. **`limit()` after `limitToLast()` clears `hasLimitToLast`** (and the reverse sets it) so guards
   track SDK last-wins.
6. **Both `select()` implementations** (collection + group) copy `hasLimitToLast` and `hasOffset`
   onto the replacement builder.
7. **No snapshot membership checks** on typed bounds — mirror SDK errors; opaque `paginate` binding
   unchanged.
8. **`VectorQueryBuilder` unchanged** (it already rejects `orderBy`, which `limitToLast` requires).
   No new `src/index.ts` exports.
9. Local guards throw plain `Error` **outside** `parseFirestoreError` for `stream` (and inside the
   existing `paginate` try/catch pattern, which preserves plain `Error`). No new `ErrorParser`
   mappings.

## Consequences

- **Reverse pagination** is `orderBy(...).endAt(cursor).limitToLast(pageSize).get()` (or snapshot /
  field-value equivalents). Forward opaque paging stays `paginate` / `paginateWithCount`.
- Combining `paginate` / `offsetPaginate` / `stream` with `limitToLast` throws locally instead of
  silently producing a forward page or an opaque SDK stream failure.
- Combining `paginate` / `offsetPaginate` with a prior `offset()` throws locally instead of silently
  losing page documents or desyncing `total` from `items`.
- `getOne()` / `exists()` after `limitToLast` observe the last-N window (no `.limit(1)` override).
- Collection and collection-group builders share the surface; vector queries do not gain bounds.
- Passing a `DocumentReference` as a field-value bound against a non–document-id `orderBy` can
  silently yield an empty result (SDK footgun) — documented in JSDoc; prefer snapshots or scalars.
- Foreign typed snapshot bounds are **not** membership-checked (D7). Emulator pins in
  `query-bounds.integration.test.ts`: single-collection foreign `startAfter` throws (F7);
  collection-group foreign snapshots are accepted and use the snap's `orderBy` field values as the
  cursor (empty when those values fall past the set — probe F2 — or a suffix otherwise). Opaque
  `paginate` path membership binding is unchanged and separately tested. Production may still differ
  — do not treat emulator pins as production equivalence.
- Capability matrix: #36 moves Deferred → Supported. Remaining ADR-0017 deferrals are `#41` (#37
  `explain()`, #38 `bulkWrite` / `recursiveDelete`, #39 snapshot read metadata / detailed listeners,
  and #40 `distinctValues` semantic equality have since shipped — see ADR-0031 / ADR-0032 / ADR-0033
  / ADR-0034).

## Alternatives considered

**Encode ordered field values in opaque `paginate` tokens.** Rejected — breaks projected pagination
and the path membership security model; the issue asks for typed bounds _alongside_ the helper.

**Type field values from prior `orderBy` generics.** Rejected — large unrequested generic change;
`unknown` matches `where`.

**Apply `assertCursorBelongsToSource` to every typed snapshot bound.** Rejected — extra I/O policy
not requested; blocks legitimate same-group cross-parent cursors the SDK accepts.

**Reject `onSnapshot` after `limitToLast`.** Rejected — listeners work with `limitToLast` in the
SDK; only `stream` is forbidden.

**Rely only on SDK errors for `orderBy` / `stream` / negative offset.** Rejected — the issue
requires guarded `stream` rejection; local checks match `paginate`'s voice and fail before an RPC.

## References

- [Issue #36](https://github.com/reggieofarrell/firestore-orm/issues/36)
- [`src/core/QueryBuilder.ts`](../../src/core/QueryBuilder.ts) — bounds, `offset`, `limitToLast`,
  guards, `select` flag copy
- [`src/core/CollectionGroup.ts`](../../src/core/CollectionGroup.ts) — group `select` flag copy
- Tests: `src/tests/integration/query-bounds.integration.test.ts`,
  `src/tests/unit/queryBuilderBounds.unit.test.ts`, `src/tests/types/query-bounds.type-test.ts`
- Starlight: query builder reference, queries guide, subcollections, scope & capabilities

This record **amends ADR-0017**: typed lower-level bounds + `limitToLast` are no longer deferred.
The remaining deferrals (#41) and the decision not to pursue full server-side or Enterprise Pipeline
parity are unchanged. (#37 `explain()`, #38 `bulkWrite` / `recursiveDelete`, and #39 snapshot read
metadata / detailed listeners have since shipped — see ADR-0031 / ADR-0032 / ADR-0033; #40
`distinctValues` semantic equality has since shipped — see ADR-0034; this footer is a living index
of remaining ADR-0017 deferrals — see [`docs/adr/README.md`](README.md) Conventions.)
