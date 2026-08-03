# Issue #82 — Implementation notes (for adversarial review)

**Implementer:** Cursor Cloud Agent (Grok 4.5) · **Branch:**
`cursor/preserve-explicit-id-indexed-paths-e5aa` (cut from plan branch
`issue-82-explicit-id-index-field-paths` per cloud-agent PR workflow; plan header said not to cut a
new branch — recorded as Deviation 1) · **Plan:**
`docs/plans/issue-82-explicit-id-index-field-paths/PLAN.md` · **Baseline:** `main` @ `6dc98c6`
(unchanged; no rebase needed — `origin/main` still at `6dc98c6`)

## Status

Done-pending-review. Applied `prototype.patch`, added the prescribed JSDoc, replaced the U58-6
limitation pin with TY-1–TY-9 in the existing type-test file, amended ADR-0028 historically, and
updated the four Starlight pages. Independent refute-first review found F1–F3; all three fixed.
Gate re-run after remediation. Plan directory left in place for external review.

## Ambiguities resolved

- **Branching vs plan §7 step 1 / anti-instruction "do not commit unless asked":** Cloud-agent
  runtime requires a `cursor/…-e5aa` PR branch, commits, and a PR into the plan branch. Followed
  cloud workflow; content still matches the plan.
- No §1 decisions were re-opened. D1–D5 implemented as written.

## Deviations from the plan

1. **Cut `cursor/preserve-explicit-id-indexed-paths-e5aa` off the plan branch** instead of editing
   the plan branch in place. Reason: cloud-agent PR workflow requires a feature branch and PR with
   `base_branch: issue-82-explicit-id-index-field-paths`. Implementation content is unchanged.
2. **Committed / pushed / opened a PR** despite §7's "do not commit unless asked." Same cloud
   workflow requirement; Conventional Commits subject matches §10.
3. **TY-6 `findNearest` control uses an arbitrary index key** (`'arbitraryVectorKey'`) in addition
   to the declared `embedding` field, to pin T10/N5 (`KeysOf` remains wide). The plan required the
   control to detect accidental N5 edits; asserting an arbitrary key is a stronger observable than
   only the declared embedding path.
4. **Post-review strengthening of TY-8 / TY-9** beyond the plan's minimal wording: added
   `@ts-expect-error` for number-only string-key value access (F1) and `ExpectEqual` identity pins
   for `never`/`unknown`/`any` (F2). Required to make the §8.2 T3 / special-type cells falsifiable.

## Files touched and why

| File | Change | Plan reference |
| ---- | ------ | -------------- |
| `src/utils/pathTypes.ts` | `StringIndex` / `NumberIndex` / `IndexOnly` + refined `OmitId` + JSDoc | §6.1–§6.2 |
| `src/tests/types/union-model-paths.type-test.ts` | Replace U58-6 pin with TY-1–TY-9 (+ F1/F2 guards) | §8 |
| `docs/adr/0028-distributive-omit-id.md` | Related/References + historical #82 amendment | §9.2 |
| `website/.../reference/types.md` | FieldPaths / OmitId / path-vs-value `id` wording | §9.3 / F3 |
| `website/.../reference/query-builder.md` | Indexed models with synthetic `id` recover declared paths | §9.3 |
| `website/.../guides/working-with-data/dot-notation.md` | `FieldPaths<OmitId<S>>` + explicit-`id` siblings | §9.3 / F3 |
| `website/.../guides/working-with-data/queries.md` | Reusable predicate / StoredDataOf path vs value | §9.3 |
| `docs/plans/.../notes.md` | This file | §0 / skill |

## Edge cases / traps handled

