# ADR-0023: Composite AND/OR filters via a schema-aware filter factory (`whereFilter`)

- **Status:** Accepted (v3)
- **Date:** 2026-07-24
- **Deciders:** Reggie O'Farrell
- **Related:** ADR-0017 (v3 Core-operations scope — amended by this record), ADR-0018 (document
  identity and the read/write/stored data-model split), ADR-0021 (v3 query-builder API cleanups);
  issue #30; [`src/core/QueryBuilder.ts`](../../src/core/QueryBuilder.ts),
  [`src/vector/VectorQueryBuilder.ts`](../../src/vector/VectorQueryBuilder.ts),
  [`src/index.ts`](../../src/index.ts),
  [`scripts/check-coverage-gates.mjs`](../../scripts/check-coverage-gates.mjs).

## Context

Chained `where()` clauses are an implicit top-level **AND**, so the builder could not express a
disjunction at all. Firestore has supported `Filter.and(...)` / `Filter.or(...)` since
`@google-cloud/firestore` 6.6, and ADR-0017 deferred wrapping them as issue #30.

Two properties of the SDK surface shape the design:

1. **`Filter`'s statics are untyped against the repository model.**
   `Filter.where(fieldPath, op, value)` takes `string | FieldPath`, so composing filters from the
   raw SDK forfeits both the schema-aware field paths ADR-0018 established
   (`FieldPaths<StoredData>`, with query operand values deliberately left `unknown`) and the
   validated document-id boundary that `whereId()` applies.
2. **An empty composite filter is silently dropped, not rejected.** `Filter.or()` with no arguments
   builds a `CompositeFilter` with zero conditions; `Query._parseCompositeFilter` discards
   sub-filters that reduce to nothing at any depth, and `Query.where()` then returns the query
   **unchanged** ("Return the existing query if not adding any more filters"). Verified against the
   emulator: a query filtered by `Filter.or()` returns **every document in the collection**. A
   dynamically built group (`f.or(...conditions.map(...))` over an empty list) therefore widens a
   query instead of failing — the same silent-broadening class as the `distanceThreshold: 0` defect
   in issue #42.

A third property constrains the type-level contract: `Filter` is an abstract class whose only
members are **static**, so its instance type is structurally empty (`{}`) and every non-nullish
value is assignable to it. No signature can make the compiler reject a callback that returns a
non-filter. (The same emptiness is why putting `Filter` in the public surface carries no
cross-version assignability risk — there are no instance members to mismatch.)

## Decision

Add **`whereFilter(build)`** to `FirestoreQueryBuilder` (and, as a pre-`findNearest()` prefilter, to
`VectorQueryBuilder`), taking a callback whose argument is a schema-aware `QueryFilterFactory<S>`
rather than accepting a raw SDK `Filter` argument:

```ts
whereFilter(build: (f: QueryFilterFactory<Omit<S, 'id'>>) => Filter): this
```

1. **A callback factory, not a `Filter` parameter.** The factory is the only thing that can make
   nested field paths schema-aware — `f.where` carries `FieldPaths<Omit<S, 'id'>> | FieldPath` at
   every nesting depth — and it is what routes `f.whereId` through `validateDocumentId()` with the
   builder's `allowLegacyDatastoreIds` setting. A `Filter`-valued parameter would have neither. The
   factory is stateless and returns plain SDK `Filter` values, so a group can be extracted into a
   reusable, typed predicate.
2. **A separate method, not a `where()` overload.** Matches the precedent of `whereId` as an
   explicit sibling rather than an overload of `where`, and keeps overload-resolution diagnostics
   legible.
3. **Zero-argument `f.and()` / `f.or()` are rejected locally**, at the construction site, with an
   error that names the method and explains the silent-broadening it prevents. `whereFilter` also
   rejects a filter that reduces to no conditions **entirely** by testing whether `Query.where()`
   returned the query unchanged — an exact, internals-free check, which fails open if a future SDK
   stops returning `this`. Its scope is deliberately narrow and stated as such: it does **not**
   catch a _partially_ empty prebuilt filter. `_parseCompositeFilter` drops empty sub-groups at any
   depth, so `Filter.or(Filter.and(), x)` silently becomes `x` (narrowing what should match
   everything) and `Filter.and(Filter.or(), x)` also becomes `x` (widening what should match
   nothing) — both verified, and both produce a new query object, so reference equality cannot see
   them. The factory's construction-site guard is an **arity** check, so it closes this only when
   every child was also factory-built — an SDK-built empty group passed _into_ `f.or(...)` has arity
   1 and sails through, then gets dropped exactly the same way (verified: `f.or(Filter.and(), x)`
   narrows to `x`, `f.and(Filter.or(), x)` widens to `x`). Tightening that would mean reading
   `_getFilters()`, an `@internal` SDK API this codebase avoids elsewhere, so the residue is
   documented on the website and pinned by integration tests instead of guarded.
