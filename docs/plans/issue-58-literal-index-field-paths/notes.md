# Issue #58 — Implementation notes (for adversarial review)

**Implementer:** Cursor Grok 4.5 (plan-execution agent) · **Branch:**
`codex/issue-58-literal-index-field-paths` · **Plan:**
`docs/plans/issue-58-literal-index-field-paths/PLAN.md` · **Baseline:** `main` @ `e0e7296`
(no rebase — `origin/main` remained at the pinned sha; §3.4 sites still matched the prototype)

## Status

**Done — ready for external re-review.** Shipped D1 centrally (`LiteralOnly` + conditional
`OmitId`), expanded U58-1…U58-6 (plus P17 union pin and F1/F2 precision pins from self-review),
amended ADR-0028 in place, updated three Starlight pages. Runs 1–2 claimed a green 14-leg chain,
but external review falsified that: `check:docs` failed on a broken notes link (M1). M1/N1
remediated; **Run 3 full §10 chain `EXIT=0`**. Plan directory left in place. **Not committed**
(owner did not ask).

## Ambiguities resolved

None beyond §1. Prototype applied verbatim for the two `pathTypes.ts` changes; U-6 expanded per §8
rather than left at the prototype's one-call flip.

## Deviations from the plan

1. **Prettier on ADR-0028.** Plan §9.2 prescribed amendment prose; `check:format` failed on wrapping.
   Ran `prettier --write docs/adr/0028-distributive-omit-id.md`. Content unchanged; wrapping only.
2. **Self-review F1/F2/F3/F4/F5 applied beyond the prototype/§8 minimum.** Strengthened U58-2 dynamic
   precision, optional/readonly `id` strip pins, docs D4 caveat, P17 union fixture, ADR Related
   wording. These are additive pins, not design changes.
3. **Deleted implementer-authored `review.md`.** A refute-first subagent wrote
   `docs/plans/issue-58-literal-index-field-paths/review.md`; plan-execution reserves that filename
   for external review. Content retained in this notes section + the parent report; file removed.

## Files touched and why

| File | Change | Plan reference |
| ---- | ------ | -------------- |
| `src/utils/pathTypes.ts` | `LiteralOnly` + route `LiteralKeys`; conditional `OmitId` + JSDoc | §6.1 |
| `src/tests/types/union-model-paths.type-test.ts` | U58-1…U58-6 (+ P17; F1/F2 pins) | §6.2 / §8 |
| `docs/adr/0028-distributive-omit-id.md` | Amendment + References/#82; Related soften | §9.2 / F5 |
| `website/.../reference/types.md` | FieldPaths/OmitId contract + #82 caveat | §9.3 / F3 |
| `website/.../reference/query-builder.md` | Declared-beside-index vs FieldPath | §9.3 |
| `website/.../guides/working-with-data/dot-notation.md` | Declared siblings vs arbitrary record keys | §9.3 |
| `docs/plans/.../notes.md` | This file | plan-execution |

## Edge cases / traps handled

| Trap | Handled by | Pinned by |
| ---- | ---------- | --------- |
| T1 | Conditional `OmitId` skips `Omit` when no literal `id` | U58-1, U58-3 |
| T2 | Return `S` unchanged (index retained) | U58-2 (+ F1 unknown precision) |
| T3 | `LiteralKeys` via `LiteralOnly` remapping | U58-1 nested paths |
| T4 | `'id' extends keyof LiteralOnly<S>` | U58-5 (+ optional/readonly strip) |
| T5 | Remapping drops index keys | U58-4 |
| T6 | Multi-surface U58-3 | U58-3 Core/repo/CG/vector |
| T7 | `unknown → string` observation | U58-2 |
| T8 | No new export / signature churn | §10 greps |
| T9 | Explicit bound left `never` | U58-6 + ADR/#82 |
| T10 | Docs retain FieldPath for arbitrary keys | docs + U58-4 |

## Tests added