| Trap | Handled by | Pinned by |
| ---- | ---------- | --------- |
| T1 | `Omit<LiteralOnly<S>, 'id'> & IndexOnly<S>` | TY-1 |
| T2 | Reconstruct indexes instead of path-only map | TY-2 |
| T3 | `Pick` for string/number indexes | TY-8 (+ string-key value reject) |
| T4 | Paths exclude `id`; value retains index typing | TY-7 + TY-2 |
| T5 | Shared helper only — no consumer edits | TY-3–TY-6 |
| T6 | Nested `nested.label` / `nested.count` on every family | TY-1, TY-3–TY-6 |
| T7 | Negatives stay `@ts-expect-error` | TY-7 |
| T8 | Assign into `string` / reject dynamic→string | TY-2 |
| T9 | Exact `QueryFilterFactory<StoredDataOf<…>>` | TY-3 |
| T10 | `findNearest` still accepts arbitrary index key | TY-6 |
| T11 | Compiler-only assertions; no Jest | `test:types` |

## Tests added

| Id | Suite | Asserts | Guards |
| -- | ----- | ------- | ------ |
| TY-1 | type | Declared/nested/numeric paths on `FieldPaths`/`NumericFieldPaths` | T1, T6 |
| TY-2 | type | Stored name/`PathValue`→`string`; dynamic/`id`→`unknown` not `string` | T2, T4, T8 |
| TY-3 | type | Core clauses, aggregations, reusable predicate | T5, T6, T9 |
| TY-4 | type | Repository helpers + both mask routes | T5, T6 |
| TY-5 | type | Collection-group inherited/override/factory | T5, T6 |
| TY-6 | type | Vector where/select/factory + KeysOf findNearest | T5, T6, T10 |
| TY-7 | type | `id`/typos/dynamic/undeclared/nonnumeric rejected; FieldPath escape | T4, T7 |
| TY-8 | type | Number-only domain (paths + string-key value); readonly index | T3 |
| TY-9 | type | Union, symbol, `ExpectEqual` never/unknown/any, no-id control | T1, T3, T4, T10 |

## Mutation checks

| Test | Mutation | Result |
| ---- | -------- | ------ |
| TY-1–TY-9 positives | `OmitId` explicit-id branch → `Omit<S, 'id'>`; restore via `/tmp/pathTypes.fixed.ts` | **Fails** — 35 `tsc` diagnostics across aliases, precision, Core/repo/group/vector, union |
| TY-8 number-domain (F1) | `NumberIndex` → `Record<string, unknown>` | **Fails** — unused `@ts-expect-error` on string-key value access (and readonly string-key directive) |
| TY-9 specials (F2) | `OmitId<S>` forced to `{}` | **Fails** — `ExpectEqual` → `false` does not satisfy `true` at never/unknown/any pins (lines 487–489) |

## Gate results

First full §10 run (pre-review):

```
npm run test:types                         ✓
npm run lint                               ✓
npm run check:format                       ✓
npm run test:unit                          32 suites / 426 tests  (unchanged)
npm run test:integration:emulator          36 suites / 544 tests  (unchanged)
npm run test:unit:coverage + gate:unit     ✓ (87.12% / 89.05% / 76.20%; all path gates)
npm run test:integration:coverage + gate   ✓ (94.21% / 88.80% / 84.22%; all path gates)
npm run build                              ✓
npm run check:package                      ✓
npm run check:consumer                     ✓ firebase-admin@^14.0.0 local leg
npm run check:docs                         ✓ 188 doc files
npm run docs:build                         ✓; grepped built HTML — no leaked `:::`
```

Probe re-run: selected P6–P25 match §3 (paths, precision, union, number/readonly/symbol, specials).
P1–P3 in the probe now reflect the *fixed* imported `OmitId` (probe imports live source), not the
unfixed baseline — expected after the fix; permanent truth is the type suite.

## Anti-instructions checklist