4. **The callback result is validated with `instanceof Filter`, for diagnostics.** The compiler
   cannot reject a non-filter (see Context). The SDK is not silent about it either — measured
   against a real `Query`, the field-path overload rejects every non-filter value (`'status'` →
   `Value for argument "opStr" is invalid`; `{}` / `42` / `null` / an array →
   `not a valid field path`; `undefined` → `The path cannot be omitted`), so **no silently-wrong
   query is possible**. What the SDK cannot do is say _which_ API was misused: its error names
   neither `whereFilter` nor the factory. The guard converts that into an actionable message, and
   also names the two-copies-of-the-SDK case, where a `Filter` built from a direct
   `@google-cloud/firestore` install fails `instanceof`. It is exactly as strict as the SDK — it
   cannot reject anything the SDK would accept. The error echoes only the value's type; a filter
   carries caller values that may be sensitive.
5. **A prebuilt SDK `Filter` is a supported escape hatch** (`f => myFilter`), applied verbatim
   without the factory's typed paths or id validation.
6. **Server-side limits are not duplicated locally.** Firestore enforces a maximum of 30
   disjunctions after normalization, one `!=` per query, and rejects `not-in` combined with `OR`;
   all surface as `INVALID_ARGUMENT`. A local copy of these rules would risk rejecting a query the
   backend accepts, and would drift as the backend changes.
7. **The factory lives inside `src/core/QueryBuilder.ts`.** `scripts/check-coverage-gates.mjs`
   matches core files by **exact path** (`file === 'src/core/QueryBuilder.ts'`,
   `=== 'src/core/FirestoreRepository.ts'`, `=== 'src/core/Validation.ts'`), so a new
   `src/core/*.ts` module would be owned by **no** coverage gate and would silently ship unenforced.
   Any future core module must either live in an already-gated file or add its own gate entry.

8. **`QueryFilterFactory<in out S>` is declared invariant.** Without an annotation the type was
   measured **bivariant**, so a predicate annotated with an unrelated repository's stored shape — or
   one that kept `id` in the shape and could then query the synthetic `id` as a stored field path —
   was silently accepted by `whereFilter`. That defeats the schema-aware typing the factory exists
   for, and it bites precisely the reusable-predicate pattern the docs recommend (inline callbacks
   are safe, because `f` is contextually typed). The cause is **not** the usual method-parameter
   bivariance: `S` appears only inside the deferred conditional `FieldPaths<S>`, which TypeScript
   cannot measure variance through, so it accepts both directions. Verified by probe — a
   property-syntax variant of the factory is bivariant too, while a control factory parameterized by
   a plain string union is measured contravariantly with method syntax. `in` alone closes the
   unrelated-shape case but still admits a superset shape (the `id` case, since `Doc` is a
   structural subtype of `Omit<Doc, 'id'>`), so the parameter is fully invariant. Callers name the
   shape with the existing `StoredDataOf<typeof repo>` helper rather than writing `Omit<_, 'id'>` by
   hand. Variance annotations require TypeScript 4.7+, well under the documented 5.5+ floor
   (ADR-0016).

`QueryFilterFactory` is exported as a type from `src/index.ts`. `Filter` itself is not re-exported —
it is imported from `firebase-admin/firestore`, consistent with `FieldPath` / `WhereFilterOp`.

## Consequences

- **Additive, non-breaking.** Existing `where()` chains are unchanged; a `whereFilter()` is AND-ed
  with them. Composition with `select()`, `count()`/`sum()`/`average()`,
  `orderBy`/`limit`/`paginate`, `stream()`, `onSnapshot()`, `update()`/`delete()`, multiple
  `whereFilter()` calls, and vector prefilters (including a nested `and` inside an `or`) each has an
  emulator test. That is a _mechanical_ guarantee only — it does **not** mean a disjunction is
  semantically free; see the next point.
