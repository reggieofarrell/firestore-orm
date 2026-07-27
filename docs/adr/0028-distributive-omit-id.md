# ADR-0028: Distributive `Omit<_, 'id'>` for union data models

- **Status:** Accepted (v3.x, pending merge/release)
- **Date:** 2026-07-26
- **Deciders:** maintainer
- **Related:** Issue [#54](https://github.com/reggieofarrell/firestore-orm/issues/54); amends
  [ADR-0018](0018-document-identity-and-data-model.md); pointer in
  [ADR-0024](0024-collection-group-queries.md); follow-up
  [#58](https://github.com/reggieofarrell/firestore-orm/issues/58)

## Context

Firestore query field paths, write payloads, and read-result types all strip the synthetic
repository `id` via `Omit<T, 'id'>`. `Omit` is defined through `keyof`, and `keyof (A | B)` is the
key **intersection** — only keys present on every union member survive. For a discriminated union
stored model such as `{ kind: 'a'; onlyOnA: string } | { kind: 'b'; onlyOnB: number }`, every
`FieldPaths<Omit<Union, 'id'>>` site collapsed to `"kind"` alone. Branch-specific paths (`onlyOnA`,
`onlyOnB`, nested paths) were compile errors even though Firestore stores and queries them normally.

This violated an existing contract: {@link PathValue} in `src/utils/pathTypes.ts` documents itself
as deliberately distributive "so it agrees with `FieldPaths`", while the `Omit` one level up broke
that agreement.

The same collapse affected:

- Query surfaces (`where`, `orderBy`, `select`, `whereFilter`, aggregations, `distinctValues`,
  collection-group and vector builders).
- Write inputs (`CreateInput`, `CreateOutput`, `UpdateInput`) — a union model was **not writable at
  all** before this change.
- {@link FirestoreDocument}, {@link DataOf}, and {@link StoredDataOf} — union read models did not
  narrow on discriminant checks.

`FirestoreRepository.withSchema` accepts only `ZodObject` schemas, so union stored models reach the
library through the directly-typed constructor or a union **read** model from a `readConverter`. The
bug is real for those paths but not through the documented primary `withSchema` constructor.

Inlining `T extends unknown ? Omit<T, 'id'> : never` at a use site does **not** distribute — a naked
type parameter is required at the application site.

## Decision

We will distribute `Omit<_, 'id'>` (and related identity helpers) over union members using three
composable type helpers and one construction seam.

1. **`OmitId<S>`** (`src/utils/pathTypes.ts`) — `S extends unknown ? Omit<S, 'id'> : never`. Applied
   at every `FieldPaths` / `NumericFieldPaths` / factory / aggregation-spec position that previously
   used `Omit<S, 'id'>`. Non-union models are byte-identical before and after.

2. **`KeysOf<T>`** — distributive `keyof` because `keyof OmitId<S>` re-collapses. Used at `keyof`
   constraint sites (`distinctValues`, `findNearest`, `FindNearestOptions`).

3. **`ValueAtKey<T, K>`** — distributive indexed access because widening only the `keyof` constraint
   while leaving `T[K]` as the return type silently degrades to `unknown[]` with zero compile
   errors.

   Composition rule for top-level keys: `KeysOf<OmitId<S>>`.

4. **`FirestoreDocument`** — now distributive
   (`ReadData extends unknown ? Omit<ReadData, 'id'> & { readonly id: ID } : never`). Internal
   construction uses {@link ConstructedDocument} plus {@link asFirestoreDocument} — a single
   documented cast — because a deferred conditional is not assignable from `{ ...data, id }` for
   unresolved generic `ReadData`.

5. **Write side (D1)** — `CreateInput`, `CreateOutput`, and `UpdateInput` distribute via the same
   `T extends unknown ? … : never` spelling (not `WithFieldValue<OmitId<T>>` — equivalent but the
   inline form passed the full gate). Cross-branch payloads stay rejected; sentinel contracts
   (ADR-0002, ADR-0004, ADR-0019) are unaffected.

6. **Public export (D3)** — export `OmitId` from `src/index.ts` for reusable `whereFilter` predicate
   annotations over union read models. `KeysOf` and `ValueAtKey` remain internal.

7. **`distinctValues`** — constraint is `KeysOf<OmitId<T>>`, not `FieldPaths`, deliberately:
   `FieldPaths` drops index signatures, which would **narrow** `distinctValues` on a
   `Record<string, unknown>` read model from "any string" to `never`. `KeysOf<OmitId<T>>` is purely
   widening for unions.

## Consequences

- Union stored/read models gain typed query paths, writable branch-specific payloads, and narrowing
  read results. Non-union models are unchanged.
- `FirestoreDocument`, `DataOf`, `StoredDataOf`, `CreateInput`, `CreateOutput`, and `UpdateInput`
  are now **conditional types** in the public `.d.ts`. A consumer's own conditional over one of
  those aliases could observe the difference (unverified against exotic consumers; `check:consumer`
  on `firebase-admin@^14` still passes).
- One trivial runtime export: `asFirestoreDocument` in `DocumentId.ts` (not in either coverage gate;
  exercised by every read).
- Type-only change — no behavioral runtime change except the identity helper.

### Known limitation (D2) — deferred to [#58](https://github.com/reggieofarrell/firestore-orm/issues/58)

`{ name: string } & Record<string, unknown>` still yields **no** typed paths after this change.
`OmitId` does not fix intersection flattening inside `Omit` (probe P6a/P6b — both `never`). A
path-only key-remapping helper can recover `"name"`, but using it in value positions strips index
signatures from `StoredDataOf`. Pinned by `union-model-paths.type-test.ts` (U-6).

## Alternatives considered

- **Query-only fix** — rejected: union models were not writable at all (P-W1).
- **Inline conditional at use sites** — rejected: does not distribute (T1).
- **`OmitId` in `keyof` positions** — rejected: re-collapses (T3).
- **Widen `distinctValues` constraint only** — rejected: silent `unknown[]` return (T2).
- **Fix index-signature collapse here** — rejected: different defect, needs a path-only helper;
  deferred to #58.
- **Export all three helpers** — rejected: no demonstrated consumer need for `KeysOf` /
  `ValueAtKey`.

## References

- Issue [#54](https://github.com/reggieofarrell/firestore-orm/issues/54)
- Follow-up [#58](https://github.com/reggieofarrell/firestore-orm/issues/58) (index-signature
  collapse)
- [ADR-0018](0018-document-identity-and-data-model.md) (identity and data-model split)
- [ADR-0024](0024-collection-group-queries.md) (`CollectionGroupDocument` distribution)
- [`src/utils/pathTypes.ts`](../../src/utils/pathTypes.ts),
  [`src/core/DocumentId.ts`](../../src/core/DocumentId.ts),
  [`src/core/Validation.ts`](../../src/core/Validation.ts),
  [`src/core/QueryBuilder.ts`](../../src/core/QueryBuilder.ts)
- Type tests:
  [`union-model-paths.type-test.ts`](../../src/tests/types/union-model-paths.type-test.ts),
  extensions to `write-types.type-test.ts` and `identity.type-test.ts`
- Probes: `tmp/probes/issue-54/` (left in place for review re-runs)
