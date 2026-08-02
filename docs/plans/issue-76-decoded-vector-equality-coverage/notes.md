# Issue #76 — Implementation notes (for adversarial review)

**Implementer:** Cursor Cloud Agent (Grok) · **Branch:**
`cursor/issue-76-decoded-vector-equality-c567` (from plan branch
`test/issue-76-decoded-vector-equality-coverage`) · **Plan:**
`docs/plans/issue-76-decoded-vector-equality-coverage/PLAN.md` · **Baseline:** `main` @
`8c5ed6d17c8a88bad93643f9e7eb6884de3afdee` — confirmed `origin/main` has not moved past the plan
baseline; §3 line numbers still match (no rebase needed). Cloud-agent workflow required a
`cursor/*-c567` feature branch for the PR; implementation content follows the plan branch contract.

## Status

Done-pending-external-review — harness `VectorDoc.embedding` typed as required `VectorValueLike`;
I-1 added to `vector-search.integration.test.ts` exactly as §6.2. Mutation proof recorded;
observational probe still matches P1–P4. Full fourteen-leg gate green. Independent refute-first
review: **pass** (no findings). Plan directory left in place for external review (§11.15–16).

## Ambiguities resolved

None beyond §1. Cloud vs plan branch naming: plan says stay on
`test/issue-76-decoded-vector-equality-coverage`; cloud agent instructions require a
`cursor/<name>-c567` feature branch with that plan branch as PR base. Implementation edits match
§6 verbatim either way.

## Deviations from the plan

1. **Feature branch name:** Plan §7 step 1 says check out the plan branch and do not cut a new one.
   Cloud agent policy requires `cursor/issue-76-decoded-vector-equality-c567` off that base for the
   PR. No design or test-shape deviation — only git topology.

## Files touched and why

| File | Change | Plan reference |
| ---- | ------ | -------------- |
| `src/tests/integration/helpers/firestoreIntegrationHarness.ts` | Import `VectorValueLike`; add required `embedding` to `VectorDoc` | §6.1, D5 |
| `src/tests/integration/vector-search.integration.test.ts` | Extend strategy header; add I-1 after basic vector round-trip | §6.2, D3–D4 |
| `docs/plans/issue-76-decoded-vector-equality-coverage/notes.md` | This file | plan-execution |

## Edge cases / traps handled

| Trap | Handled by | Pinned by |
| ---- | ---------- | --------- |
| T1 | I-1 writes via repository then `query().distinctValues` | I-1a/I-1b |
| T2 | Only `toArray()` + length asserted | I-1d |
| T3 | Unequal `[1,2,4]` fixture retained | I-1c |
| T4 | Required `embedding: VectorValueLike` | `test:types` + I-1d |
| T5 | No production recognizer edit | empty `git diff -- src/core src/utils src/vector` |
| T6 | Import from `../../../utils/pathTypes.js` only | harness import |
| T7 | `where('name','in',names)` + `orderBy` | I-1e |
| T8 | Exact component arrays | I-1c/I-1d |
| T9 | Mutation of vector canonicalize branch | mutation table below |
| T10 | Same suite + existing `afterEach` cleanup | I-1 placement |

## Tests added

| Id | Suite | Asserts | Guards |
| -- | ----- | ------- | ------ |
| I-1 | vector-search.integration | length 2 + `[[1,2,3],[1,2,4]]` via public `toArray()` | T1–T10 |

## Mutation checks

Restored via file backup (`cp` of pre-mutation `firestoreValueEquality.ts`), not `git restore`.

| Test | Mutation | Result |
| ---- | -------- | ------ |
| I-1 | Temporarily `if (false && isGenuineVectorValue(obj))` in `src/utils/firestoreValueEquality.ts:140` so decoded vectors fall to identity | **Fails** — `Expected length: 2` / `Received length: 3` / Received array three `_values` objects `[[1,2,3],[1,2,3],[1,2,4]]` |
| I-1 (after restore) | Production branch restored; `git diff -- src/utils/firestoreValueEquality.ts` empty; `git diff -- src/core src/utils src/vector` empty | **Passes** — 1 passed, 34 skipped |

## Probe re-run (§10)

After restore + I-1 green:

```json
{
  "writeConstructor": "VectorValue",
  "decodedConstructors": ["VectorValue","VectorValue","VectorValue"],
  "decodedInstanceofWriteConstructor": [true,true,true],
  "equalPairIsEqual": true,
  "unequalPairIsEqual": false,
  "distinctCount": 2,
  "distinctComponents": [[1,2,3],[1,2,4]]
}
```

Matches P1–P4.

## Gate results

Node `v24.18.0`. Log: `/tmp/issue76-impl-gate.log`.

### Pre-gate targeted

```
npm run test:types                         ✓ exit 0
targeted vector-search.integration.test.ts ✓ 1 suite / 35 tests (was 1 / 34)
```

### §9 docs/ADR no-op audit

```
rg -n "VectorValue.*by value|Bytes.*VectorValue|#76" docs/adr/0034-distinct-values-semantic-equality.md website/src/content/docs README.md npm-readme.md
```