- **An inequality inside an `or()` branch silently excludes documents missing that field, including
  documents matched by another branch.** Firestore adds an implicit `orderBy` for every inequality
  field collected across the _flattened_ filter tree, and a document lacking an ordered field cannot
  appear — so an OR query can return **fewer** rows than one of its own disjuncts. Measured: an
  equality branch alone matched 3 documents, and OR-ing it with `score > 5` (absent on two of them)
  returned 1; `count()` agreed, so it is query planning rather than a read-path artifact. It applies
  to the destructive `update()`/`delete()` terminals too. `f.whereId(...)` with a comparison
  operator is exempt, because Firestore skips `documentId()` when adding implicit orders and a
  document name always exists — verified — which makes it the one safe inequality shape inside a
  disjunction.

  We do **not** guard this locally. The same exclusion is long-standing behavior for a chained
  `where('score', '>', 5)`, so it is not a new hazard class; what is new is that a disjunction lets
  it affect _other_ branches, which is surprising rather than incorrect. A guard would also have to
  fail open for prebuilt filters and would reject legitimate queries over collections where the
  field is always present. It is documented prominently on both `whereFilter` surfaces, in the
  queries guide, in best practices, and in Troubleshooting §8, and pinned by integration tests —
  including on `update()` / `delete()` / `stream()`, so the _write_ under-match is proven rather
  than merely asserted — for both `>` and `!=`.

- **The id boundary now covers `FieldPath.documentId()` on both surfaces, per operand.** `f.where`
  and the chained `where` route a document-name field path through the same `validateDocumentId`
  gate as `whereId`, so the reserved `__…__` namespace cannot be addressed with an unvalidated id
  **string** (the SDK blocks path traversal but accepts that namespace). Validation is per operand
  rather than all-or-nothing: a mixed `['__id7__', someDocRef]` array still has its string checked,
  where an "every element is a string" test would have let the whole array skip the gate. `whereId`
  rejects a non-string operand outright (its signature promises id strings);
  `where(documentId(), …)` lets a `DocumentReference` through, since a ref the caller constructed is
  already resolved and is not an untrusted id string — consistent with the rest of the library,
  which never gates raw refs. This closes a pre-existing gap in `where` rather than only avoiding a
  new one.
