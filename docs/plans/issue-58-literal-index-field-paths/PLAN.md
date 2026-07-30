# Issue #58 — Preserve literal field paths beside index signatures

**Implementer:** next plan-execution agent · **Reviewer:** independent implementation reviewer ·
**Baseline:** `main` @ `e0e7296`
(`feat(repository)!: model hook and partial-write outcomes (#46) (#81)`) · **Branch:**
`codex/issue-58-literal-index-field-paths` — already created and pushed with this plan on it; check
it out, do not cut a new one

**Issue:** [#58](https://github.com/reggieofarrell/firestore-orm/issues/58) — labels `bug`, `v3.x`;
open, no assignee, no milestone, no comments as of 2026-07-30. This is a type-system bug, not one of
ADR-0017's `#35–#41` server-parity deferrals; the living-index bookkeeping does not apply.

> **Acceptance:** the issue states no separate acceptance checklist. Its executable repro is:
> `type IndexIntersect = { name: string } & Record<string, unknown>` must no longer make
> the repository's real `FieldPaths<OmitId<IndexIntersect>>` surfaces collapse to `never`; the
> declared `name` path must be queryable. Plain TypeScript
> `FieldPaths<Omit<IndexIntersect, 'id'>>` remains flattened because the library cannot redefine
> built-in `Omit`. The issue additionally requires value-position types to retain their index
> signature.

---

## §0 How to use this plan

1. Read §1 (settled decisions) and §4 (silent traps) before editing.
2. Follow the `plan-execution` skill. Keep
   `docs/plans/issue-58-literal-index-field-paths/notes.md` current with commands, deviations,
   mutation-check output, and the independent refute-first self-review dispositions; commit it on
   this branch.
3. The source/test prototype is
   `docs/plans/issue-58-literal-index-field-paths/prototype.patch`. It applies cleanly to the pinned
   baseline (`git apply --check --unidiff-zero` passed) and is the copy-verbatim starting point for the two
   load-bearing type changes and U-6's direction flip. It passed `test:types` and `build` (declaration
   emit). It is deliberately not the complete implementation: expand U-6 exactly as §8 requires,
   and perform the docs/ADR work in §9.
4. Re-run the investigation probe:

   ```bash
   node docs/plans/issue-58-literal-index-field-paths/probes/resolve.mjs \
     docs/plans/issue-58-literal-index-field-paths/probes/field-paths.probe.ts
   ```

   It uses the TypeScript compiler API and `typeToString`. Its candidate aliases are self-contained,
   so they continue to show the rejected path-only shape and the selected intersection-preserving
   shape after the source change.
5. Do not trust the issue's reference to `tmp/probes/issue-54/` as the handoff artifact. Those
   ignored files exist in this workstation only. The committed probe beside this plan reproduces and
   extends their P6/C2/C8 evidence.
6. Leave this directory present through implementation review. Remove it only in the final cleanup
   commit after review (§11).

---

## §1 Owner-approved decisions

These decisions are derived from the issue's stated constraints plus executed probes. They were not
separately asked of the maintainer in this planning run; do not re-litigate them unless new evidence
contradicts a fact id.

