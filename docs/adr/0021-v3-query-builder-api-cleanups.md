# ADR-0021: v3 query-builder and packaging API cleanups

- **Status:** Accepted (v3) — implementing on branch `v3-release-hardening-part-2`
- **Date:** 2026-07-21
- **Deciders:** Reggie O'Farrell
- **Related:** the v3 pre-release codebase review (maintainer-local; decisions D4, D7, D11, D13,
  D14); [`src/core/QueryBuilder.ts`](../../src/core/QueryBuilder.ts),
  [`src/vector/withVectorSearch.ts`](../../src/vector/withVectorSearch.ts),
  [`src/core/FirestoreRepository.ts`](../../src/core/FirestoreRepository.ts),
  [`tsconfig.json`](../../tsconfig.json).

## Context

The pre-release review surfaced four small public-contract cleanups that are each breaking or
public-surface-affecting, so they are cheapest to make in the v3 window and are grouped here rather
than spread across four micro-ADRs:

- **D4** — `withVectorSearch` _replaces_ `query()` with a restricted `VectorQueryBuilder`, so a
  capability wrapper silently removes normal query behavior instead of adding to it.
- **D7** — `updateInTransaction` accepts an `UpdateOptions` bag that includes `returnDoc`, which a
  transaction cannot honor and which is silently ignored.
- **D11** — `QueryBuilder.totalCount()` counts the base collection and ignores the builder's `where`
  clauses — surprising for a terminal on a query builder.
- **D13/D14** — `tsconfig.json` sets `removeComments: true` (stripping public JSDoc from the emitted
  `.d.ts`, degrading editor tooltips) and has no `stripInternal`, so the `@internal`
  `getUnderlyingQuery()` ships in the public declarations.

## Decision

- **D4 — add `vectorQuery()`, keep `query()` normal.** `withVectorSearch` no longer overrides
  `query()`; it adds a `vectorQuery()` entry point returning the `VectorQueryBuilder`. A capability
  wrapper now _adds_ a feature without replacing core behavior.
- **D7 — narrow the transaction option type.** `updateInTransaction` takes its own
  `{ merge?: boolean }` options (no `returnDoc`), matching `createInTransaction`, which already
  excludes it. No runtime change (it only ever read `merge`).
- **D11 — rename `totalCount()` → `collectionCount()`.** The name now signals that it counts the
  whole collection, ignoring the builder's filters; `count()` remains the single query-aware
  aggregation.
- **D13/D14 — declaration hygiene.** Set `removeComments: false` and add `stripInternal: true` in
  `tsconfig.json` (propagates to `tsconfig.cjs.json`, which extends it). Public JSDoc reaches
  consumers' editors; the single `@internal` member (`getUnderlyingQuery`) is excluded from the
  emitted `.d.ts` — co-solving D13. `stripInternal` acts on the `@internal` tag independently of
  `removeComments`.

## Consequences

- **Breaking:** `withVectorSearch(repo).query()` now returns the normal builder (use `vectorQuery()`
  for vector search); `totalCount()` callers rename to `collectionCount()`; `updateInTransaction` no
  longer type-accepts `returnDoc` (it never worked). All are documented in the v3 migration guide.
- **Non-breaking / additive:** restored JSDoc in `.d.ts`; the cross-module `getQueryRef` bridge that
  the vector subpath uses is a module-level function, unaffected by stripping the `@internal`
  method.
- Slightly larger `.d.ts` output (comments retained) — negligible for a types-only artifact and a
  net DX win.

## Alternatives considered

- **Keep `totalCount()` and only document the caveat.** Rejected: the name is the surprise; a rename
  is the honest fix and v3 is the window.
- **Couple `stripInternal` to keeping `removeComments: true`.** Rejected: that would keep JSDoc out
  of the `.d.ts` (D14's whole point); `stripInternal` works regardless of the comment setting.

## References

- [`src/core/QueryBuilder.ts`](../../src/core/QueryBuilder.ts),
  [`src/vector/withVectorSearch.ts`](../../src/vector/withVectorSearch.ts),
  [`src/core/FirestoreRepository.ts`](../../src/core/FirestoreRepository.ts),
  [`tsconfig.json`](../../tsconfig.json).