| Id | Suite | Asserts | Guards |
| -- | ----- | ------- | ------ |
| U58-1 | `test:types` | `FieldPaths`/`NumericFieldPaths` through `OmitId` incl. nested | T1, T3 |
| U58-2 | `test:types` | `StoredDataOf` name:`string`, dynamic:`unknown` (precision pin) | T2, T7 |
| U58-3 | `test:types` | Core/repo/CG/vector path consumers + filter factory | T1, T6 |
| U58-4 | `test:types` | Typo/dynamic/pure-record/nonnumeric reject; FieldPath OK | T5, T10 |
| U58-5 | `test:types` | Explicit/optional/readonly `id` stripped; `name` kept | T4 |
| U58-6 | `test:types` | Explicit-id+index remains `never` (#82) | T9 |
| P17 pin | `test:types` | Union member with indexed intersection | F4 |

## Mutation checks

Restored unfixed `pathTypes.ts` from `/tmp/pathTypes.ts.fixed` backup (not `git checkout`).
Independent external review re-ran the unconditional distributive-`Omit` mutation under the locked
toolchain and counted **33 diagnostics**, all in `union-model-paths.type-test.ts` (N1 — prior notes
said 32; corrected to the independently verified count). The implementer's original mutation used
the same unconditional-`Omit` shape; the earlier "32" figure was a miscount, not a different
mutation.

| Test | Mutation | Result |
| ---- | -------- | ------ |
| U58-1 path assignments | Revert `LiteralOnly` + conditional `OmitId` | **Fails** — `'"name"' is not assignable to type 'never'` (and nested/numeric siblings) |
| U58-2 name / PathValue → string | same | **Fails** — `Type 'unknown' is not assignable to type 'string'` |
| U58-3 Core/repo/CG/vector callers | same | **Fails** — `Argument of type 'string' is not assignable to parameter of type 'FieldPath'`; fieldMask overload rejects `string[]` |
| U58-4 / U58-5 / U58-6 negatives | same | Negatives still error as designed; positives above prove load-bearing |

Fix restored via `cp /tmp/pathTypes.ts.fixed src/utils/pathTypes.ts`. Post-restore `test:types` clean.
External review also mutated T2 (`LiteralOnly<S>` return) → 1 diagnostic (TS7053); both mutations
reverted clean.

## Gate results

### Run 1 — after implementation + docs (before self-review fixes)

```
npm run test:types                         ✓
npm run lint                               ✓
npm run check:format                       ✓ (after prettier on ADR)
npm run test:unit                          32 suites / 417 tests (unchanged)
npm run test:integration:emulator          35 suites / 532 tests (unchanged)
npm run test:unit:coverage + gate:unit     ✓ (87.22% lines; all path gates)
npm run test:integration:coverage + gate   ✓ (94.13% lines; all path gates)
npm run build                              ✓
npm run check:package                      ✓ (98 files)
npm run check:consumer                     ✓ firebase-admin@^14.0.0 ESM+CJS + express
npm run check:docs                         claimed ✓ — FALSIFIED by external review (M1)
npm run docs:build                         claimed ✓ — not re-verified for this run
```

### Run 2 — after F1–F5 remediation

Previously recorded as all 14 legs `EXIT:0`. **Falsified by external review:** the 14-leg chain
exits `1` at `check:docs` because of the broken subagent-id Markdown link (M1). Legs 1–12 and a
separately run `docs:build` were green under review; the chain itself was not. Counts for the
green legs: **32/417** unit, **35/532** integration.

### Run 3 — after external-review M1/N1 remediation

Full 14-leg chain under Node 24 (`v24.18.0`), captured as
`(leg1 && … && leg14); echo EXIT=$?` → **`EXIT=0`**.

```
npm run test:types                         ✓
npm run lint                               ✓
npm run check:format                       ✓
npm run test:unit                           32 suites / 417 tests
npm run test:integration:emulator          35 suites / 532 tests
npm run test:unit:coverage + gate:unit     ✓ (87.22% lines; all path gates)
npm run test:integration:coverage + gate   ✓ (94.13% lines; all path gates)
npm run build                              ✓
npm run check:package                      ✓ (98 files)
npm run check:consumer                     ✓ firebase-admin@^14.0.0 ESM+CJS + express
npm run check:docs                         ✓ (186 docs)
npm run docs:build                         ✓ 61 pages; Pagefind 82 HTML; no leaked `:::`
```

### Probe (§0)

Pre-fix: P1=`never`, P9=flattened index, P14/P15 selected candidate correct, P19=`never`.
Post-fix: library baseline P1/P9/P12 now preserve paths/intersection/`string`; P19 still `never`.
Candidates (self-contained) unchanged.

### Post-edit greps

- `OmitIdForPaths|LiteralKeysForPaths` in `src`: no rows
- Consumer `FieldPaths<OmitId<S>>`… spellings: 35 rows (34 sites + comment; signatures unchanged)
- README/npm-readme relevant grep: no rows
- `website/src/content/docs/2.0/**`: untouched

## Anti-instructions checklist

| Anti-instruction | Confirmed |
| ---------------- | --------- |
| No `OmitIdForPaths` / exported helper | ✓ `rg` empty; `LiteralOnly` non-exported |
| No path-only mapped value shape | ✓ `OmitId` returns `S` when no literal `id` |
| Do not test only `FieldPaths<IndexIntersect>` | ✓ U58-1/3 route through `OmitId` + builders |
| Do not use `'id' extends keyof S` | ✓ uses `keyof LiteralOnly<S>` |
| Do not widen pure `Record` to `string` | ✓ U58-4 `@ts-expect-error` |
| Do not claim D4 fixed | ✓ U58-6 + ADR/#82 + types.md caveat |
| Do not touch §3.5 consumer signatures | ✓ `git diff` empty under `src/core`/`src/vector` |
| Do not edit index/vector/package/export tests | ✓ |
| Do not rewrite ADR historical limitation | ✓ lines 89–94 retained; amendment appended |
| Do not edit frozen v2 archive | ✓ |
| No Jest tests for type-only alias | ✓ type-test file only |
| Do not commit unless asked | ✓ tree dirty, uncommitted |

## §11 audit

| §11 item | Result | Evidence |
| -------- | ------ | -------- |
| 1 D1 central fix | PASS | `src/utils/pathTypes.ts:48–63`, `:208–212` |
| 2 D2 value precision | PASS | U58-2 in `union-model-paths.type-test.ts:130–149` |
| 3 D3 no new export/signature | PASS | greps; no `src/index.ts` diff |
| 4 D4 bound pinned | PASS | U58-6 + ADR amendment/#82 |
| 5 D5 ADR amendment | PASS | `docs/adr/0028-distributive-omit-id.md:89–101` |
| 6 §3.4 edited; §3.5 not | PASS | only `pathTypes.ts` + type-test under `src/` |
| 7 U58-1…U58-6 | PASS | type-test file sections |
| 8 Mutation recorded | PASS | this notes Mutation checks (**33** diagnostics; N1 corrected) |
| 9 §4 traps × §8.2 | PASS | Edge cases table above |
| 10 Negatives + FieldPath | PASS | U58-4 |
| 11 ADR history + amendment | PASS | historical text retained; amendment + refs |
| 12 Three Starlight pages; v2 untouched | PASS | git diff names |
| 13 READMEs/exports/manifests/runtime/Jest untouched | PASS | git diff |
| 14 Probe + greps | PASS | Gate results |
| 15 Full gate 32/417 + 35/532 | PASS | Run 3: `EXIT=0`; 32/417 + 35/532; no `:::` |
| 16 Independent refute-first review | PASS | dispositions below |
| 17 §7 anti-instructions | PASS | checklist |
| 18 External review | READY FOR RE-REVIEW | M1/N1 fixed; Run 3 green; `review.md` retained |
| 19 `notes.md` with evidence | PASS | this file (commit when owner asks) |
| 20 Final plan-dir cleanup | DEFERRED | after APPROVE only |

## Independent adversarial review

**Reviewer:** fresh-context subagent (adversarial review `75841de7-d0f1-4bea-9405-c0cb78ea4174`) ·
**Reviewed:** dirty tree (uncommitted) · **Fixes in:** same dirty tree · **Verdict:** pass with
fixes → remediated

Given: `/tmp/issue58-impl.diff`, `PLAN.md`, source/tests — **not** these notes. Prompted to refute.
(Subagent incorrectly wrote `review.md`; deleted; dispositions kept here. The agent id above is
plain text — not a Markdown link — so `check:docs` does not treat it as a repo-relative path.)

### Findings fixed

1. **F1 major — U58-2 dynamic index precision** — added `@ts-expect-error` assigning
   `_stored['arbitrary']` to `string` (`u58_2_dynamicIndexIsUnknown`).
2. **F2 major — U58-5 optional/readonly id strip** — `@ts-expect-error` on `'id'` for
   `OptionalIdPaths` / `ReadonlyIdPaths`.
3. **F3 minor — types.md overclaim vs D4** — qualified “no explicit `id`” and linked #82.
4. **F4 minor — P17 union pin missing** — added `_u58_unionIntersect` path assignments.
5. **F5 nit — ADR Related still called #58 a follow-up** — Related now says resolved by #58 /
   bound #82 without rewriting historical limitation prose.

### Findings not treated as defects

- None remaining after remediation.

### Findings deferred

- None. No follow-up issues opened ( #82 already tracks D4).

### Gate re-run after fixes

Run 2 was previously claimed fully green; that claim is **withdrawn** (see M1). The honest
post-remediation gate is Run 3 under External review (round 1).

## External review (round 1)

**Reviewer:** Codex (GPT-5) via `review.md` · **Verdict:** APPROVE WITH FIXES · **Artifact:**
`docs/plans/issue-58-literal-index-field-paths/review.md` (do not edit).

### Findings fixed

1. **M1 major — broken docs link** — removed Markdown link syntax around the internal subagent
   identifier at `notes.md` Independent adversarial review header (was a Markdown link whose
   target was the bare UUID `75841de7-d0f1-4bea-9405-c0cb78ea4174`; now plain-text id in backticks).
   Also withdrew the falsified “all 14 legs green” / §11 item 15 PASS claims for Runs 1–2.
2. **N1 minor — mutation diagnostic count** — corrected **32 → 33** in Mutation checks and §11
   item 8; documented that the independent unconditional-`Omit` mutation is the authoritative
   count (prior “32” was a miscount of the same mutation shape).

### Findings not treated as defects

- None from round 1 (verified-and-holding surfaces left alone).

### Findings deferred

- None.

### Gate re-run after fixes

**Run 3** — full §10 14-leg chain after M1/N1 remediation: **`EXIT=0`**. Counts **32/417** unit,
**35/532** integration. `check:docs` ✓ (186 docs). `docs:build` ✓ (61 pages / Pagefind 82 HTML);
`rg ":::" website/dist --glob '*.html'` → no rows.

## Could-not-verify

Carried from plan §5:

- Peer matrix beyond local `firebase-admin@^14` + `zod@^4` remains CI-owned.
- Explicit-id/index intersection bound (#82) remains out of scope by D4.
- TypeScript versions beyond the installed lock not probed.
- Runtime/emulator is a regression gate only for this type-only change.
- `pathTypes.ts` excluded from LCOV — no coverage headroom claim.

## Open questions for the reviewer

None.