Hits: ADR-0034 #76 follow-up refs (lines 9, 105); Starlight scope/query-builder/migration VectorValue-by-value wording. No README/npm-readme hits. No consumer-doc or ADR edit warranted (D6).

### Full fourteen-leg gate (run 1 — post-implementation)

```
npm run test:types                         ✓
npm run lint                               ✓
npm run check:format                       ✓
npm run test:unit                          ✓ 32 suites / 426 tests  (was 32 / 426)
npm run test:integration:emulator          ✓ 36 suites / 545 tests  (was 36 / 544)
npm run test:unit:coverage + gate:unit     ✓ all unit gate groups passed
npm run test:integration:coverage + gate   ✓ all integration gate groups passed
                                           (QueryBuilder lines 96.38% / branches 86.44% / fns 100%)
npm run build                              ✓
npm run check:package                      ✓ 98 files
npm run check:consumer                     ✓ firebase-admin@^14.0.0 peer leg
npm run check:docs                         ✓ 188 doc files
npm run docs:build                         ✓ 61 pages; `rg ':::' website/dist -g '*.html'` → no leaks
```

Suite counts match §10 prediction. No threshold movement.

### Gate re-run after adversarial fixes

Not required — adversarial review returned **pass** with zero findings; no remediation edits.

## Anti-instructions checklist

| Anti-instruction | Confirmed |
| ---------------- | --------- |
| No production edit unless I-1 fails on current SDK | ✓ — I-1 green unmodified; empty prod diff |
| No constructor/`instanceof`/`_values` assertion in I-1 | ✓ — only length + `toArray()` (`vector-search.integration.test.ts:87-91`) |
| No `as any` / `as VectorDoc` / `!` / optional embedding in I-1 path | ✓ — required field; typed creates (`:75-79`) |
| No `@google-cloud/firestore` import | ✓ — `VectorValueLike` from pathTypes (`firestoreIntegrationHarness.ts:7`) |
| No unit-suite / direct canonicalizer call | ✓ — emulator integration only |
| No unfiltered fixed-collection query | ✓ — three-name `in` filter (`:83`) |
| Unequal fixture + exact arrays retained | ✓ (`:78`, `:88-91`) |
| No new ADR / ADR-0017 / consumer docs | ✓ — §9 audit only |
| No drive-by `as VectorDoc` cleanup | ✓ — existing casts left (e.g. `:39`, `:67`) |
| No `review.md` written | ✓ |
| Plan directory left in place | ✓ |

## §11 audit

| §11 item | Result | Evidence |
| -------- | ------ | -------- |
| 1 D1–D7 satisfied | PASS | Test-only; empty `git diff -- src/core src/utils src/vector` |
| 2 Required `embedding: VectorValueLike` | PASS | `firestoreIntegrationHarness.ts:7,219-224` |
| 3 I-1 writes + `distinctValues` after decode | PASS | `vector-search.integration.test.ts:75-85` |
| 4 Length 2 + exact arrays | PASS | `:87-91` |
| 5 Scoped names; existing suite/cleanup | PASS | `:74,83`; `afterEach` `:31-33` |
| 6 No private asserts/casts/transitive import/recognizer change | PASS | I-1 body + empty prod diff + pathTypes import |
| 7 T9 mutation then restore | PASS | Mutation table above; length 3 → green |
| 8 Suite counts 1/35, 32/426, 36/545 | PASS | Gate results above |
| 9 Probe matches P1–P4 | PASS | Probe JSON above |
| 10 §9 audit — no doc/ADR edit | PASS | rg results above |
| 11 Empty prod diff after mutation restore | PASS | `git diff -- src/core src/utils src/vector` → empty |
| 12 §7 anti-instructions | PASS | Checklist above |
| 13 Full fourteen-leg gate green | PASS | Gate results above |
| 14 `notes.md` committed | PASS | This file on branch |
| 15 External review with plan dir present | PENDING | Ready; directory still present |
| 16 Plan-dir cleanup commit before merge | PENDING | After external review |

## Independent adversarial review

**Reviewer:** fresh `generalPurpose` subagent (GPT-5.5 high) · **Reviewed:** `e80434d` ·
**Fixes in:** n/a · **Verdict:** pass

Given: plan §§1/4/6/7/8/11, `git show HEAD` for the two test files, source reads. **Not** given
these notes. Prompted to refute-first and default to findings when uncertain.

### Findings fixed

None.

### Findings not treated as defects

None raised.

### Findings deferred

None.

### Gate re-run after fixes

N/A — no remediation. Run-1 gate remains the authoritative green record.

## Could-not-verify

Carried from plan §5:

- **B1** — Only `firebase-admin@14.2.0` / `@google-cloud/firestore@8.6.0` exercised.
- **B2** — No released split-constructor SDK; T9 mutation substitutes (recorded above).
- **B3** — Closed by this implementation (test + gate owned here).
- **B4** — Direct `firebase emulators:exec` and `npm run test:integration:emulator` both succeeded
  in this environment.
- Deferred: #41, closed #75/#77 — untouched.

## Open questions for the reviewer

None.
