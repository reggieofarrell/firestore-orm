# ADR-0036: Query `explainStream()` for Core queries

- **Status:** Accepted (v3.x, pending merge/release)
- **Date:** 2026-07-30
- **Deciders:** maintainer
- **Related:** [Issue #65](https://github.com/reggieofarrell/firestore-orm/issues/65),
  [ADR-0017](0017-v3-core-operations-scope.md), [ADR-0031](0031-query-explain.md),
  [`src/core/QueryBuilder.ts`](../../src/core/QueryBuilder.ts)

## Context

Issue #65 is the Core-only follow-up deferred from #37 / ADR-0031: wrap Admin SDK
`Query.explainStream` on the ORM query builders without claiming vector or Aggregate parity.

Constraints verified against `@google-cloud/firestore@8.6.0` / `firebase-admin@14.2.0` and the
Firestore emulator (plan probes P1 / P2):

- Core `Query.explainStream` exists at runtime (`typeof === 'function'`).
- **`VectorQuery.explainStream` is `undefined`** — no vector surface to wrap.
- `limitToLast(…).explainStream({ analyze: true })` throws synchronously:
  `Query results for queries that include limitToLast() constraints cannot be streamed. Use Query.explain() instead.`
  — the native message names the wrong wrapper contract.
- Emulator `explainStream({ analyze: true })` yields **document chunks without metrics** — a false
  green for diagnostics if callers treat the stream as proof of production plan/execution stats.
- SDK declaration returns non-generic `NodeJS.ReadableStream` with optional `document` / `metrics`
  chunks; `firebase-admin` still does not re-export named Explain types (same ADR-0031 D9 hazard).

## Decision

We will ship **`explainStream(options?)`** on **`FirestoreQueryBuilderBase`** only (inherited by
collection and collection-group builders):

1. **Return type** is derived `AsyncGenerator<QueryExplainStreamResult<R>>` where
   `QueryExplainStreamResult<R> = { readonly document?: R; readonly metrics?: ExplainMetrics }`.
   Document chunks are mapped through `toResult` (collection `{…data, id}` / group
   `{…data, id, path, parentPath}`). Metrics chunks forward the Admin SDK object by identity. Fields
   are optional because the SDK emits them separately; do not yield explicit `undefined` fields.
2. **Local `hasLimitToLast` guard** runs outside `try` / before opening the native stream, with a
   wrapper-correct message (`Use explain() instead`). Same first-iteration timing as `stream()`.
3. **Capability-check** `typeof query.explainStream === 'function'` outside `parseFirestoreError`,
   mirroring `explain()`'s upgrade-hint Error. Reuse private Query-derived `ExplainOptions` /
   `ExplainMetrics` aliases — no named Explain imports, no public undeclared `@google-cloud` names
   in published `.d.ts`.
4. **SDK stream errors** go through `parseFirestoreError`; local guards throw plain `Error`.
5. **No peer bump**, no Vector/Aggregate method, no production-metrics CI. Emulator integration
   asserts mapped documents + **absent** metrics; unit mocks own a metrics chunk.
6. **`explain()` is unchanged** — it still composes with `limitToLast` like `get()` (no local
   reject).

## Consequences

- Capability matrix: Core `explainStream` moves Deferred → Supported; vector remains negative
  (runtime method absent). Aggregate diagnostics stay deferred.
- Callers must not treat emulator streams as production diagnostics; docs/JSDoc warn explicitly.
- `#65` is **not** an original ADR-0017 `#35–#41` item — living-index footers that say remaining
  deferral `#41` stay unchanged; only an Amendment note is appended to ADR-0017 / ADR-0031.

## Alternatives considered

**Return the raw Node readable stream.** Rejected — leaks Admin `QueryDocumentSnapshot`s and drops
collection-group `path` / `parentPath` identity (plan T1).

**Add a VectorQueryBuilder method.** Rejected — `VectorQuery.explainStream` is undefined at runtime
(P1b); preserve the deliberate negative docs.

**Rely on the native limitToLast throw.** Rejected — delayed wrong contract message
(`Use Query.explain()`); local guard matches `stream()` and keeps the native spy untouched in tests.

**Require production-metrics CI before shipping.** Rejected — out of scope for #65; unit mocks +
emulator doc-mapping are the accepted confidence layer (same split as ADR-0031).

## References

- [Issue #65](https://github.com/reggieofarrell/firestore-orm/issues/65)
- [ADR-0031](0031-query-explain.md) (deferred `explainStream`; now amended)
- Probes: `docs/plans/issue-65-query-explain-stream/probes/sdk-surface.mjs`,
  `docs/plans/issue-65-query-explain-stream/probes/emulator-stream.mjs`
- Tests: `src/tests/unit/query-explain.unit.test.ts`,
  `src/tests/unit/queryBuilderBounds.unit.test.ts`,
  `src/tests/integration/query-explain.integration.test.ts`,
  `src/tests/types/query-explain.type-test.ts`
- Starlight: query builder reference, queries guide, scope & capabilities, migration v2→v3

This record **amends ADR-0017** and **ADR-0031**: Core `explainStream` is no longer deferred. The
remaining ADR-0017 deferral (**#41**) and the decision not to pursue full server-side or Enterprise
Pipeline parity are unchanged. (#65 is a separately tracked Core-only follow-up to #37, not an
original `#35–#41` living-index item; #72 write metadata has since shipped — see
[ADR-0037](0037-write-metadata-opt-in.md).)
