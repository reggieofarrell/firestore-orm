# ADR-0020: Aggregate null fidelity — `average` returns `number | null`

- **Status:** Accepted (v3) — implemented in the Track B hardening series
- **Date:** 2026-07-21
- **Deciders:** Reggie O'Farrell
- **Related:** the v3 pre-release codebase review (maintainer-local, finding B9); issue
  [#34](https://github.com/reggieofarrell/firestore-orm/issues/34);
  [`src/core/QueryBuilder.ts`](../../src/core/QueryBuilder.ts).

## Context

`QueryBuilder.average` normalizes Firestore's result with `?? 0` and is typed to return `number`.
Firestore returns `null` for an average when there are no numeric values to average, and the Admin
SDK types `AggregateField.average` as `number | null`. Collapsing `null → 0` conflates two different
facts — "the average is 0" versus "there were no numeric values" — and the return type hides the
distinction from callers. `sum` is different: the SDK types it as a non-nullable `number`, and the
sum of an empty set is the identity `0`, so its `?? 0` normalization is correct and should stay.

## Decision

- `average` returns `number | null` and returns the SDK value directly (drop the `?? 0`), so a
  genuine "no numeric values" result surfaces as `null`.
- `sum` is unchanged (`number`, empty → `0`).

## Consequences

- Callers get the native, honest aggregate; a `null` average is distinguishable from a zero average.
- **Breaking (type-level):** `average`'s return type changes from `number` to `number | null`;
  callers that assumed non-null must handle `null`. The integration test that asserted an
  empty-average of `0` is updated to expect `null`.
- Scoped to `average` only; leaves the documented structured-value/`distinctValues` limitations to
  their own fix (also B9: `distinctValues` preserves `null`).

## Alternatives considered

- **Keep `?? 0`.** Rejected: it invents data and is the defect under review.
- **Return `null` for `sum` too.** Rejected: the SDK types `sum` non-nullable and `0` is the correct
  empty-sum identity.

## References

- [`src/core/QueryBuilder.ts`](../../src/core/QueryBuilder.ts) — `average`, `sum`.
- Admin SDK `AggregateField.average` / `AggregateField.sum` typings (`@google-cloud/firestore`).