| Anti-instruction | Confirmed |
| ---------------- | --------- |
| No `OmitIdForPaths` / new public helper | Yes — only private `StringIndex`/`NumberIndex`/`IndexOnly` |
| No consumer signature edits in N1–N4 | Yes — only `pathTypes.ts` + type tests + docs/ADR |
| No mutable `Record` / dropped number branch | Yes — `Pick` both domains |
| Do not claim value-position `id` absent | Yes — TY-2 pins `unknown` |
| Do not widen `FieldPaths` to `string`/`keyof` | Yes — TY-7 negatives |
| No distinctValues/findNearest/write/export edits | Yes |
| No Jest tests for this type-only change | Yes |
| Do not rewrite ADR-0028 original / #58 amendment | Yes — appended #82 amendment only |
| Do not commit unless asked | **Deviated** — see Deviation 2 (cloud workflow) |

## §11 audit

| §11 item | Result | Evidence |
| -------- | ------ | -------- |
| 1 D1–D5 no new helper/export/sweep | PASS | `pathTypes.ts` private helpers only; `git diff` no consumer signature edits |
| 2 OmitId omits id, preserves siblings/indexes | PASS | `OmitId` body + TY-1/TY-2/TY-8 |
| 3 TY-1–TY-9 + mutation-fail | PASS | type-test file; mutation table above |
| 4 §8.2 trap×site observables | PASS | trap table; F1/F2 closed T3/specials holes |
| 5 negatives remain rejected | PASS | TY-7 |
| 6 value/index/union/special/predicate contracts | PASS | TY-2, TY-3, TY-8, TY-9 |
| 7 N1–N8 unchanged | PASS | diff limited to pathTypes + tests + ADR + 4 Starlight pages + notes |
| 8 ADR-0028 historical #82 only | PASS | amendment appended; #58 text untouched |
| 9 four Starlight pages; READMEs/v2 untouched | PASS | four pages edited; README grep still zero for these terms |
| 10 probe + 14-leg gate; Jest 32/426 & 36/544 | PASS | gate results above |
| 11 notes.md complete | PASS | this file |
| 12 §7 anti-instructions | PASS | checklist (commit deviation documented) |
| 13 plan dir present for review | PASS | directory retained |
| 14 cleanup `git rm` after approval | PENDING | post-external-review |

## Independent adversarial review

**Reviewer:** fresh `generalPurpose` subagent (gpt-5.6-sol-xhigh) · **Reviewed:** `6e83c82` ·
**Fixes in:** follow-up commit on this branch · **Verdict:** pass with fixes

Given: plan, diff, tests — **not** these notes. Prompted to refute.

### Findings fixed

1. **F1 major — Number-only domain unguarded for string-key value access** — Added
   `@ts-expect-error` on `_numberOnlyStored['arbitrary']` in TY-8. Mutation widening `NumberIndex`
   to `Record<string, unknown>` now yields unused-directive diagnostics.
2. **F2 major — TY-9 special-type asserts vacuous** — Replaced declare/array placement with
   `ExpectEqual`/`AssertTrue` pins for `never`/`unknown`/`any`. Forcing `OmitId = {}` fails those
   three pins with `false` ↛ `true`.
3. **F3 minor — Docs conflated raw `FieldPaths<T>` with `FieldPaths<OmitId<S>>`** — Updated
   `types.md` and `dot-notation.md` to name the composed form and qualify `id` exclusion as
   path-only (D3).

### Findings not treated as defects

- None.

### Findings deferred

- None.

### Gate re-run after fixes

Second full §10 run (post F1–F3):

```
npm run test:types                         ✓
npm run lint                               ✓
npm run check:format                       ✓
npm run test:unit                          32 suites / 426 tests
npm run test:integration:emulator          36 suites / 544 tests
npm run test:unit:coverage + gate:unit     ✓
npm run test:integration:coverage + gate   ✓
npm run build                              ✓
npm run check:package                      ✓
npm run check:consumer                     ✓ firebase-admin@^14.0.0
npm run check:docs                         ✓
npm run docs:build                         ✓; no leaked `:::`
```

## Gate re-run after fixes

Completed — see Independent adversarial review → Gate re-run after fixes.