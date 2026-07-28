# ADR-0027: Generic multi-aggregation via `aggregate(spec)`

- **Status:** Accepted (v3.x), pending merge/release
- **Date:** 2026-07-26
- **Deciders:** maintainer
- **Related:** ADR-0017 (amended — #34 leaves the deferred list), **ADR-0020** (null fidelity —
  `aggregate` follows the same `average` → `number | null` / `sum` → `?? 0` rule), ADR-0023
  (callback-factory precedent considered and rejected), ADR-0024 (base-class / collection-group
  surface — `aggregate` lives on `FirestoreQueryBuilderBase`),
  [issue #34](https://github.com/reggieofarrell/firestore-orm/issues/34),
  [issue #39](https://github.com/reggieofarrell/firestore-orm/issues/39) (still owns snapshot
  metadata / `readTime`)

## Context

Issue #34 asked for a generic Core `aggregate(spec)` that computes multiple aliased `count` / `sum`
/ `average` values in **one** aggregate request (one round trip for dashboards), keeping the
numeric-path typing already applied to `sum` / `average`.

Acceptance (verbatim): _count + total + average retrievable in a single request with typed aliases_.

Deferred by ADR-0017. Every backend / SDK / type claim below was produced by probing the Firestore
emulator with `@google-cloud/firestore@8.6.0`, reading the installed SDK source, and compiling
candidate type formulations with `tsc` — not from memory. Probe ids (`K3`, `M2`, `A1.6`, …) are
cited in the implementation plan under `tmp/plans/issue-34-generic-multi-aggregation.md`.

**Backend contract (probed):**

- 1–5 aggregations in one request succeed; 6+ reject with gRPC `code 3` ("maximum number of
  aggregations … is 5"). Empty `{}` rejects ("Aggregations can not be empty.").
- Arbitrary alias strings round-trip as own keys, including `Object.prototype` names (`constructor`,
  `toString`, …). Alias `'__proto__'` is fatal: the SDK's plain `{}` alias map hits the prototype
  setter and later `assert`s inside a stream `_transform` — an **uncatchable process crash**, not a
  rejected promise.
- Empty match set: `count: 0`, `sum: 0`, `average: null`. `sum` over non-numeric / absent fields
  yields `0`; `average` over non-numeric / absent yields `null`.
- `select()` + count-only is legal; `select()` + any `sum`/`average` is `code 3` ("Cannot apply
  property masks when aggregation fields are present.").
- `where` / `orderBy` / `limit` / `limitToLast` / cursors / `offset` all apply. Collection-group
  aggregations work under the same max-of-5.
- Peer floor `@google-cloud/firestore@7.9.0` already declares `Query.aggregate` /
  `AggregateField.count|sum|average` with the same nullability — **no peer bump**.

**Sparse-field intersection — UNVERIFIED against production:**

When a spec contains a `sum` or `average` over a field that only **some** matching documents carry,
the document set for the **whole request** collapses to documents that have that field. Verified on
the emulator (`K3`/`K5`/`K6`/`K8`): `{count, sum('sparse')}` with 4 docs / 1 sparse returns
`count: 1`, not 4. Mechanism matches `orderBy(field)` skipping docs missing that field. This is
**not** stated in Google's aggregation documentation (checked) and **cannot be verified from here
against production**. Follow the ADR-0026 T4 precedent: state the observation, state that production
was not verified, pin the emulator contract with an integration test that says so in a comment, and
do not encode a workaround that would break if production differs. Document loudly; recommend
aggregating required schema fields and issuing unconditioned `count()` separately when needed.
`NumericFieldPaths` correctly includes optional numeric fields — narrowing the type would hide a
legitimate sparse-field use case.

## Decision

1. **D1 — plain descriptor spec, not a callback factory.**

   ```ts
   await orderRepo.query().aggregate({
     orders: { kind: 'count' },
     revenue: { kind: 'sum', field: 'total' },
     avgOrder: { kind: 'average', field: 'total' },
   });
   ```

   Both shapes preserve numeric-path typing and the alias→result mapping. Descriptors won because
   the spec is **plain data**: a dashboard can build one from runtime configuration, and a widened
   `AggregationSpec<S>` still type-checks and degrades to the safe `number | null`. The
   `whereFilter(build => …)` callback (ADR-0023) exists because `Filter` objects must be produced by
   the SDK's `Filter` statics; here the ORM constructs `AggregateField` itself, so that precedent's
   motivation does not transfer.

2. **D2 — kind-aware `select()` guard on all four aggregation terminals.** Retrofit `sum()` /
   `average()` with a plain `if (hasSelect) throw`, and guard `aggregate()` only when the spec
   contains at least one `sum`/`average`. `count()` / `exists()` stay unguarded — count-only after
   `select()` is legal.

3. **Placement on `FirestoreQueryBuilderBase`.** Collection-group builders inherit `aggregate()` for
   free (ADR-0024's narrowing was about writes). `VectorQueryBuilder` has no aggregation surface and
   is unchanged.

4. **Three-branch `AggregationResult` mapping.** Literal specs narrow precisely (`count`/`sum` →
   `number`, `average` → `number | null`); a widened union falls through to safe `number | null`.
   Two simpler formulations either falsely narrow averages to `number` or falsely widen literal sums
   to `number | null` — both rejected after `tsc` probes.

5. **Type names avoid the SDK's `AggregateSpec` / `AggregateField`.** Public exports are
   `CountAggregation`, `SumAggregation`, `AverageAggregation`, `AggregationSpecEntry`,
   `AggregationSpec`, `AggregationResult`. The SDK's `AggregateField` is **not** re-exported — that
   would create a second, untyped way in.

6. **Runtime guards (plain `Error`, outside `parseFirestoreError`):** empty spec; alias
   `'__proto__'` (before any SDK call); kind-aware `select()` + field aggregation; **exhaustive
   `kind` check** so an unknown/missing kind from a runtime-built spec cannot silently become an
   `average`. Build the SDK spec and the returned object with `safeAssign`. Normalize `sum` with
   `?? 0`; pass `average` `null` through (ADR-0020).

7. **No local max-of-5 cap.** The backend already rejects with a precise message; a hard-coded cap
   silently becomes wrong if Google raises the limit. Document + pin with an integration test that
   only asserts rejection.

8. **Do not normalize gRPC `code 3` (`INVALID_ARGUMENT`) in `parseFirestoreError`.** Unchanged —
   query-authoring mistakes stay raw `Error` (same stance as composite-filter limit violations in
   ADR-0023). `ErrorParser.ts` is untouched by this change.

9. **Out of scope (each with reason):**
   - **Transactional aggregation** — the SDK supports `tx.get(aggregateQuery)`, but the query
     builder has zero `Transaction` surface today; adding one only for aggregations would be the
     first and only such path.
   - **`groupAggregate()`** — unrequested; the inherited query-aware `aggregate()` covers #34.
   - **`AggregateQuerySnapshot.readTime`** — issue #39 owns snapshot metadata.
   - **Refactoring `count`/`sum`/`average`/`exists` onto `aggregate()`** — they stay independent;
     equivalence is proven by an integration test, not a shared implementation.
   - **Peer dependency bump** — floor already sufficient.

## Consequences

- Dashboards can fetch count + sum + average in one round trip with typed aliases.
- Callers must read the sparse-field caveat: combining `count` with a sparse-field `sum`/`average`
  can silently shrink the counted set (emulator; production unverified).
- `select().sum()` / `select().average()` change from a raw backend `INVALID_ARGUMENT` to a clear
  local `Error` — not a breaking change (`Error` → `Error`).
- Public API gains six types + `aggregate()` on every query builder that extends the read base.
- Documented limitations remain: int64 precision above 2^53; `average !== sum/count` when
  non-numerics are present.

## Alternatives considered

**Callback factory `aggregate(a => ({ revenue: a.sum('total') }))`.** Rejected — see D1. Both shapes
were verified to preserve typing; plain data won for runtime-built dashboard specs.

**Blanket `if (hasSelect) throw` on `aggregate()`.** Rejected — breaks legal count-only after
`select()` (T4).

**Hard-code max 5.** Rejected — see Decision 7.

**Normalize `code 3` in `ErrorParser`.** Rejected — see Decision 8.

**Narrow `NumericFieldPaths` to exclude optional fields.** Rejected — the sparse-field hazard is a
documentation / guidance problem, not a type problem; optional numeric fields are legitimate.

## References

- [`src/core/QueryBuilder.ts`](../../src/core/QueryBuilder.ts) — types, `aggregate()`, D2 retrofit
  on `sum`/`average`, `assertNoSelectWithFieldAggregation`.
- [`src/index.ts`](../../src/index.ts) — six type exports.
- [`src/utils/safeObject.ts`](../../src/utils/safeObject.ts) — `safeAssign`.
- Tests: `src/tests/unit/query-aggregate.unit.test.ts`,
  `src/tests/integration/query-aggregate.integration.test.ts`,
  `src/tests/types/aggregate-spec.type-test.ts`.
- SDK: `@google-cloud/firestore` `build/src/reference/aggregate-query.js` (alias maps),
  `build/src/aggregate.js` (`avg` wire kind), `Query.aggregate` / `AggregateField` typings.
- Starlight: queries guide Aggregations, query-builder reference, scope & capabilities, performance,
  examples, migration guide.
- Plan / probes (maintainer-local): `tmp/plans/issue-34-generic-multi-aggregation.md`,
  `tmp/probes/issue-34/`.

This record **amends ADR-0017**: generic multi-aggregation is no longer deferred. The remaining
deferrals (#37–#41) and the decision not to pursue full server-side or Enterprise Pipeline parity
are unchanged. (#35 `getMany` and #36 typed bounds / `limitToLast` have since shipped — see
ADR-0029 / ADR-0030; this footer is a living index of remaining ADR-0017 deferrals — see
[`docs/adr/README.md`](README.md) Conventions.)
