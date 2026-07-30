# ADR-0034: `distinctValues` Firestore-aware semantic equality

- **Status:** Accepted (v3.x, pending merge/release)
- **Date:** 2026-07-29
- **Deciders:** maintainer
- **Related:** [Issue #40](https://github.com/reggieofarrell/firestore-orm/issues/40),
  [Follow-up #75](https://github.com/reggieofarrell/firestore-orm/issues/75) (field-mask download
  optimization), [Issue #41](https://github.com/reggieofarrell/firestore-orm/issues/41) (server-side
  / Pipeline distinct), [Follow-up #76](https://github.com/reggieofarrell/firestore-orm/issues/76)
  (pin `VectorValue` equality on the decoded read path),
  [Follow-up #77](https://github.com/reggieofarrell/firestore-orm/issues/77) (memoize `canonicalize`
  on shared-subtree DAGs), [ADR-0017](0017-v3-core-operations-scope.md) (amended — #40 leaves the
  deferred list), [ADR-0020](0020-aggregate-null-fidelity.md) (`null` vs `undefined` fidelity),
  [`src/utils/firestoreValueEquality.ts`](../../src/utils/firestoreValueEquality.ts),
  [`src/core/QueryBuilder.ts`](../../src/core/QueryBuilder.ts)

## Context

Issue #40 reported that `distinctValues()` is client-side and that a JavaScript `Set` dedupes
structured values by **reference identity**. Deferred by ADR-0017 as part of the parity backlog.

Firestore Core has **no** server-side `DISTINCT` (only the pre-GA Enterprise Pipeline model, tracked
as #41). The method already downloaded matching documents and deduped in process; the defect was
that two structurally identical maps — or two `Timestamp`s naming the same instant — were reported
as separate values. Firestore's own value equality is structural (maps are unordered key/value sets;
references compare by resource path), so identity dedupe contradicted the method's contract for
every non-scalar type. Measured against the baseline: a `Set` was wrong on 9 of 27 structured /
reference / BigInt cases.

A field-mask / `select(field)` projection to cut download size is a separate concern: the terminal
reads the field as a literal top-level key (`doc.data()[field]`), so handing that string to
`select()` would reinterpret dotted model keys as nested paths — a silent behavior change. That
optimization is tracked as [#75](https://github.com/reggieofarrell/firestore-orm/issues/75).

## Decision

We will dedupe `distinctValues()` by a **Firestore-aware canonical key**, default-on, with the
signature, constraint, and return type unchanged.

1. **Canonical key, not pairwise deep equality.** Pairwise comparison is O(n²) over an already-
   downloaded page. Each value is canonicalized into a JSON-serializable type-tagged tree; dedupe is
   O(n) on `JSON.stringify` of that tree, keeping the first value seen for each key.
2. **Nested tagged tree, not a delimiter join.** A hand-rolled delimiter encoding silently merges
   `['a','b']` with `['a,s:b']` and `{'a=s:x,b':1}` with `{a:'x',b:1}` — no throw, just a short
   distinct list. Letting `JSON.stringify` own quoting closes that injection class.
3. **References key by `.path`, not `DocumentReference.isEqual`.** `isEqual` also compares the
   attached converter, so the same path read through a converted vs unconverted reference is
   reported unequal. Firestore's own reference equality is the resource path.
4. **Never over-merge.** Recognized Firestore types plus plain objects / arrays / primitives /
   `Date` dedupe semantically. Anything unrecognized (`Map`, `Set`, a custom class a `readConverter`
   returned) falls back to per-instance identity — today's behavior. Over-merging silently drops a
   caller's distinct values; under-merging is safe. No Firestore value class has `Object.prototype`,
   so a failed nominal `instanceof` degrades to identity rather than to the plain-object branch.
5. **Cycle and depth bounds.** A per-path `seen` set and a `MAX_DEPTH` ceiling emit terminal markers
   instead of recursing. That bounds _recursion depth_ (no stack overflow on cyclic or over-deep
   input); the worst merge case is values that agree down to the bound. It does **not** bound
   memory: converter output that reuses one shared subtree under many keys (an acyclic
   shared-subtree DAG) can still exhaust heap, because the canonical form is fully expanded and the
   path-scoped `seen` set correctly treats that sharing as a DAG rather than a cycle. Stored
   Firestore data cannot trigger this (`doc.data()` builds fresh unshared objects; nesting is capped
   at 20). A `WeakMap` memoization that would make the walk linear in distinct nodes is a follow-up
   (#77), not this ADR's change.
6. **Still client-side.** No field-mask projection (#75); server-side / Pipeline distinct stays with
   #41. The method remains documented as downloading matching documents and deduping in process.
7. **Fidelity from ADR-0020.** Drops only `undefined` (absent field); preserves stored `null`.
   `NaN`/`NaN` and `0`/`-0` keep merging (SameValueZero / Firestore total ordering). Nested
   `undefined` stays tagged apart from nested `null`.

Logic lives in the internal util `src/utils/firestoreValueEquality.ts` (not a public export);
`QueryBuilder.distinctValues` becomes a one-line call. The util is owned by the unit coverage gate.

## Consequences

- Structured and reference field values now dedupe the way Firestore equality implies.
- Scalar fields — the only usage the previous JSDoc sanctioned — are byte-for-byte identical,
  including `NaN` / `-0` merging.
- Converter authors who return unrecognized instances keep today's per-instance identity behavior;
  equal `Date`s merge.
- Download size is unchanged; #75 tracks an optional field-mask follow-up.
- Server-side distinct remains #41.

## Alternatives considered

**Document-only, no code change.** Rejected: Core has no server-side `DISTINCT`, so this collapses
to prose the JSDoc already carried; the acceptance line would not be met.

**Opt-in via `distinctValues(field, { equality })`.** Rejected: adds a public options type to ship a
fidelity fix as opt-in. ADR-0020 / ADR-0028 ship fidelity as the default; 3.0.0 is unreleased.

**Inline the walker in `QueryBuilder.ts`.** Rejected: `src/utils/**` is unit-gated; a branch-heavy
walker needs exhaustive unit coverage without emulator round-trips per branch.

**`isEqual`-based pairwise comparison.** Rejected: O(n²), and `DocumentReference.isEqual` is
converter-sensitive.

**Delimiter-joined canonical key.** Rejected: measured silent over-merges on injection pairs.

## References

- [Issue #40](https://github.com/reggieofarrell/firestore-orm/issues/40)
- [Follow-up #75](https://github.com/reggieofarrell/firestore-orm/issues/75) (field-mask download
  optimization)
- [Issue #41](https://github.com/reggieofarrell/firestore-orm/issues/41) (server-side / Pipeline
  distinct)
- [Follow-up #76](https://github.com/reggieofarrell/firestore-orm/issues/76) (pin `VectorValue`
  equality on the decoded read path)
- [Follow-up #77](https://github.com/reggieofarrell/firestore-orm/issues/77) (memoize `canonicalize`
  on shared-subtree DAGs)
- Implementation: `src/utils/firestoreValueEquality.ts`, `src/core/QueryBuilder.ts`
- Tests: `src/tests/unit/firestoreValueEquality.unit.test.ts`,
  `src/tests/unit/queryBuilderTerminals.unit.test.ts`,
  `src/tests/integration/repository-query-builder.integration.test.ts`,
  `src/tests/integration/repository-collection-group.integration.test.ts`,
  `src/tests/integration/repository-read-only-converter.integration.test.ts`
- [ADR-0017](0017-v3-core-operations-scope.md), [ADR-0020](0020-aggregate-null-fidelity.md)
- Plan / probes: `docs/plans/issue-40-distinct-values-semantic-equality/`

This record **amends ADR-0017**: `distinctValues` Firestore-aware semantic equality is no longer
deferred. The remaining deferral (#41) and the decision not to pursue full server-side or Enterprise
Pipeline parity are unchanged. (#40 client-side semantic equality has since shipped — see this ADR;
#72 write metadata has since shipped — see [ADR-0037](0037-write-metadata-opt-in.md); server-side
distinct remains [#41](https://github.com/reggieofarrell/firestore-orm/issues/41). This footer is a
living index of remaining ADR-0017 deferrals — see [`docs/adr/README.md`](README.md) Conventions.)