| Id | Fork | Decision | Rejected alternative and why |
| --- | ---- | -------- | ---------------------------- |
| **D1** | Where to prevent intersection flattening | **Avoid `Omit` when a union member has no explicitly declared literal `id`, and make `LiteralKeys` recover explicit properties through key remapping.** This is `(derived, not asked)`. | Add and route every path surface through a second `OmitIdForPaths` helper. It compiles (P2–P8), but it creates the near-duplicate helper the issue calls a durable footgun, touches 34 path/factory/cast sites, and strips the index signature if it leaks into a value position (P10 versus P15/P16). |
| **D2** | Value-position behavior | **`OmitId<IndexIntersect>` must preserve the original intersection and its `Record<string, unknown>` index signature; `StoredDataOf` remains dynamically indexable.** `(derived, not asked)` | Reuse the path-only mapped shape in `DataOf` / `StoredDataOf`. P10 shows that shape has only explicit keys; dynamic access would narrow/break even though the query-path bug is type-only. |
| **D3** | Public API surface | **Do not add or export a new helper. Refine the existing exported `OmitId`; keep all public method signatures spelled exactly as today.** `(derived, not asked)` | Export `OmitIdForPaths` so reusable predicates can name the path-only shape. No new name is needed with D1: `StoredDataOf<typeof repo>` itself preserves the intersection and compiles as the invariant `QueryFilterFactory` argument. |
| **D4** | Explicit `id` plus a string index signature | **Do not claim support for `{ id: string; name: string } & Record<string, unknown>` in this issue. Pin it as an explicit bound tracked by [#82](https://github.com/reggieofarrell/firestore-orm/issues/82).** `(derived, not asked)` | Expanding #58 to solve that shape requires the D1-rejected path-only helper across all surfaces. The issue's exact repro has no declared `id`; a string index signature also inherently includes the key `"id"`, so “remove only that string from the index” is not expressible as a TypeScript string-index domain. P19 records the bound. |
| **D5** | Architecture record | **Amend ADR-0028 in place with a historical amendment; do not create a new ADR.** `(derived, not asked)` | A new ADR would describe no new subsystem or contract choice: #58 corrects ADR-0028's explicitly recorded known limitation. Rewriting its original limitation would erase history; an amendment preserves it. |

---

## §2 Scope and scope correction

### 2.1 In scope

| Area | Change |
| ---- | ------ |
| `src/utils/pathTypes.ts` | Add private `LiteralOnly<T>` key remapping; route `LiteralKeys<T>` through it; refine public `OmitId<S>` so it only calls `Omit` for members with an explicit literal `id`. Update the JSDoc contract. |
| `src/tests/types/union-model-paths.type-test.ts` | Convert U-6 from a known-limitation pin into broad positive/negative regression coverage across direct aliases and every public path consumer family. Preserve U-7/U-8 union/id/plain controls. |
| `docs/adr/0028-distributive-omit-id.md` | Append an issue-#58 amendment resolving the recorded D2 limitation for the reported no-explicit-id intersection, and state the explicit-id/index bound without rewriting the historical text. |
| Starlight docs | Explain the refined `OmitId` behavior and distinguish declared siblings beside an index signature from arbitrary dynamic-map keys. |
| Plan lifecycle | Implement against the committed prototype, record notes/review, then remove this plan directory after review. |

### 2.2 Explicitly out of scope

- Runtime Firestore behavior: no JavaScript branch or request changes; this is declaration/type
  evaluation only (P20).
- Write-input types (`CreateInput`, `CreateOutput`, `UpdateInput`): issue #58 is the read/query path
  interaction with `OmitId`; the write types do not route through `FieldPaths<OmitId<S>>` (N7).
- `distinctValues` and vector `findNearest` key constraints: both deliberately use
  `KeysOf<OmitId<…>>`, not `FieldPaths`; a string index signature already yields `string`, so they
  do not collapse to `never` (N5).
- A new root export or `/vector` export: D3; `src/index.ts`, `src/vector/index.ts`, and package-export
  tests remain unchanged (N8).
- Arbitrary `Record<string, unknown>` keys as typed string literals: `FieldPaths` must continue to
  reject them; callers use SDK `FieldPath` (P6/T5).
- `{ id: string; name: string } & Record<string, unknown>`:
  D4/P19/[#82](https://github.com/reggieofarrell/firestore-orm/issues/82). Add a type-test pin and
  accurate ADR/docs wording; do not imply it is fixed.
- Frozen `website/src/content/docs/2.0/**`: v2 archive is immutable.
- ADR-0017 amendments and living-index footers: #58 is a `bug`, not a server-parity deferral.
- README install/pitch/quick-start text: both READMEs were grepped and contain no `FieldPaths`,
  `OmitId`, index-signature, or dynamic-map contract to update (N9).

### 2.3 Scope correction against the issue

The issue is directionally correct but incomplete in four ways:

1. It identifies `Omit` flattening, but a path-only helper is not required for the reported shape.
   P14–P18 show that skipping unnecessary `Omit` preserves both query paths and value indexing with
   only two source-level type changes.
2. The fix is not only top-level. `FieldPaths` recurses; a nested object may itself be
   `{ declared } & Record<string, unknown>`. `LiteralKeys` must recover literals at every recursion
   level (P4/T3).
3. U-6 currently exercises only `query().where`. The same shared aliases feed query aggregation,
   repository field masks/helpers, collection groups, and vector prefilters/projections (N1–N4).
4. The issue's prior probe path is ignored `tmp/` state and is not available to a fresh clone. The
   committed probe inventory in this directory replaces it.

---

## §3 Verified facts

### 3.1 Baseline and issue metadata

| Id | Executed check | Observed |
| -- | -------------- | -------- |
| **B1** | `git fetch origin main`; `git log -1 --oneline origin/main` | `e0e7296 feat(repository)!: model hook and partial-write outcomes (#46) (#81)`; local `main` matched. |
| **B2** | `gh issue view 58 --repo reggieofarrell/firestore-orm --json …` | Open issue, labels `bug` + `v3.x`, no assignee/milestone/comments; exact title “Literal key alongside an index signature collapses FieldPaths to never.” |
| **B3** | `git status --short --branch` before investigation | Clean `main...origin/main`. Source was restored after prototyping; only this untracked plan directory remained. |

### 3.2 Compiler-probe results

Run the command in §0. The following rows are `typeToString` output, not inference from diagnostics.

| Id | Expression | Observed |
| -- | ---------- | -------- |
| **P1** | baseline `FieldPaths<OmitId<IndexIntersect>>` | `never` |
| **P2** | rejected path-only candidate on the root intersection | `"name" \| "score" \| "nested" \| "nested.deep"` |
| **P3** | path-only candidate numeric paths | `"score"` |
| **P4** | candidate with a nested declared-plus-index intersection | `"fixed" \| "fixed.label" \| "fixed.count"`; proves recursive literal recovery is required |
| **P5** | candidate over a union containing an indexed member | `"kind" \| "indexedName" \| "plainName"` |
| **P6** | candidate over pure `Record<string, unknown>` | `never`; arbitrary dynamic keys stay excluded |
| **P7** | numeric index plus explicit string key | `"name"`; number index is dropped |
| **P8** | symbol member plus explicit string key | `"name"`; symbols are dropped |
| **P9** | baseline `OmitId<IndexIntersect>` value shape | `{ [x: string]: unknown }`; the explicit keys are flattened |
| **P10** | rejected path-only value shape | `{ name; score; nested }`; the string index is stripped |
| **P11** | baseline dynamic access | `OmitId<IndexIntersect>['arbitrary'] = unknown` |
| **P12** | baseline named access after flattening | `PathValue<OmitId<IndexIntersect>, 'name'> = unknown` |
| **P13** | rejected path-only candidate on `{ id; name }` | `"name"`; it handles explicit-id intersections, but at D1's surface cost |
| **P14** | selected “omit only explicit id” candidate paths | `"name" \| "score" \| "nested" \| "nested.deep"` |
| **P15** | selected candidate value shape | original `{ name; score; nested } & Record<string, unknown>` intersection |
| **P16** | selected candidate dynamic access | `unknown`; index signature retained |
| **P17** | selected candidate over union + indexed member | `"kind" \| "indexedName" \| "plainName"` |
| **P18** | selected candidate on ordinary `{ id; name }` | `"name"`; explicit synthetic id still strips |
| **P19** | selected candidate on `{ id; name } & Record<string, unknown>` | `never`; D4's explicit bound |
| **P20–P23** | selected candidate on `never`, `unknown`, `any`, and plain `{ name }` | `never`, `unknown`, `any`, and exact `{ name: string }` respectively |
| **P24–P25** | selected candidate on optional and readonly explicit `id` | `"name"` in both cases; modifiers do not bypass stripping |

### 3.3 Baseline-to-prototype public-surface compile

| Id | Method | Baseline | Prototype |
| -- | ------ | -------- | --------- |
| **C1** | Temporary `src/issue58-baseline.probe.ts` through `npm run test:types` | **25 diagnostics** across aliases, stored-name precision, query clauses/factories/aggregations, repository helpers/masks, collection group, and vector surfaces | Same prescription scratch compiled with **0 diagnostics** after the prototype |
| **C2** | Existing U-6 only, after source prototype but before flipping U-6 | One TS2578: its baseline `@ts-expect-error` became unused | Removing the directive and renaming the test made `test:types` clean |
| **C3** | Exact imports in prescription scratch | Root import of `NumericFieldPaths` failed TS2305 | Corrected to `../../utils/pathTypes.js`; root imports for `FieldPaths`, `OmitId`, `PathValue`, `StoredDataOf`, and `QueryFilterFactory` resolved |
| **C4** | `npm run build` on prototype | n/a | Clean ESM+CJS declaration emit; no new external module specifier is introduced because both new helpers use TypeScript built-ins only |

The 25 baseline diagnostics were:

- 2 direct path/numeric alias assignments to `never`;
- 1 `StoredDataOf` named property observed as `unknown` instead of `string`;
- 11 Core/factory/aggregation/repository helper diagnostics;
- 2 repository field-mask overload failures;
- 4 collection-group diagnostics;
- 3 vector diagnostics;
- 1 reusable invariant filter-factory diagnostic.

### 3.4 Authoritative changed-site enumeration

Only two source/test files need edits:

| File | Baseline lines | Change |
| ---- | -------------- | ------ |
| `src/utils/pathTypes.ts` | `44–58` | Add `LiteralOnly<T>` and route `LiteralKeys<T>` through it. |
| `src/utils/pathTypes.ts` | `175–197` | Refine `OmitId<S>` and its JSDoc as in `prototype.patch`. |
| `src/tests/types/union-model-paths.type-test.ts` | `1–16`, `87–98` | Extend header/imports as needed; replace U-6 limitation with §8 coverage. |

### 3.5 Authoritative affected-site enumeration — deliberately not edited

All rows inherit the fix through `OmitId` / `FieldPaths`; changing their signatures would duplicate
the fix and violate D3. Fact C1 compiled representatives from every row.

| Family | Sites on `e0e7296` |
| ------ | ------------------ |
| Core query paths | `src/core/QueryBuilder.ts:637` `where`; `:671` `orderBy`; `:1122` `sum`; `:1158` `average`; `:1220` `aggregate`; `:1248`, `:1273`, `:1291` aggregation casts; `:1902`, `:1904` `whereFilter`; `:1930` `select` |
| Repository paths/masks | `src/core/FirestoreRepository.ts:182`; `:1977`, `:1985`, `:1994`; `:3176`, `:3181`, `:3186`; `:3230`, `:3235`, `:3240`; `:3275`, `:3280`, `:3285`; `:3869`, `:3879` |
| Collection group | `src/core/CollectionGroup.ts:286`, `:288` `whereFilter`; `:302` `select`; inherited `where`/`orderBy`/numeric aggregations use the Core base |
| Vector | `src/vector/VectorQueryBuilder.ts:60` selected mask; `:91` `where`; `:117` `whereFilter`; `:132` `select`; `:178` distance-field cast |
| Extractors | `src/core/FirestoreRepository.ts:4189` `DataOf`; `:4196–4197` `StoredDataOf` |

Enumeration facts used by scope/traps:

| Id | Verified fact |
| -- | ------------- |
| **N1** | Core has 11 path/factory/aggregation type sites in §3.5. |
| **N2** | FirestoreRepository has 15 path/mask overload or implementation sites in §3.5. |
| **N3** | CollectionGroup has 3 subclass-specific sites; inherited members route through Core. |
| **N4** | VectorQueryBuilder has 5 `FieldPaths`/factory/mask sites. N1–N4 total 34 actual type sites (the authoritative grep prints one additional source-comment row). |
| **N5** | `distinctValues` and `findNearest` use `KeysOf<OmitId<…>>`; the source read plus C1 show they are not `FieldPaths` collapse sites. |
| **N6** | `DocumentId.ts` contains no `FieldPaths<OmitId<…>>`; ADR-0028 already owns its independent union distribution. |
| **N7** | `Validation.ts` contains no `FieldPaths<OmitId<…>>`; its write aliases are outside #58. |
| **N8** | The selected prototype adds no symbol and exact public imports compile; root/vector export maps are unaffected. |
| **N9** | The dual-README grep in §9.4 returned zero rows. |

### 3.6 Deliberately not changed, with proving facts

- `src/core/QueryBuilder.ts:1361` `distinctValues` — `KeysOf<OmitId<T>>`; an index signature yields
  `string`, not `never`, and C1 did not identify this as a failing path surface (N5).
- `src/vector/VectorQueryBuilder.ts:155–158` `findNearest` — same `KeysOf` behavior; no
  `FieldPaths` collapse (N5).
- `src/core/Validation.ts` write aliases — no `FieldPaths<OmitId<S>>` site in the authoritative grep;
  #54 already owns union write distribution (N7).
- `src/index.ts` and `src/vector/index.ts` — D3 adds no symbol; exact public imports compiled (C3).
- `src/core/DocumentId.ts` — document result distribution is independent and already fixed by
  ADR-0028/#54 (N6).
- `website/src/content/docs/2.0/**` — frozen major-version archive (project rule).
- `README.md` / `npm-readme.md` — zero relevant grep matches (N9).

### 3.7 Coverage ownership and baseline counts

`jest.config.base.js:25–33` explicitly excludes `src/utils/pathTypes.ts` because it is type-only and
enforced by `*.type-test.ts`. Therefore no LCOV headroom claim applies.

| Suite/gate | Baseline result |
| ---------- | --------------- |
| `test:types` | clean on baseline; prototype clean after U-6 direction flip |
| Unit | **32 suites / 417 tests**, all pass |
| Integration emulator | **35 suites / 532 tests**, all pass |
| Unit coverage | 87.22% lines, 90.25% branches, 76.29% functions globally; every path-specific gate passed |
| Integration coverage | 94.13% lines, 88.95% branches, 84.07% functions globally; every path-specific gate passed |

Type tests do not add a Jest suite/test count. Both Jest counts must remain unchanged.

### 3.8 Full baseline gate

All 14 logical legs in §10 passed on the pinned baseline. Two environment reruns were necessary and
are part of the honest record:

- the sandboxed emulator leg failed with `listen EPERM`; the identical command outside the sandbox
  passed 35/532;
- sandboxed `check:package` could not write npm's cache; the identical host-permitted command passed
  with 98 packaged files.

`check:consumer` covered `firebase-admin@^14.0.0`, ESM+CJS root/vector compile+runtime, and the
optional Express subpath.

---

## §4 Traps

### T1 — Applying key remapping after `Omit` is too late (P1, P9, P14)

`Omit<IndexIntersect, 'id'>` has already flattened the intersection to the string index before
`FieldPaths` can inspect it. Changing only `LiteralKeys` makes direct/nested intersections better but
leaves every real `FieldPaths<OmitId<S>>` root surface at `never`. U58-1 and U58-3 must route through
`OmitId` and a real builder, not test `FieldPaths<IndexIntersect>` alone.

### T2 — A path-only mapped shape silently narrows value aliases (P10, P15, P16)

`OmitIdForPaths<IndexIntersect>` recovers the desired paths, but its value shape drops the string
index. If it leaks into `DataOf`/`StoredDataOf`, `_stored.dynamic` stops compiling. No runtime test
sees this. U58-2 asserts both a declared `string` property and arbitrary `unknown` access.

### T3 — Root-only normalization misses nested intersections (P4)

The same defect can recur under `fixed`. A helper applied only before the first `FieldPaths` call
yields at best the parent path and misses `fixed.label`/`fixed.count`. `LiteralKeys` itself must use
key remapping so recursion repeats the recovery. U58-1 includes a nested intersection.

### T4 — “Do not call `Omit`” can accidentally stop stripping real `id` properties (P18)

The conditional must detect an explicitly declared literal `id` through `LiteralOnly<S>` and retain
the existing `Omit<S, 'id'>` branch. Checking only `'id' extends keyof S` is wrong for a string index
because it reports true for every string and reintroduces P1. Existing U-7 plus U58-5 guard the
ordinary explicit-id path.

### T5 — Recovering literals must not widen to arbitrary index keys (P6–P8)

The goal is `"name"`, not `string`. A broad `string` admits typos and makes `FieldPath` unnecessary.
U58-4 asserts typo/dynamic-string rejection and pure-record `never`, while retaining explicit
`FieldPath` escape-hatch compilation.

### T6 — A one-call U-6 gives false confidence across 34 consumers (C1, N1–N4)

The current U-6 tests only Core `where`. Copy/paste call-site edits are deliberately avoided, but a
generic regression can still manifest differently in numeric paths, invariant factories, masks,
collection-group overrides, or vector wrappers. U58-3 covers each family and the trap matrix below
requires an observable per site.

### T7 — Assigning a specific value to `unknown` does not prove precision (P12, C1)

`const x: PathValue<…, 'name'> = 'Ada'` passes when the alias is `unknown`. The direction must be
reversed: assign `stored.name` or a `PathValue` expression to `string`. U58-2 observes
`unknown`-to-`string` failure on the baseline.

### T8 — Changing public signatures or exporting a helper creates unnecessary API churn (D3)

The compiled prototype fixes every surface without touching signatures or export maps. A new helper
would trigger `src/index.ts`, `/vector` nameability analysis, package-export tests, and more docs
without a consumer need. A post-edit grep must show no `OmitIdForPaths`.

### T9 — The explicit-id/index intersection is not fixed by D1 (P19)

Do not write “all literal keys beside index signatures are supported.” The bound must be pinned and
documented. Removing the pin is a scope expansion requiring a new owner decision.

### T10 — Dynamic-map docs can overpromise string-literal indexing (P6, T5)

Declared siblings beside an index signature become typed. Arbitrary map keys do not. Keep the
`FieldPath` example and add the distinction; do not replace it with a string-path example.

---

## §5 Could not verify / scope bounds

- **Peer matrix:** local `check:consumer` verified only `firebase-admin@^14.0.0` + `zod@^4.0.0`.
  CI's `firebase-admin` 12/13/14 and pinned-Firestore legs remain CI-owned.
- **Prototype gate:** the source/test prototype passed `test:types` and `build`; it did not run all
  14 legs. The 14-leg result in §3.8 is the clean unfixed baseline. This is intentionally not a
  gate-green finished implementation, so the planning skill's collapse condition does not fire.
- **Explicit-id/index intersection:** P19 remains `never` by D4/T9 and is tracked separately by
  [#82](https://github.com/reggieofarrell/firestore-orm/issues/82). This is an explicit bound, not an
  unverified claim.
- **TypeScript versions beyond the project floor/current lock:** only the installed compiler was
  probed. The syntax uses key remapping (supported well below the documented TS 5.5+ floor).
- **Runtime:** no emulator behavior distinguishes the type change; integration is a regression gate,
  not an acceptance oracle.
- **No coverage headroom:** `pathTypes.ts` is excluded from LCOV. This is not a missing measurement;
  §3.7 cites the configuration that makes headroom inapplicable.

---

## §6 API specification

### 6.1 `src/utils/pathTypes.ts`

Apply the `src/utils/pathTypes.ts` hunk from `prototype.patch` verbatim. The contract is:

1. Add private `LiteralOnly<T>` beside `IsIndexKey`.
2. `LiteralOnly<T>` uses key remapping to discard string/number index signatures while retaining
   explicit properties.
3. `LiteralKeys<T>` reads `keyof LiteralOnly<T>` and continues filtering to string literals.
4. `OmitId<S>` remains exported from the same module/root export; no new export is added.
5. `OmitId<S>` remains distributive (`S extends unknown`).
6. Per union member, evaluate
   `'id' extends keyof LiteralOnly<S> ? Omit<S, 'id'> : S`.
7. Preserve D2: no explicit id means return `S` itself, not a mapped reconstruction.
8. Preserve T4: an ordinary explicitly declared `id` still takes the `Omit` branch.
9. Replace the old “byte-identical to `Omit`” JSDoc with the prototype's accurate intersection and
   value-index explanation.

The exact prototype passed `test:types` and ESM+CJS declaration emit. It introduces no module
specifier and no undeclared dependency.

### 6.2 `src/tests/types/union-model-paths.type-test.ts`

Use the prototype's U-6 direction flip, then expand that block per §8. The test code must:

- keep imports from the exact existing module specifiers (`../../index.js`,
  `../../utils/pathTypes.js`, `../../vector/index.js`);
- import `StoredDataOf` and `QueryFilterFactory` from `../../index.js` for U58-2/U58-3;
- retain the file's JSDoc strategy header and update it to name #58/intersections;
- use the directly typed constructor, as the file already explains;
- add no runtime Jest test.

### 6.3 Public declarations

Expected declaration consequences:

- `OmitId<S>`'s emitted conditional becomes more precise but keeps the same exported name/arity.
- Every existing method signature remains textually `FieldPaths<OmitId<S>>`,
  `NumericFieldPaths<OmitId<S>>`, `QueryFilterFactory<OmitId<S>>`, or
  `AggregationSpec<OmitId<S>>`.
- `DataOf` / `StoredDataOf` keep their names and become intersection-preserving for models without
  an explicit literal id.
- No new import/export line in `dist/index.d.ts` or `dist/vector/index.d.ts`.

### 6.4 Size estimate

Implementation source: **1 file, about +20/-8 lines**. Type tests: **1 existing file, about +70/-3
lines**. Docs/ADR: **3 files, about +25 lines**. No runtime code, package manifest, export map, unit
test, or integration test changes.

---

## §7 Implementation sequence and anti-instructions

1. Check out `codex/issue-58-literal-index-field-paths`. It already contains this plan. If `main`
   moved past `e0e7296`, rebase onto it and re-run all §3.4/§3.5 greps before editing.
2. Run the §0 probe and save its output in `notes.md`.
3. `git apply --unidiff-zero docs/plans/issue-58-literal-index-field-paths/prototype.patch`.
4. Run `npm run test:types`; expect clean. If U-6 alone fails, confirm the prototype hunk applied
   rather than weakening/removing the test.
5. Expand U-6 into U58-1…U58-6 (§8), then run the baseline mutation check:
   temporarily restore only the two `pathTypes.ts` changes, run `test:types`, and record the
   diagnostics proving the positive assertions fail. Reapply the source fix.
6. Run `npm run test:types` and `npm run build` before docs. This catches incorrect conditional
   spelling/declaration output early.
7. Apply §9 ADR and Starlight edits. Do not edit the frozen archive or READMEs.
8. Run the probe again, the post-edit greps in §10, then the full gate.
9. Perform a refute-first self-review against §4 and the inverse matrix in §8. Commit findings and
   dispositions to `notes.md`.
10. Leave this plan directory in place for external review. After APPROVE, make the final cleanup
    commit removing the entire directory, then merge.

### Anti-instructions

- **Do not** add `OmitIdForPaths`, `LiteralKeysForPaths`, or another exported helper (D1/D3/T8).
- **Do not** replace `OmitId` with a mapped explicit-only shape in value positions (T2).
- **Do not** test only `FieldPaths<IndexIntersect>`; that bypasses the `OmitId` flattening that caused
  the real bug (T1).
- **Do not** use `'id' extends keyof S` as the conditional; a string index makes that true (T4).
- **Do not** widen `FieldPaths<Record<string, unknown>>` to `string` (T5).
- **Do not** claim D4's explicit-id/index shape is fixed (T9).
- **Do not** touch the 38 consumer signatures listed in §3.5; they inherit the central fix.
- **Do not** edit `src/index.ts`, `src/vector/index.ts`, package manifests, or package-export tests.
- **Do not** rewrite ADR-0028's historical known-limitation text; append an amendment.
- **Do not** edit `website/src/content/docs/2.0/**`.
- **Do not** add Jest tests for a compile-time-only alias; use the existing type-test gate.
- **Do not** commit implementation unless asked by the owner; report the §10 subject and leave a
  clean, reviewed tree. The plan branch's plan commit is already authorized by this handoff.

---

## §8 Test specification

### 8.1 Type tests — `src/tests/types/union-model-paths.type-test.ts`

| Id | Assertion | Observable when it fails | Guards |
| -- | --------- | ------------------------ | ------ |
| **U58-1** | `FieldPaths<OmitId<IndexIntersect>>` includes explicit top-level and nested paths; `NumericFieldPaths` includes only explicit numeric paths. Include a nested `{ label; count } & Record<string, unknown>`. | Baseline reports string-to-`never` on path/numeric assignments; root-only fix loses nested children. | T1, T3 |
| **U58-2** | `StoredDataOf<typeof indexRepo>` preserves `name: string` and arbitrary index access as `unknown`; `PathValue<OmitId<…>, 'name'>` is observed in the `unknown -> string` direction. | Baseline reports `unknown` not assignable to `string`; path-only value leak rejects dynamic access. | T2, T7 |
| **U58-3** | Positive paths compile on Core `where`, `orderBy`, `select`, `whereFilter`, `sum`, `average`, `aggregate`; repository `findByField`, `getOneByField`, `getOneByFieldOrThrow`, `getMany.fieldMask`, `getManyInTransaction.fieldMask`; collection-group inherited paths + own `select`/`whereFilter`; vector `where`/`select`/`whereFilter`. Include reusable `QueryFilterFactory<StoredDataOf<typeof indexRepo>>`. | Unfixed baseline produces 25 diagnostics; a partial surface edit leaves the corresponding call diagnostic. | T1, T6 |
| **U58-4** | Typo (`nombre`), undeclared nested key, computed dynamic string, non-numeric `sum`, and pure `Record` string paths remain errors; SDK `FieldPath` escape hatch compiles. | Unused `@ts-expect-error` means accidental widening; rejected `FieldPath` means escape hatch regression. | T5, T10 |
| **U58-5** | Existing U-7 ordinary/union explicit-id stripping remains; add a direct `{ id; name }` control, including optional or readonly `id`. | Unused `@ts-expect-error` on `id`, or missing `name`. | T4 |
| **U58-6** | `{ id; name } & Record<string, unknown>` remains explicitly pinned as unsupported with an issue-scope comment. | Unused `@ts-expect-error` means the bound changed and D4 needs re-review; an unannotated call would overclaim support. | T9 |

Every new positive must fail on the unfixed baseline. Mutation-check by reverting the two
`pathTypes.ts` edits while leaving the tests in place; record the diagnostics in `notes.md`.

### 8.2 Trap coverage — inverse direction

| Trap | Site | Falsifying test | Observable |
| ---- | ---- | --------------- | ---------- |
| T1 | Direct alias through `OmitId` | U58-1 | path assignment becomes `never` |
| T1 | Real builder | U58-3 Core `where` | string is accepted only as `FieldPath` on baseline |
| T2 | `StoredDataOf` declared key | U58-2 | `stored.name` becomes `unknown` |
| T2 | `StoredDataOf` dynamic key | U58-2 | path-only mapped value rejects `stored.dynamic` |
| T3 | nested intersection | U58-1 `nested.label`/`nested.count` | child path absent while parent may remain |
| T4 | ordinary explicit id | U58-5 | `id` becomes queryable or `name` disappears |
| T5 | pure record | U58-4 | arbitrary string stops erroring |
| T5 | typo/dynamic string | U58-4 | `@ts-expect-error` becomes unused |
| T6 | Core clauses | U58-3 | one of `where`/`orderBy`/`select` remains a diagnostic |
| T6 | Core factories/aggregations | U58-3 | invariant callback or numeric field remains a diagnostic |
| T6 | Repository helpers | U58-3 | `findByField` family diagnostic |
| T6 | Repository masks | U58-3 | overload resolution rejects `fieldMask` |
| T6 | Collection group | U58-3 | inherited or subclass method rejects string path |
| T6 | Vector | U58-3 | wrapper rejects path although Core compiles |
| T7 | `PathValue`/named value | U58-2 | `unknown` cannot assign to `string` |
| T8 | exports/signature churn | §10 grep + package checks | grep finds helper or declaration diff adds export |
| T9 | explicit-id/index bound | U58-6 | bound silently changes without owner decision |
| T10 | docs semantics | U58-4 + built-doc grep | docs claim arbitrary string while test rejects it |

### 8.3 Coverage gates

| Changed path | Owning gate |
| ------------ | ----------- |
| `src/utils/pathTypes.ts` | `test:types`; excluded from Jest LCOV at `jest.config.base.js:33` |
| `src/tests/types/union-model-paths.type-test.ts` | `test:types` |
| Markdown/ADR | `check:docs`, `docs:build` |

No unit/integration count increase is expected. Both coverage gates still run as regression gates.

---

## §9 Docs and ADR bookkeeping

### 9.1 What does not apply

- No new ADR or `docs/adr/README.md` row: D5.
- No ADR-0017 amendment and no living-index footer changes: issue label is `bug`, not the
  `#35–#41` parity set.
- No `reference/scope-and-capabilities.md` move: #58 is not a deferred server capability.
- No `src/index.ts`/`src/vector/index.ts`/package-export test edit: D3.
- No README sync: relevant grep was empty in both files.

### 9.2 ADR-0028 amendment

Append directly after the historical known-limitation paragraph at
`docs/adr/0028-distributive-omit-id.md:89–94`:

> Amendment (3.0.0, issue #58): the reported no-explicit-`id` intersection is now supported.
> `OmitId` avoids applying `Omit` when no literal `id` is declared, preserving both explicit keys and
> the value-position index signature; `FieldPaths` key remapping recovers declared keys recursively.
> Pure index keys remain excluded, and an explicit `id` combined with a string index remains outside
> this fix (D4/P19).

Add issue #58 to the References section as the resolution, retaining #54 as historical origin. Do
not delete/rewrite lines 89–94 or the “Fix index-signature collapse here” alternative at 102–103.
Reference issue #82 for the explicit-id/index bound.

### 9.3 Website — three pages

| Page | Baseline line | Edit |
| ---- | ------------- | ---- |
| `website/src/content/docs/reference/types.md` | `68–71` | Expand `FieldPaths`/`OmitId`: declared literal keys beside index signatures are preserved; `OmitId` only invokes `Omit` for an explicit literal `id`; value index signatures remain available. Keep the reusable predicate example. |
| `website/src/content/docs/reference/query-builder.md` | `22–28` (and `43–45`) | State once that declared fields beside an index signature are typed, while arbitrary dynamic keys still require `FieldPath`. Do not alter the method signature spelling. |
| `website/src/content/docs/guides/working-with-data/dot-notation.md` | `260–269` | Clarify that declared siblings on an intersection with `Record` are available as typed paths, but arbitrary record subkeys are not. Retain the `new FieldPath('metadata', 'plan')` example. |

Pages inspected and deliberately unaffected: `reference/repository.md:162–176` (signature unchanged);
`guides/working-with-data/queries.md:183–190` (existing `StoredDataOf` predicate remains correct);
`guides/migration-v2-to-v3.md` (not a migration break); `reference/scope-and-capabilities.md`
(not a capability deferral); all other Starlight reference/guides from the planning map.

`website/**/*.md` is prettier-exempt; match local wrapping manually. No new aside is required. If an
aside is nevertheless added, grep built HTML for leaked literal `:::` after `docs:build`.

### 9.4 READMEs

`rg -n "FieldPaths|OmitId|index signature|dynamic map|Record<string" README.md npm-readme.md`
returned no rows. Do not edit either README; state “unaffected” in the implementation PR body.

### 9.5 Follow-up issue

[#82](https://github.com/reggieofarrell/firestore-orm/issues/82), “Explicit id alongside an index
signature still collapses typed field paths,” was opened during planning with labels `bug`, `v3.x`.
Do not open a duplicate. U58-6 and the ADR-0028 amendment must cite it.

---

## §10 Gate and commit

Use Node 24 from `.nvmrc`. Run the full 14-leg command:

```bash
npm run test:types && npm run lint && npm run check:format && npm run test:unit && npm run test:integration:emulator && npm run test:unit:coverage && npm run test:coverage:gate:unit && npm run test:integration:coverage && npm run test:coverage:gate:integration && npm run build && npm run check:package && npm run check:consumer && npm run check:docs && npm run docs:build
```

Expected counts after the type-only change:

- unit: **32 suites / 417 tests** — unchanged;
- integration: **35 suites / 532 tests** — unchanged;
- `test:types`: clean; it has no Jest count.

Re-run the probe:

```bash
node docs/plans/issue-58-literal-index-field-paths/probes/resolve.mjs \
  docs/plans/issue-58-literal-index-field-paths/probes/field-paths.probe.ts
```

Post-implementation checks (all commands were run by the planner; expected results stated):

```bash
rg -n "OmitIdForPaths|LiteralKeysForPaths" src
# expected: no rows

rg -n "FieldPaths<OmitId<S>>|NumericFieldPaths<OmitId<S>>|QueryFilterFactory<OmitId<S>>|CollectionGroupFilterFactory<OmitId<S>>|AggregationSpec<OmitId<S>>" src/core src/vector
# expected: the same existing consumer-family rows enumerated in §3.5; signatures are not rewritten

rg -n "FieldPaths|OmitId|index signature|dynamic map|Record<string" README.md npm-readme.md
# expected: no rows

git apply --check --unidiff-zero docs/plans/issue-58-literal-index-field-paths/prototype.patch
# expected on unfixed baseline only: exit 0; after implementation, do not run this check because the
# patch is already applied and "already exists" is expected
```

**Commit subject** (Conventional Commits; commitlint runs on `commit-msg`):

```text
fix(types): preserve literal paths beside index signatures (#58)
```

**Breaking ruling:** non-breaking bug fix. It widens accepted compile-time paths to declared fields
that already exist at runtime and makes `OmitId`/`StoredDataOf` more precise without removing dynamic
index access. No runtime or method signature changes. The work also targets unreleased v3.x.

---

## §11 Definition of done

| # | Item |
| - | ---- |
| 1 | D1 implemented centrally: `LiteralOnly` + conditional `OmitId`, no call-site sweep |
| 2 | D2 proven: declared values retain types and arbitrary index access remains `unknown` |
| 3 | D3 honored: no new helper/export/signature spelling |
| 4 | D4 explicit-id/index bound pinned and documented, not overclaimed |
| 5 | D5 honored: ADR-0028 amendment, no new ADR/index row |
| 6 | Every §3.4 source/test site updated and no §3.5 consumer signature edited |
| 7 | U58-1…U58-6 implemented in the existing type-test file |
| 8 | Every new positive fails on unfixed source; mutation output recorded in `notes.md` |
| 9 | Every §4 trap has the per-site falsifying observable in §8.2 |
| 10 | Pure `Record`, typos, dynamic strings, nonnumeric paths remain rejected; `FieldPath` compiles |
| 11 | ADR-0028 historical text retained and amendment/reference appended |
| 12 | Three Starlight pages updated accurately; frozen v2 archive untouched |
| 13 | READMEs, exports, manifests, runtime source, and Jest tests untouched |
| 14 | Probe re-run and post-edit greps match §10 expectations |
| 15 | Full 14-leg gate green with 32/417 and 35/532 counts |
| 16 | Independent refute-first self-review completed; dispositions in `notes.md` |
| 17 | Nothing in §7 Anti-instructions violated |
| 18 | External review completed while this directory is present |
| 19 | `notes.md` committed with deviations, commands, mutation evidence, and review dispositions |
| 20 | Final cleanup: `git rm -r docs/plans/issue-58-literal-index-field-paths/` after APPROVE |

---

## §12 Pre-handoff verification

| Check | Command / method | Result |
| ----- | ---------------- | ------ |
| Baseline pinned | `git fetch origin main`; local/remote logs | both `e0e7296` |
| Issue metadata current | `gh issue view 58 … --json` | open; `bug`, `v3.x`; no explicit checklist/comments |
| Adjacent defect tracked | GitHub issue creation (connector was read-only; `gh issue create` fallback) | [#82](https://github.com/reggieofarrell/firestore-orm/issues/82), labels `bug`, `v3.x` |
| Probe current/candidates | §0 `resolve.mjs` | P1–P25 output recorded in §3.2; no diagnostics |
| Baseline public-surface mutation | temporary `src/issue58-baseline.probe.ts` + `test:types`; removed | 25 diagnostics across every consumer family |
| Prototype patch applies | `git apply --check --unidiff-zero …/prototype.patch` | exit 0 |
| Prototype source/test compile | exact prototype + `npm run test:types` | clean after expected U-6 direction flip |
| Exact module specifiers | prescription scratch | root imports resolved except `NumericFieldPaths` (correctly internal); changed to `./utils/pathTypes.js`, then clean |
| Declaration emit | prototype + `npm run build` | clean ESM+CJS emit; no new dependency/specifier |
| Full baseline gate | §10 14 legs | all pass; emulator/npm-cache permission reruns documented in §3.8 |
| Baseline counts | Jest outputs | unit 32/417; integration 35/532 |
| Coverage ownership | `jest.config.base.js:25–33` | `pathTypes.ts` excluded; `test:types` owns |
| Docs/readme enumeration | §9 greps + line reads | 3 Starlight pages + ADR amendment; README grep empty |
| Prototype restored | `git diff -- src` | empty; only plan directory remains |
| Unresolved conditionals | re-read §§2–9 | none; explicit-id/index resolved to D4 bound by P19 |
| Trap inverse walk | §4 against §8.2 | every trap × affected family has a falsifying observable |

---

## Appendix — probe inventory

| File | What it proves |
| ---- | -------------- |
| `probes/resolve.mjs` | Compiler-API runner; rejects probe diagnostics and prints resolved aliases |
| `probes/field-paths.probe.ts` | Baseline collapse; rejected path-only shape; selected intersection-preserving conditional; nested/union/index/symbol/id bounds |
| `prototype.patch` | Exact two-file starting diff that passed `test:types` + declaration build |
| `notes.md` | Implementer's committed return channel |
