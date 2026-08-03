# Issue #82 — Preserve explicit-id indexed field paths

**Implementer:** next plan-execution agent · **Reviewer:** independent implementation reviewer ·
**Baseline:** `main` @ `6dc98c6`
(`docs(plans): issue #79 lifecycle-hooks query().delete() handoff (#90)`) · **Branch:**
`issue-82-explicit-id-index-field-paths` — already created and pushed with this plan on it; check it
out, do not cut a new one

**Issue:** [#82](https://github.com/reggieofarrell/firestore-orm/issues/82) — labels `bug`, `v3.x`;
open, no assignee, milestone, or comments as of 2026-08-02. This is a type-system bug, not one of
ADR-0017's server-parity deferrals; ADR-0017 amendments and living-index footers do not apply.

> **Acceptance (verbatim executable repro from the issue):**
> `type ExplicitIdIndexed = { id: string; name: string } & Record<string, unknown>` must no longer
> make `FieldPaths<OmitId<ExplicitIdIndexed>>` resolve to `never`. The issue also requires an explicit
> decision about path-only normalization and public predicate nameability.

---

## §0 How to use this plan

1. Read §1 (settled — do not re-litigate) and §4 (silent traps) before editing.
2. Follow the `plan-execution` skill. Keep
   `docs/plans/issue-82-explicit-id-index-field-paths/notes.md` current with command results,
   deviations, mutation checks, and refute-first self-review dispositions; commit it on this branch.
3. The source prototype is
   `docs/plans/issue-82-explicit-id-index-field-paths/prototype.patch`. It applies cleanly to the
   pinned baseline and carries the exact type bodies in §6. It passed a source-only compile and
   declaration build. It deliberately omits JSDoc, tests, ADR, and consumer docs.
4. Re-run the compiler investigation probe:

   ```bash
   node docs/plans/issue-82-explicit-id-index-field-paths/probes/resolve.mjs \
     docs/plans/issue-82-explicit-id-index-field-paths/probes/explicit-id-index.probe.ts
   ```

   The probe uses the TypeScript compiler API and `typeToString`; it asks how the baseline,
   rejected path-only candidate, and selected preserving candidate resolve. Permanent assertions
   belong in the type test specified by §8.
5. Leave this directory in place through implementation review. Remove it only in the final cleanup
   commit after review (§11), so the plan, notes, and review remain visible while review is active.

---

## §1 Owner-approved decisions

Settled by the maintainer on 2026-08-02. Do not re-litigate without new compiler evidence.

| Id | Fork | Decision | Rejected alternative and why |
| -- | ---- | -------- | ---------------------------- |
| **D1** | Normalization boundary | **Refine the existing exported `OmitId<S>` so an explicit `id` is removed from the declared-key portion while the original string/number index signatures are reconstructed.** | Add `OmitIdForPaths` and route every path consumer through it. P4/P5 show that it restores paths but strips value-position index signatures; it would also require a new public predicate-annotation story and a partial-sweep-prone edit across Core, repository masks, collection groups, and vector surfaces. |
| **D2** | Public predicate nameability | **Keep `QueryFilterFactory<StoredDataOf<typeof repo>>` as the public reusable-predicate spelling. Add no export and change no consumer signature.** | Export a new path-data helper. P6–P10 show the selected `OmitId` retains declared precision and dynamic indexing simultaneously, so another public name has no demonstrated need. |
| **D3** | Meaning of “omit id” with a string index | **`id` is excluded from `FieldPaths`, but value-position access remains the index value (`unknown` for `Record<string, unknown>`). Document this unavoidable distinction.** | Claim `StoredDataOf<…>['id']` is `never`. TypeScript cannot express a string-index domain excluding one literal key; P10 proves the reconstructed index still answers `id` as `unknown`, while P17 proves it is not a typed path. |
| **D4** | Index families and modifiers | **Preserve string and number index signatures with `Pick`; retain their modifiers. Symbol indexes already survive the literal-only `Omit` and need no separate reconstruction helper.** | Rebuild with mutable `Record<…>`. That loses readonly modifiers and conflates number-only with string indexes. P14/P15 and P18–P25 pin the selected behavior. |
| **D5** | Architecture record | **Append an issue-#82 amendment to ADR-0028; do not create a new ADR.** `(derived from repository ADR conventions and the issue's direct refinement of ADR-0028)` | A new ADR would duplicate the same `OmitId` decision family. Rewriting the accepted text would erase the historical #54/#58 limitation; an amendment preserves history and resolves the named bound. |

---

## §2 Scope and scope correction

### 2.1 In scope

| Area | Change |
| ---- | ------ |
| `src/utils/pathTypes.ts` | Add private `StringIndex`, `NumberIndex`, and `IndexOnly` helpers; refine `OmitId` to combine `Omit<LiteralOnly<S>, 'id'>` with preserved index signatures; update its JSDoc. |
| `src/tests/types/union-model-paths.type-test.ts` | Replace the #82 known-limitation pin with positive, negative, value-shape, modifier, union, Core, repository-mask, collection-group, vector, and reusable-predicate coverage. |
| `docs/adr/0028-distributive-omit-id.md` | Add a historical issue-#82 amendment and resolve the bound/reference without rewriting prior claims. |
| Starlight docs | Update the `FieldPaths`, `OmitId`, dynamic-map, and reusable-predicate explanations for explicit-id indexed models. |
| Plan lifecycle | Implement from the preserved prototype, record notes/review, and remove this directory after review. |

### 2.2 Explicitly out of scope

- Runtime Firestore behavior: this is declaration/type evaluation only; no emitted JavaScript branch
  or Firestore request changes (B4, C2).
- A new public helper, root export, `/vector` export, or package-export test: D1/D2 and C1 prove no
  new symbol or module specifier is needed.
- Editing any `FieldPaths<OmitId<…>>`, `NumericFieldPaths<OmitId<…>>`, factory, aggregation, field
  mask, collection-group, or vector consumer signature: all inherit the shared `OmitId` refinement
  (N1–N4/C1).
- `distinctValues` and `findNearest`: they deliberately use `KeysOf<OmitId<…>>`; string indexes are
  already `string`, and path-only narrowing would regress their contract (N5).
- Write aliases (`CreateInput`, `CreateOutput`, `UpdateInput`) and runtime validation: they do not use
  the query-path normalization seam (N6).
- Arbitrary index keys as typed string paths: `FieldPaths` continues to expose declared literals
  only. Callers use SDK `FieldPath` for arbitrary/dynamic keys (P17/T7).
- Frozen `website/src/content/docs/2.0/**`: the v2 archive is immutable.
- ADR-0017 amendments/living-index footers: #82 is a `bug`, not a deferred capability.
- Dual README content: both were grepped; neither describes `OmitId`, `FieldPaths`, indexed models,
  or reusable predicates (N9).

### 2.3 Scope correction against the issue

The issue is directionally correct but its preferred mechanism is no longer the minimal safe one:

1. A path-only helper is not required. P6–P15 show that reconstructing the original index-signature
   portion after omitting declared `id` preserves path and value contracts together.
2. The issue's referenced #58 probe directory was a branch-lifecycle artifact and no longer exists on
   `main`. The committed probe beside this plan recreates P19 and expands it to the selected design.
3. The type-test pin at `src/tests/types/union-model-paths.type-test.ts:277–286` covers only one direct
   alias assignment. The defect reaches 23 independently observable aliases/calls across every public
   path-consumer family (C3).
4. A string index necessarily makes value access at `id` legal at the index value type. The actual
   contract is declared-key/path removal, not impossible exclusion from the string domain (D3/P10).

---

## §3 Verified facts

### 3.1 Baseline and issue metadata

| Id | Executed check | Observed |
| -- | -------------- | -------- |
| **B1** | `git pull --ff-only`; `git log -1 --oneline` | Local and remote `main` matched `6dc98c6 docs(plans): issue #79 lifecycle-hooks query().delete() handoff (#90)`. |
| **B2** | `gh issue view 82 --json …` | Open; title “Explicit id alongside an index signature still collapses typed field paths”; labels `bug`, `v3.x`; no assignee, milestone, or comments; created/last updated 2026-07-30. |
| **B3** | `git status --short --branch` before investigation | Clean `main...origin/main`; plan work began on `issue-82-explicit-id-index-field-paths`. |
| **B4** | Source read of `src/utils/pathTypes.ts:44–212` | `pathTypes.ts` is type-only. Baseline `OmitId` takes `Omit<S, 'id'>` when `id` is a declared literal, which flattens explicit siblings beside a string index. |

### 3.2 Compiler probe — baseline and rejected path-only design

Run the command in §0. These are compiler-API `typeToString` results, not diagnostics interpreted by
hand.

| Id | Expression | Observed |
| -- | ---------- | -------- |
| **P1** | baseline `FieldPaths<OmitId<ExplicitIdIndex>>` | `never` |
| **P2** | baseline `OmitId<ExplicitIdIndex>` | `{ [x: string]: unknown }`; declared siblings are flattened |
| **P3** | baseline `PathValue<OmitId<ExplicitIdIndex>, 'name'>` | `unknown`, not `string` |
| **P4** | path-only candidate paths | `"name" \| "score" \| "nested" \| "nested.label" \| "nested.count"` |
| **P5** | path-only candidate value shape | Declared fields only; string index is gone, so it cannot back `StoredDataOf` |

### 3.3 Compiler probe — selected preserving design

| Id | Expression | Observed |
| -- | ---------- | -------- |
| **P6** | selected candidate paths | `"name" \| "score" \| "nested" \| "nested.label" \| "nested.count"` |
| **P7** | selected stored shape | `Omit<LiteralOnly<ExplicitIdIndex>, 'id'> & Pick<ExplicitIdIndex, string>` |
| **P8** | selected `PathValue<…, 'name'>` | `string` |
| **P9** | selected dynamic access `['arbitrary']` | `unknown`; index retained |
| **P10** | selected value access `['id']` | `unknown`; unavoidable index-domain value (D3) |
| **P11** | ordinary explicit-id model paths | `"name"`; existing behavior retained |
| **P12** | no-id indexed model paths | `"name"`; #58 behavior retained |
| **P13** | union containing explicit-id indexed and plain members | `"kind" \| "indexedName" \| "plainName"`; distribution retained |
| **P14** | number-only indexed model paths | `"name"`; numeric index itself is not a string path |
| **P15** | number-only dynamic access `[123]` | `unknown`; number index retained |
| **P16** | path-only candidate `PathValue<…, 'id'>` | `never` |
| **P17** | selected candidate `Extract<'id', FieldPaths<…>>` | `never`; D3 removes `id` from paths despite P10 |
| **P18/P19** | readonly string index selected shape / declared `name` | reconstructed `Pick` intersection / `string` |
| **P20/P21/P22** | selected helper on `never` / `unknown` / `any` | `never` / `unknown` / `any`; existing special-type behavior retained |
| **P23** | assignment through reconstructed readonly string index | compiler accepts the `@ts-expect-error`; assignment remains illegal |
| **P24/P25** | explicit-id symbol-index model paths / symbol access | `"name"` / `unknown`; symbol index survives without a separate reconstruction branch |

### 3.4 Prototype and baseline-failure compile

| Id | Executed check | Observed |
| -- | -------------- | -------- |
| **C1** | Apply `prototype.patch`; compile exact root imports, `/vector` import, aliases, every consumer family, and reusable predicate with `npx tsc --noEmit -p tsconfig.json` | Clean. No consumer signature or export edit required. |
| **C2** | `npm run build` with the source prototype | Clean ESM+CJS declaration emit; helpers use TypeScript built-ins only and introduce no dependency/module specifier. |
| **C3** | Same positive surface scratch against unfixed baseline | **23 diagnostics**: direct alias, stored-name precision, Core clauses/factory/aggregations, repository helpers/masks, collection group, vector, and reusable predicate. Every prescribed positive test fails before the fix. |
| **C4** | `npm run test:types` with source prototype but existing pin unchanged | The only diagnostic was expected TS2578 at `union-model-paths.type-test.ts:283`: the old #82 `@ts-expect-error` became unused. This proves the pin must flip; source prescription added no other diagnostic. |
| **C5** | `git apply --check --unidiff-zero prototype.patch` after reverting source | Clean; prototype applies to the pinned baseline. |

### 3.5 Authoritative source/test site enumeration

Only two source/test files are edited:

| File | Baseline lines | Change |
| ---- | -------------- | ------ |
| `src/utils/pathTypes.ts` | `44–50` | Existing index-key detection and `LiteralOnly`; add the three preserving-index helpers immediately after it. |
| `src/utils/pathTypes.ts` | `180–212` | Rewrite `OmitId` JSDoc and the explicit-id branch exactly as §6. |
| `src/tests/types/union-model-paths.type-test.ts` | `96–222` | Reuse #58's fixture/test patterns and transaction declaration; do not duplicate equivalent helpers. |
| `src/tests/types/union-model-paths.type-test.ts` | `224–286` | Preserve ordinary/optional/readonly-id controls; replace U58-6's known-limitation pin with §8's explicit-id indexed suite. |

### 3.6 Affected consumers that deliberately inherit the fix unchanged

| Id | Family | Current sites on `6dc98c6` |
| -- | ------ | --------------------------- |
| **N1** | Core query/factory/aggregation | `src/core/QueryBuilder.ts:652`, `:686`, `:1137`, `:1173`, `:1235`, `:1263`, `:1288`, `:1306`, `:1993`, `:1995`, `:2021` |
| **N2** | Repository fields/masks | `src/core/FirestoreRepository.ts:221`, `:2103`, `:2111`, `:2120`, `:3496`, `:3501`, `:3506`, `:3550`, `:3555`, `:3560`, `:3595`, `:3600`, `:3605`, `:4218`, `:4228` |
| **N3** | Collection group | `src/core/CollectionGroup.ts:286`, `:288`, `:302`; inherited `where`, `orderBy`, and aggregations use Core |
| **N4** | Vector | `src/vector/VectorQueryBuilder.ts:60`, `:91`, `:117`, `:132`, `:178` |
| **N5** | Top-level key consumers | `QueryBuilder.ts:1376` and `VectorQueryBuilder.ts:155` use `KeysOf<OmitId<…>>`; they are not `FieldPaths` collapse sites and must remain unchanged |
| **N6** | Write aliases | `src/core/Validation.ts` contains no `FieldPaths<OmitId<…>>`; #82 does not change write semantics |
| **N7** | Extractors | `src/core/FirestoreRepository.ts:4538–4546` routes `DataOf` / `StoredDataOf` through `OmitId`, so value precision and index retention change without editing these aliases |
| **N8** | Public exports | `src/index.ts:95` already exports `OmitId`; no new root or `/vector` export is needed |
| **N9** | Dual READMEs | `rg -n "OmitId|FieldPaths|index signature|StoredDataOf|QueryFilterFactory" README.md npm-readme.md` returned zero rows |

### 3.7 Deliberately not changed, with proving facts

- Every Core/repository/group/vector signature in N1–N4 — C1 proves the shared helper fixes them;
  editing them would create the D1-rejected partial sweep.
- `distinctValues` and `findNearest` sites in N5 — their `KeysOf` contract deliberately retains
  arbitrary index keys; path-only normalization would narrow them.
- `src/core/FirestoreRepository.ts:4538–4546` — extractors already compose through `OmitId` (N7).
- `src/core/Validation.ts` write aliases — no query-path site and no runtime behavior (N6/B4).
- `src/index.ts`, `src/vector/index.ts`, and package-export tests — D2/C1/N8 add no public name.
- `README.md` / `npm-readme.md` — the exact grep returned no rows (N9).
- `website/src/content/docs/2.0/**` — frozen archive by project rule.

### 3.8 Coverage ownership and baseline counts

`jest.config.base.js:25–34` excludes `src/utils/pathTypes.ts` because it emits no runtime code;
`*.type-test.ts` and `test:types` own this contract. No LCOV headroom claim applies.

| Suite/gate | Baseline result |
| ---------- | --------------- |
| `test:types` | clean |
| Unit | **32 suites / 426 tests**, all pass |
| Integration emulator | **36 suites / 544 tests**, all pass |
| Unit coverage | 87.12% lines, 89.05% branches, 76.20% functions globally; all path gates pass |
| Integration coverage | 94.21% lines, 88.80% branches, 84.22% functions globally; all path gates pass |

Type tests add no Jest suite/test count. Both Jest counts must remain unchanged.

### 3.9 Full baseline gate

All 14 logical legs in §10 passed on the pinned baseline. The sandboxed emulator and npm-cache
checks first failed environmentally (`listen EPERM`; npm cache `EPERM`) and passed unchanged with
the required host permissions. `check:consumer` covered local `firebase-admin@^14.0.0`; §5 records
the peer-major CI bound.

---

## §4 Traps

Ordered by how badly a reasonable implementer can get them wrong.

### T1 — Omitting from the original intersection destroys the evidence needed to recover literals (P1–P3)

`Omit<S, 'id'>` computes through collapsed `keyof S`; applying key remapping afterward is too late.
The result remains only `{ [x: string]: unknown }`, so all path surfaces silently collapse.

### T2 — A path-only mapped type fixes calls while breaking value contracts (P4/P5)

`OmitIdForPaths` makes `where('name')` compile, but removes dynamic indexing from `DataOf` /
`StoredDataOf`. A test suite that checks paths only would ship a public extractor regression.

### T3 — Reconstructing with mutable `Record` loses index modifiers and domains (P14/P15/P18–P23)

Use `Pick<T, string>` / `Pick<T, number>` so TypeScript preserves readonly modifiers and keeps a
number-only index separate from a string index. Hand-written `Record` is observably broader/mutable.

### T4 — The string index still answers `id`; only the declared path can be removed (P10/P17)

Trying to force value-position `id` to `never` either lies about TypeScript or strips the index
signature. The required invariant is: `FieldPaths` excludes `id`, while dynamic/value access keeps
the original index value.

### T5 — Editing consumers instead of the shared helper creates a 38-site partial sweep (N1–N4/C1)

Core can look green while a repository mask, collection-group override, vector field mask, distance
field cast, or reusable factory remains collapsed. D1 intentionally avoids this class of omission.

### T6 — A root-only direct-alias test misses nested recursion and public routing (P6/C3)

`'name'` compiling does not prove `'nested.label'`, numeric paths, factories, masks, groups, or
vector projections. C3 shows 23 independent failures on the unfixed baseline.

### T7 — Widening indexed models to `string` admits arbitrary keys silently (P17/N5)

Declared literal paths must recover, but `'arbitrary'`, `'id'`, typos, and undeclared nested keys
must stay errors. Do not “solve” the collapse with `string | FieldPath` or `keyof`.

### T8 — Testing precision in the wrong assignment direction guards nothing (P3/P8/P9)

Assigning a `string` into `unknown` passes before and after. Assign `stored.name` / `PathValue` into
`string`, and separately prove dynamic access cannot assign into `string`.

### T9 — Reusable predicate nameability can fail even when inline factories compile (D2/C3)

An inferred `f => f.where(...)` does not prove the exported invariant spelling
`QueryFilterFactory<StoredDataOf<typeof repo>>`. Test that exact root import and annotation.

### T10 — `KeysOf` consumers are deliberately wider than `FieldPaths` (N5)

Do not route `distinctValues` or vector `findNearest` through declared-only path normalization. A
pure index model intentionally admits arbitrary top-level string keys there.

### T11 — Runtime/Jest coverage cannot observe a type-only regression (B4/§3.8)

An emulator or unit test passes identically before and after. Only `test:types`, declaration emit,
and packed-consumer compilation can guard this contract.

---

## §5 Could not verify / scope bounds

- **Peer-major matrix** — local `check:consumer` covered `firebase-admin@^14.0.0`. CI still owes its
  `^12` / `^13` / `^14` and pinned-firestore legs; do not claim those from the local result.
- **Prototype bound** — the source-only prescription compiled and emitted declarations, but the
  prototype did not include tests/docs and did not run the full 14-leg gate. The untouched baseline
  did. The implementer must run the full gate after completing the real change.
- **Schema-constructor reachability** — `withSchema` requires `ZodObject`; explicit intersection
  stored models primarily reach this surface through the directly typed constructor. The compiler
  contract is public regardless, but no runtime schema fixture exists for this exact shape.
- **Exotic index combinations** — probes cover string, number-only, readonly string, symbol,
  unions, nested intersections, `never`, `unknown`, and `any`. They do not exhaust every branded or
  mixed index-signature construction.
- **Historical #58 probe** — the issue references a removed plan artifact. The current committed
  probe is the authoritative replacement; do not cite the deleted branch path as locally runnable.

---

## §6 API specification

`prototype.patch` carries the exact bodies. Apply it, then add the JSDoc specified below; do not
retype a competing implementation.

### 6.1 `src/utils/pathTypes.ts` — private index preservation helpers

Immediately after `LiteralOnly<T>`:

```ts
type StringIndex<T> = string extends keyof T ? Pick<T, string> : unknown;
type NumberIndex<T> = number extends keyof T ? Pick<T, number> : unknown;
type IndexOnly<T> = StringIndex<T> & NumberIndex<T>;
```

Add JSDoc explaining:

- `StringIndex` and `NumberIndex` recover only an existing index signature; `unknown` is the neutral
  intersection when that domain is absent.
- `Pick` is load-bearing because it preserves index-signature modifiers and value types.
- `IndexOnly` reattaches value-position indexing after declared keys are remapped; it must not be
  passed to `FieldPaths` by itself.
- Symbol indexes need no helper because `LiteralOnly` removes only broad string/number keys, and
  ordinary `Omit` retains symbol keys.

### 6.2 `src/utils/pathTypes.ts` — refine exported `OmitId`

```ts
export type OmitId<S> = S extends unknown
  ? 'id' extends keyof LiteralOnly<S>
    ? Omit<LiteralOnly<S>, 'id'> & IndexOnly<S>
    : S
  : never;
```

Rewrite the existing JSDoc so it states all of these invariants:

1. Distribution over union members is unchanged.
2. No-explicit-id members are returned exactly, preserving #58 behavior.
3. Explicit-id members omit `id` from the declared-key portion before reattaching their original
   string/number indexes; declared siblings retain precise types.
4. `FieldPaths<OmitId<S>>` therefore excludes synthetic `id` and arbitrary index keys but recovers
   declared siblings recursively.
5. Value-position aliases retain dynamic indexing. Because a string index includes every string,
   value access at `id` has the index value type even though `id` is not a declared typed path.
6. `KeysOf<OmitId<S>>` remains the top-level-key composition for `distinctValues` / `findNearest`.
7. Link ADR-0028 and its issue-#82 amendment.

The exact bodies above were compiled through the root and `/vector` public module specifiers and
declaration emit (C1/C2). No import or dependency is added.

### 6.3 Size

Expected implementation: 2 source/test files, roughly +100/−10 lines; 1 ADR amendment and 4 small
Starlight edits; no runtime JavaScript change, export change, package entry change, or new dependency.

---

## §7 Implementation sequence and anti-instructions

1. Check out `issue-82-explicit-id-index-field-paths`; it already carries this plan. If `main` has
   moved past `6dc98c6`, rebase and re-run the §3.5/§3.6 enumeration before editing.
2. Apply `prototype.patch` and verify it with the source-only compile. Add the required JSDoc without
   changing the type bodies. The shared seam must land before the positive tests can compile.
3. Replace the U58-6 limitation pin and extend the existing fixture/test section exactly per §8.
   Reuse existing imports, `tx`, #58 controls, and surface patterns rather than creating a second
   type-test file.
4. Mutation-check every load-bearing positive: stash/reverse the `pathTypes.ts` fix while leaving
   the tests present and confirm `test:types` fails. C3 predicts 23 representative diagnostics.
   Restore the fix and confirm negatives still consume their `@ts-expect-error` directives.
5. Update ADR-0028 and the four Starlight pages in §9. Do not rewrite historical amendment text.
6. Run the probe and full gate in §10. Record commands, deviations, environmental reruns, and the
   refute-first self-review in `notes.md`.
7. Leave this plan directory present for external review. After approval, remove the whole directory
   in the final cleanup commit, then merge.

### Anti-instructions

- **Do not** add or export `OmitIdForPaths`, `PathDataOf`, or another public helper (D1/D2).
- **Do not** edit any consumer signature in N1–N4; the shared helper is the intentional seam (T5).
- **Do not** replace `Pick` with mutable `Record` or drop the number-index branch (T3).
- **Do not** claim value-position `id` is absent for a string-indexed model; it is the index value
  while remaining absent from `FieldPaths` (T4).
- **Do not** widen `FieldPaths` to `string`, `keyof`, or arbitrary dynamic keys (T7).
- **Do not** change `distinctValues`, `findNearest`, write aliases, runtime validation, root exports,
  vector exports, package tests, or the v2 docs archive (N5/N6/N8).
- **Do not** add Jest tests for this type-only change; they cannot observe it (T11).
- **Do not** rewrite ADR-0028's original decision or issue-#58 amendment; append a dated historical
  issue-#82 amendment.
- **Do not** commit implementation changes unless asked; report the §10 subject. The plan branch
  itself is already committed/pushed as the handoff artifact.

---

## §8 Test specification

### 8.1 Type suite — `src/tests/types/union-model-paths.type-test.ts`

Expand the existing `ExplicitIdIndex` fixture to include `score`, a nested declared-plus-index map,
and `embedding`. Create one directly typed repository and vector wrapper; reuse the file's existing
`db`, `tx`, `Filter`, `FieldPath`, imports, and conventions.

| Id | Asserts | Observable when it fails | Guards |
| -- | ------- | ------------------------ | ------ |
| **TY-1** | `FieldPaths<OmitId<ExplicitIdIndex>>` accepts `name`, `score`, `nested`, `nested.label`, `nested.count`; `NumericFieldPaths` accepts `score` and `nested.count` | Positive assignments become `never`/`FieldPath` diagnostics on baseline | T1, T6 |
| **TY-2** | `StoredDataOf<typeof repo>.name` and `PathValue<…, 'name'>` assign into `string`; dynamic access assigns into `unknown` but not `string` | Baseline reports `unknown`→`string`; path-only leak rejects dynamic access | T2, T8 |
| **TY-3** | Core `where`, nested `where`, `orderBy`, `select`, inline `whereFilter`, reusable `QueryFilterFactory<StoredDataOf<…>>`, `sum`, `average`, and `aggregate` accept declared paths | Each call reports string-not-assignable-to-`FieldPath` or aggregate field error on baseline | T5, T6, T9 |
| **TY-4** | Repository `findByField`, `getOneByField`, `getOneByFieldOrThrow`, `getMany` field mask, and transaction field mask accept declared/nested paths | Helpers/mask overloads reject strings on baseline | T5, T6 |
| **TY-5** | Collection-group inherited `where`/`orderBy`, override `select`, and group factory accept declared/nested paths | Group calls reject strings on baseline | T5, T6 |
| **TY-6** | Vector `where`, `select`, and factory accept declared/nested paths; existing `findNearest` remains unchanged | Vector calls reject strings on baseline; `findNearest` control detects accidental N5 edits | T5, T6, T10 |
| **TY-7** | `id`, arbitrary dynamic strings, typos, undeclared nested keys, and nonnumeric `sum('name')` remain errors; SDK `FieldPath` escape hatch compiles | Unused `@ts-expect-error` if paths widen; escape-hatch diagnostic if narrowed incorrectly | T4, T7 |
| **TY-8** | Number-only index retains numeric dynamic access but does not create arbitrary string paths; readonly string index rejects assignment | Dynamic number access disappears, arbitrary strings compile, or readonly assignment directive becomes unused | T3 |
| **TY-9** | Union member combining explicit id + index still distributes with a plain member; symbol index survives; `never`/`unknown`/`any`, ordinary explicit-id, optional-id, readonly-id, no-id-index, pure-record, and plain-model controls retain existing behavior | Existing controls or new assignments change unexpectedly | T1, T3, T4, T10 |

Every positive in TY-1–TY-6 must fail on the unfixed baseline. C3 already observed 23 representative
diagnostics; the implementer records the mutation run in `notes.md`. Every negative must be checked
after the fix for an unused `@ts-expect-error`.

### 8.2 Trap coverage — inverse direction

| Trap | Site | Falsifying test | What it observes |
| ---- | ---- | --------------- | ---------------- |
| T1 | `OmitId` root | TY-1 | Direct declared path is `never` if original `Omit` remains |
| T2 | `StoredDataOf` | TY-2 | Dynamic index disappears under path-only mapping |
| T3 | string/number/readonly indexes | TY-8 | Domain or readonly modifier changes |
| T4 | path vs value `id` | TY-7 + TY-2 | Path rejects `id`; value retains index typing |
| T5 | Core clauses/aggregations | TY-3 | Each public Core family accepts the recovered path |
| T5 | repository helpers/masks | TY-4 | Helper and both mask routes accept it |
| T5 | collection group | TY-5 | Inherited and override/factory sites accept it |
| T5 | vector | TY-6 | Prefilter, projection, and factory sites accept it |
| T6 | nested recursion | TY-1/TY-3–TY-6 | `nested.label` / `nested.count` reach every family |
| T7 | arbitrary/typo paths | TY-7 | Unused error directive exposes accidental widening |
| T8 | declared vs dynamic precision | TY-2 | Values flow in the load-bearing unknown→string direction |
| T9 | exported invariant predicate | TY-3 | Exact `QueryFilterFactory<StoredDataOf<typeof repo>>` compiles |
| T10 | `KeysOf` consumers | TY-6/TY-9 | Existing findNearest/pure-index controls remain wide where intended |
| T11 | type-only ownership | Entire type file via `test:types` | Compiler, not Jest, evaluates the assertions |

### 8.3 Coverage gates

| Changed path | Gate |
| ------------ | ---- |
| `src/utils/pathTypes.ts` | Type-only; explicitly excluded at `jest.config.base.js:31–33`; `test:types` owns it |
| `src/tests/types/union-model-paths.type-test.ts` | `test:types`; excluded from Jest counts/LCOV |

No coverage threshold or Jest count changes. Unit remains 32/426; integration remains 36/544.

---

## §9 Docs and ADR bookkeeping

### 9.1 Bookkeeping that does not apply

Issue #82 is a `bug`, not an ADR-0017 parity deferral. Do not amend ADR-0017, touch living-index footers,
move a scope/capability row, or claim a new server capability. No new export means no package-export
test or `/vector` re-export. No README install/pitch/quick-start content changes.

### 9.2 ADR-0028 amendment — `docs/adr/0028-distributive-omit-id.md`

Append an `Amendment (3.0.0, issue #82)` paragraph immediately after the #58 amendment at
`docs/adr/0028-distributive-omit-id.md:97–101`. It must record:

1. The explicit-id indexed bound is now resolved by omitting `id` from `LiteralOnly<S>` and
   intersecting preserved string/number index signatures.
2. Declared sibling and nested path precision is restored across Core, repository-mask,
   collection-group, and vector surfaces without editing those signatures.
3. `DataOf` / `StoredDataOf` retain dynamic index access and reusable
   `QueryFilterFactory<StoredDataOf<typeof repo>>` remains nameable.
4. String indexes inherently include `id`; value access has the index value while `FieldPaths`
   excludes `id` as a declared path.
5. `distinctValues` / `findNearest` retain their separate `KeysOf` contract.

Update `Related` at lines 6–10 and References at lines 116–120 so #82 is a resolved refinement, not
an open bound. Do not alter the original known-limitation or #58 amendment wording. No new ADR/index
row and no `docs/adr/README.md` edit (D5).

### 9.3 Website — four pages

| Page | Current lines | Required change |
| ---- | ------------- | --------------- |
| `website/src/content/docs/reference/types.md` | `76–87` | Remove the “no explicit id” qualifier and open-#82 limitation; explain preserving declared siblings plus index signatures, and the path/value `id` distinction. |
| `website/src/content/docs/reference/query-builder.md` | `22–30`, `40–48` | State that indexed stored models recover declared paths even when the raw model explicitly declares synthetic `id`; arbitrary/index-only keys remain `FieldPath`-only. |
| `website/src/content/docs/guides/working-with-data/dot-notation.md` | `260–265` | Clarify the declared-sibling rule includes direct-constructor models with explicit `id`, without implying arbitrary `z.record` keys become typed. |
| `website/src/content/docs/guides/working-with-data/queries.md` | `183–193` | In the reusable-predicate guidance, state that `StoredDataOf` preserves declared indexed fields and dynamic index access while excluding synthetic `id` from typed paths. |

`website/**/*.md` is prettier-exempt; match surrounding style manually. If an aside is added, build
the site and inspect built HTML for leaked literal `:::`. No aside is needed for this edit.

### 9.4 READMEs and other docs

The exact N9 grep returned no rows. `README.md`, `npm-readme.md`, repository reference, migration
guide, scope/capabilities, and the v2 archive are unaffected. State that explicitly in the PR body.

---

## §10 Gate and commit

```bash
npm run test:types && npm run lint && npm run check:format && npm run test:unit && npm run test:integration:emulator && npm run test:unit:coverage && npm run test:coverage:gate:unit && npm run test:integration:coverage && npm run test:coverage:gate:integration && npm run build && npm run check:package && npm run check:consumer && npm run check:docs && npm run docs:build
```

Fourteen logical legs. Report failures with output; do not claim a leg passed unless it ran. Node
must be 24 per `.nvmrc`; emulator legs need the JDK and local port binding.

Baseline: unit **32 suites / 426 tests**; integration **36 suites / 544 tests**. Both must remain
unchanged because all new assertions are compiler-only. No LCOV threshold changes.

Re-run the investigation probe:

```bash
node docs/plans/issue-82-explicit-id-index-field-paths/probes/resolve.mjs \
  docs/plans/issue-82-explicit-id-index-field-paths/probes/explicit-id-index.probe.ts
```

The probe remains comparative/self-contained; the selected P6–P25 outputs should remain as §3
records. Permanent finished-code truth is the type suite.

**Commit subject** (Conventional Commits; commitlint runs on `commit-msg`):

```text
fix(types): preserve explicit-id indexed field paths (#82)
```

**Is it breaking?** No for intended v3 consumers: previously rejected declared paths become
accepted, while value index access and rejection of `id`/arbitrary paths remain. The emitted
`OmitId` alias changes structurally and could be observed by exotic conditional types, but this is a
bug fix within unreleased v3.x and preserves documented value contracts.

---

## §11 Definition of done

| # | Item |
| - | ---- |
| 1 | D1–D5 are implemented without a new helper/export or consumer-signature sweep. |
| 2 | `OmitId` removes declared `id`, preserves declared siblings recursively, and retains string/number index domains/modifiers (§6). |
| 3 | TY-1–TY-9 exist in the existing type-test file and mutation-fail on the unfixed helper (§8). |
| 4 | Every trap/site row in §8.2 has an observable falsifying assertion. |
| 5 | `id`, arbitrary dynamic keys, typos, undeclared nested paths, and nonnumeric fields remain rejected as typed string paths. |
| 6 | `StoredDataOf`, `PathValue`, dynamic indexing, readonly/number indexes, unions, special types, and reusable predicates retain their contracts. |
| 7 | No N1–N8 deliberately unchanged source/export surface is edited. |
| 8 | ADR-0028 receives only the historical #82 amendment/reference resolution; no deferral bookkeeping is copied (§9). |
| 9 | All four exact Starlight pages are accurate; both READMEs and frozen v2 docs remain untouched. |
| 10 | Probe output matches §3; full 14-leg gate passes; Jest counts remain 32/426 and 36/544 (§10). |
| 11 | `notes.md` contains mutation results, deviations, command output, and refute-first self-review dispositions. |
| 12 | Nothing in §7's anti-instruction list is violated. |
| 13 | External review occurs while this directory remains visible. |
| 14 | After approval, `git rm -r docs/plans/issue-82-explicit-id-index-field-paths/` removes the entire plan directory in the final cleanup commit before merge. |

---

## §12 Pre-handoff verification

| Check | Command / method | Result |
| ----- | ---------------- | ------ |
| Baseline/issue metadata | `git pull`, `git log`, `gh issue view`, clean-status check | Baseline `6dc98c6`; issue open, `bug`/`v3.x`, no assignee/milestone/comments |
| Probe facts | §0 compiler-API resolver | P1–P25 observed exactly as §3.2/§3.3; no probe diagnostics |
| §6 bodies compile | Apply prototype + exact public-import scratch + `npx tsc --noEmit -p tsconfig.json` | Clean |
| Existing type suite under prototype | `npm run test:types` before flipping pin | Only expected TS2578 at old #82 limitation pin; no source-prescription diagnostic |
| Baseline falsification | Same 23 positive observables with unfixed helper | 23 diagnostics across all named families; tests will not pass on baseline |
| Exact module specifiers | Scratch imports from `./index.js`, `./vector/index.js`, and `firebase-admin/firestore` | All resolve under selected source prototype |
| Declaration emit | `npm run build` under source prototype | Clean ESM+CJS emit; no new package/module dependency |
| Prototype portability | `git apply --check --unidiff-zero prototype.patch` | Clean on pinned baseline |
| Baseline suite counts | `npm run test:unit`; host-permitted `npm run test:integration:emulator` | 32/426 unit; 36/544 integration |
| Coverage ownership | `jest.config.base.js:25–34`; both coverage runs/gates | `pathTypes.ts` excluded as type-only; all existing gates pass; no headroom claim needed |
| Full §10 baseline gate | All 14 legs, with unchanged host-permitted reruns for emulator/npm cache | All pass; initial sandbox `EPERM` failures recorded in §3.9 |
| §9 site enumeration | Exact `rg` plus numbered file reads | Four Starlight pages + ADR-0028; README grep expected/observed zero rows |
| Unresolved conditionals | Re-read §§2–9 after owner chose D1 | None; public nameability, index modifiers/domains, ADR strategy, suite ownership, and docs scope resolved |

---

## Appendix — probe inventory

| File | Purpose |
| ---- | ------- |
| `probes/explicit-id-index.probe.ts` | Self-contained baseline/path-only/preserving candidates; resolves path, value, union, string/number/symbol domains, readonly, and special-type behavior |
| `probes/resolve.mjs` | TypeScript compiler-API runner that prints exact non-generic alias types and diagnostics |
| `prototype.patch` | Reverted minimal source prescription for `StringIndex`, `NumberIndex`, `IndexOnly`, and `OmitId` |