- **Forward-compat note for collection-group queries (#31):** `validateDocumentId` rejects `/`, and
  a collection-group document-name filter requires a full multi-segment path string. Routing
  `where(FieldPath.documentId(), …)` through the gate will therefore reject that form when #31
  lands. No impact today (collection groups are not wrapped); #31 must either exempt the
  collection-group case or accept `DocumentReference` operands only.

  > Resolved (3.0.0, issue #31 / ADR-0024): neither option was taken. The document-name filter
  > became a per-source hook on the shared query-builder base, so a collection keeps the leaf-id
  > gate (`validateDocumentId`) while a collection group gets a new even-segment
  > `validateDocumentPath` that applies the same per-segment rules to a full path — and accepts a
  > `DocumentReference` in addition to, not instead of, a validated string. `whereId` /
  > `f.whereId(...)` are absent from the group surface entirely.

- Because Firestore normalizes a composite filter and evaluates each disjunct, a composite query can
  require index coverage for more than one branch, so one `whereFilter` may surface several
  successive `FirestoreIndexError`s. (Not verified locally — the emulator creates indexes on
  demand.)
- Invariance means an extracted predicate must be annotated with the repository's exact stored shape
  (`StoredDataOf<typeof repo>`); a predicate typed against a structural _subset_ of the shape no
  longer type-checks. Making such a helper generic over `S` is the supported way to share one
  predicate across repositories.
- `Filter` identity is stable across the dual build and the whole peer range, so `instanceof` is
  safe: `firebase-admin`'s ESM and CJS firestore entries both re-export the CJS-only
  `@google-cloud/firestore`, which Node loads once per resolved path (verified in-process — an
  ESM-built filter is `instanceof` the CJS-imported `Filter`), and `Filter` plus its three statics
  exist from the range floor (`@google-cloud/firestore` 7.1.0 via `firebase-admin` ^12) through
  8.6.0 (^14). No peer-range change is needed. The one case where `instanceof` fails is a consumer
  with a second, direct `@google-cloud/firestore` install; the SDK rejects that filter too, and the
  error message names the fix.
- A violated server-side limit (>30 disjunctions, `not-in` with `OR`, two `!=`) arrives as gRPC
  `INVALID_ARGUMENT`, which `parseFirestoreError` passes through unmapped — callers see the raw SDK
  error rather than an ORM error type. Accepted: these are query-authoring mistakes, not runtime
  conditions to branch on.
- Type-level enforcement stops at the factory boundary: field paths are checked, the callback's
  return type is not (it cannot be). The runtime guard is the contract, and the type hole is
  asserted in `src/tests/types/query-paths.type-test.ts` so it starts failing if the SDK ever gives
  `Filter` an instance member.
- **Fixed in passing:** `FirestoreQueryBuilder.select()` constructed its replacement builder without
  forwarding the 7th constructor argument `allowLegacyDatastoreIds`, so a post-projection
  `whereId()` on a repository that opted into the `__id<n>__` Datastore-import namespace wrongly
  threw `InvalidDocumentIdError`. The flag is now forwarded; this also fixes
  `VectorQueryBuilder.select()`, which delegates to core `select()`.

This record **amends ADR-0017**: composite filters are no longer deferred. The remaining deferrals
(#36–#41) and the decision not to pursue full server-side or Enterprise Pipeline parity are
unchanged. (#31 collection groups, #32 transaction options, #33 conditional writes, #34 generic
multi-aggregation, and #35 `getMany` have since shipped — see ADR-0024 / ADR-0025 / ADR-0026 /
ADR-0027 / ADR-0029; this footer is kept as a living index — see [`docs/adr/README.md`](README.md)
Conventions.)

## Alternatives considered

**Accept a raw SDK `Filter` as a `where()` overload or a `whereFilter(filter)` argument.** Rejected:
the thinnest wrapper is also the one that loses everything the ORM adds — typo-checked field paths
and the validated id boundary — which is the stated acceptance criterion of #30. It remains
available as the documented escape hatch through the callback.

**Leave `QueryFilterFactory<S>` unannotated** and accept method-parameter bivariance. Rejected: the
documented reusable-predicate pattern is exactly the case bivariance breaks, so the feature's
headline guarantee would hold only for inline callbacks.

**Brand the factory's return type** to close the structurally-empty-`Filter` hole. Rejected on the
measured behavior of both forms. An **optional** brand (`Filter & { readonly __ormFilter?: true }`)
closes nothing: weak-type detection never fires, because it requires the _source_ to have at least
one property and `Filter` has none — so `'oops'` and `7` still assign. A **required** brand does
close the hole, but it rejects a genuine prebuilt SDK `Filter`, breaking the escape hatch unless
callers write `as unknown as`, which silences every check permanently. A `unique symbol` brand would
also split nominal identity across the dual build (`dist/index.d.ts` and `dist/cjs/index.d.ts` are
separate tsc runs), a problem `instanceof` does not have. The most likely real accident — a callback
that forgets to return — is already a compile error under `strictNullChecks`, and the runtime guard
is needed regardless for JS consumers and `any` boundaries.

**A separate `src/core/QueryFilters.ts` module.** Rejected: it would be a coverage-gate orphan (see
Decision 7).

**Permit empty `and()` / `or()` groups** and let Firestore decide. Rejected: Firestore does not
reject them — it silently matches the entire collection.

## References

- Issue #30; ADR-0017, ADR-0018, ADR-0021.
- [`src/core/QueryBuilder.ts`](../../src/core/QueryBuilder.ts),
  [`src/vector/VectorQueryBuilder.ts`](../../src/vector/VectorQueryBuilder.ts),
  [`src/index.ts`](../../src/index.ts).
- [`scripts/check-coverage-gates.mjs`](../../scripts/check-coverage-gates.mjs) — the exact-path gate
  matching behind Decision 7.
- SDK behavior cited above: `@google-cloud/firestore` `build/src/filter.js` (`Filter.and` /
  `Filter.or` construct a `CompositeFilter` without validating arity) and
  `build/src/reference/query.js` (`Query.where`'s `instanceof Filter` discrimination,
  `_parseCompositeFilter`'s dropping of empty sub-filters, and the unchanged-query return).
