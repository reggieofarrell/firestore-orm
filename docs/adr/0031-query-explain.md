# ADR-0031: Query Explain (`explain()` for Core and vector)

- **Status:** Accepted (v3.x, pending merge/release)
- **Date:** 2026-07-28
- **Deciders:** maintainer
- **Related:** [Issue #37](https://github.com/reggieofarrell/firestore-orm/issues/37),
  [ADR-0017](0017-v3-core-operations-scope.md),
  [`src/core/QueryBuilder.ts`](../../src/core/QueryBuilder.ts),
  [`src/vector/VectorQueryBuilder.ts`](../../src/vector/VectorQueryBuilder.ts)

## Context

Issue #37 asks for Admin SDK Query Explain on normal and vector queries so plan summaries /
execution stats are retrievable without pretending the result is an ORM document page alone.

Constraints verified against `@google-cloud/firestore@8.6.0` / `firebase-admin@14.2.0` and the
Firestore emulator:

- Core `Query.explain` / `explainStream` exist at runtime; `VectorQuery.explain` exists but
  **`explainStream` does not** on VectorQuery.
- The emulator **never** returns explain metrics — the SDK throws `Error: No explain results` for
  plan and analyze modes (Core, vector, and AggregateQuery).
- Emulator `explainStream({analyze:true})` yields document chunks **without** metrics — a false
  green for diagnostics.
- gcloud `firestore.d.ts` omits `VectorQuery.explain` even though it exists at runtime — a local
  optional widen is required.
- `firebase-admin/firestore` does **not** re-export `ExplainOptions` / `ExplainMetrics` by name
  (explicit allowlist → TS2305); `Query` is re-exported and its `.explain` signature is typed.
- `@google-cloud/firestore` is not a direct package dependency — importing Explain\* from it in
  published `.d.ts` is a pnpm hazard.
- `admin@12` can still resolve firestore `<7.4` (Explain landed in 7.4; VectorQuery profiling in
  7.8). Vector `findNearest` already requires firestore `>= 7.10`.

## Decision

We will ship **`explain()` only** (not `explainStream`) on:

1. **`FirestoreQueryBuilderBase`** — so collection and collection-group builders inherit it.
2. **`VectorQueryBuilder`** — after `findNearest()` only.

Return type is **`QueryExplainResult<R> = { metrics: ExplainMetrics; documents: R[] | null }`**:

- `metrics` is the Admin SDK metrics object.
- `documents` is ORM-mapped via `toResult` (collection / group) or the vector `get()` mapper when
  analyze executed; **`null`** for plan-only (SDK snapshot null); **`[]`** for analyze with zero
  matches. Never coerce empty ↔ null.
- Local type aliases derive `ExplainOptions` / `ExplainMetrics` from `Query['explain']` — not
  imported from `firebase-admin/firestore` or `@google-cloud/firestore`. Not public re-exports.
- `QueryExplainResult` is exported from the package root **and** re-exported from `/vector`.
- Capability-check `typeof query.explain === 'function'` on Core; defense-in-depth typeof on vector
  even though `findNearest` already implies firestore `>= 7.10`. Do not bump the `firebase-admin`
  peer range.
- SDK errors go through `parseFirestoreError`; local guards throw plain `Error` outside the try. Do
  **not** teach `ErrorParser` a mapping for `"No explain results"`.
- `explain()` composes with `limitToLast` like `get()` (no local reject). Emulator integration
  asserts the known throw; unit mocks own the success path. Real metrics require production
  Firestore.
- **Out of scope:** `explainStream` (Core-only follow-up), `AggregateQuery.explain`, peer bump,
  production CI smoke.

## Consequences

- Capability matrix: #37 `explain()` moves Deferred → Supported; Deferred row becomes
  `explainStream` only (follow-up issue).
- Remaining ADR-0017 deferrals are `#40–#41` (#39 snapshot read metadata / detailed listeners have
  since shipped — see ADR-0033).
- Callers must use production Firestore for real plan/execution stats; docs and JSDoc warn about the
  emulator throw.
- Follow-up for `explainStream` must add a local `hasLimitToLast` guard (SDK stream throws for
  `LimitType.Last`), unlike `explain()`.

## Alternatives considered

**Return raw SDK `ExplainResults` / `QuerySnapshot`.** Rejected — leaves callers holding Admin
snapshots instead of ORM `R`, fighting every other terminal (owner F2:B).

**Ship `explainStream` in the same PR.** Rejected — VectorQuery has no stream API; emulator stream
is a false-green for diagnostics; acceptance is satisfied by `explain()` alone.

**Wrap `AggregateQuery.explain`.** Rejected — expands past “Core and vector” document queries;
escape hatch remains `query.aggregate(…).explain()` on the raw SDK.

**Production CI smoke for metrics.** Rejected — needs credentials/cost; repo CI is emulator-only.

**Import Explain\* from `@google-cloud/firestore`.** Rejected — undeclared package for published
`.d.ts` under pnpm; D9 aliases from `Query` are sufficient.

## References

- [Issue #37](https://github.com/reggieofarrell/firestore-orm/issues/37)
- [Firebase Query Explain](https://firebase.google.com/docs/firestore/query-explain)
- Probes (historical, maintained during #37 planning): Admin SDK surface P1–P8 against
  `@google-cloud/firestore@8.6.0` / emulator — Core+vector `explain` throw `No explain results`;
  VectorQuery.explain absent from d.ts; firebase-admin omits Explain\* allowlist names; emulator
  `explainStream` yields docs without metrics.
- Tests: `src/tests/unit/query-explain.unit.test.ts`,
  `src/tests/integration/query-explain.integration.test.ts`,
  `src/tests/types/query-explain.type-test.ts`
- Starlight: scope & capabilities, query builder reference, queries guide, vector-search, migration
- Follow-up: [#65](https://github.com/reggieofarrell/firestore-orm/issues/65) (`explainStream`)

This record **amends ADR-0017**: Query Explain (`explain()`) is no longer deferred. The remaining
deferrals (#40–#41) and the decision not to pursue full server-side or Enterprise Pipeline parity
are unchanged. (#37 `explain()` has since shipped — see this ADR; #38 `bulkWrite` /
`recursiveDelete` have since shipped — see ADR-0032; #39 snapshot read metadata / detailed listeners
have since shipped — see ADR-0033; `explainStream` is tracked separately as
[#65](https://github.com/reggieofarrell/firestore-orm/issues/65). This footer is a living index of
remaining ADR-0017 deferrals — see [`docs/adr/README.md`](README.md) Conventions.)
