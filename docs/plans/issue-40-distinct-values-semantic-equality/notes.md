# Issue #40 — Implementation notes (for adversarial review)

**Implementer:** Cursor Grok 4.5 (plan-execution agent) · **Branch:**
`feat/issue-40-distinct-values-semantic-equality` · **Plan:**
`docs/plans/issue-40-distinct-values-semantic-equality/PLAN.md` · **Baseline:** `main` @ `3f0dd7a`
(rebase onto `origin/main` was a no-op; §3.1 / §6.2 line numbers re-verified and match the plan)

## Status

**Done — external review findings addressed.** Client-side Firestore-aware semantic equality for
`distinctValues()` shipped: new util, QueryBuilder wiring, U-1…U-24, I-1…I-6c, ADR-0034 + full
deferral bookkeeping, Starlight updates. External `review.md` round 1 (APPROVE WITH FIXES) remediated;
full §10 gate re-run after remediation. Plan directory left in place; not committed.

## Ambiguities resolved

None — §1 D1–D6 followed as settled.

## Deviations from the plan

1. **I-1 / I-2 seed via raw Admin SDK `set()`, not `userRepo.bulkCreate`.** Plan §8.3 says use the
   harness; it does not prescribe the write API. `bulkCreate` walks inputs through
   `collectSentinelPaths`, which recurses into a `DocumentReference`'s `_firestore` client and
   overflows the stack. Writing with `db.collection(col).doc(id).set(...)` + `trackUser(id)` keeps
   the harness cleanup contract and avoids the unrelated validation walker. Observed failure:
   `RangeError: Maximum call stack size exceeded` in `collectSentinelPaths`.

2. **I-2 Timestamps differ by a full second, not one nanosecond.** Plan §8.3 says "two Timestamps
   differing by a nanosecond". Emulator round-trip of `new Timestamp(s, 1)` and `new Timestamp(s, 2)`
   both came back as `_nanoseconds: 0`, so the over-merge assertion saw length 1. Using
   `1700000000` vs `1700000001` seconds keeps the over-merge guard falsifiable. Unit U-5 still pins
   nanosecond discrimination on in-process Timestamp instances.

3. **I-6c added for T7 on the converter path.** Plan §8.3 I-6 only listed Date + custom class
   (+6 tests), but §8.5 / §11 require T7 at the converter site. Added I-6c (cyclic converter
   output → length 1, no throw). Integration test count is therefore **+7** vs the plan's +6.
   Recorded after adversarial finding F2.

4. **Mutation M4 / M5 / M7 needed adjusted mutations to be falsifiable.** (a) Plan's
   `numberKey → String(value)` is a no-op for `-0` in JS (`String(-0) === '0'`); used
   `Object.is(value, -0) ? '-0' : String(value)` instead so U-17 fails. (b) Dropping only the `['d']`
   tag leaves `NaN` vs `null` distinct (`['n']`); also bare-`null` for null so U-12 fails via
   `JSON.stringify(NaN) === 'null'`. (c) Removing only the `seen` cycle guard still terminates via
   `MAX_DEPTH`; removed both to make U-18 throw. Tests still guard the intended contracts.

## Files touched and why

| File | Change | Plan reference |
| ---- | ------ | -------------- |
| `src/utils/firestoreValueEquality.ts` | New canonical keyer + `distinctFirestoreValues` | §6.1 |
| `src/core/QueryBuilder.ts` | Import, JSDoc rewrite, call site | §6.2 |
| `src/tests/unit/firestoreValueEquality.unit.test.ts` | U-1…U-23 | §8.2 |
| `src/tests/unit/queryBuilderTerminals.unit.test.ts` | U-24 | §8.2 |
| `src/tests/integration/repository-query-builder.integration.test.ts` | I-1, I-2 | §8.3 |
| `src/tests/integration/repository-collection-group.integration.test.ts` | I-4a, I-4b | §8.3 |
| `src/tests/integration/repository-read-only-converter.integration.test.ts` | I-6a, I-6b, I-6c | §8.3 / F2 |
| `docs/adr/0034-distinct-values-semantic-equality.md` | New ADR | §9.1 |
| `docs/adr/README.md`, `0017`, ten living footers | Bookkeeping | §9.1 |
| Starlight: scope / query-builder / queries / migration | Contract prose | §9.2–§9.3 |
| `docs/plans/.../notes.md` | This file | plan-execution |

## Edge cases / traps handled

| Trap | Handled by | Pinned by |
| ---- | ---------- | --------- |
| T1 delimiter over-merge | Nested tagged JSON tree | U-10, U-11, I-2 |
| T2 per-value registry | Call-scoped `IdentityRegistry` | U-14, I-6b |
| T3 `isEqual` converter-sensitive | Key refs by `.path` | U-7 |
| T4 unsorted map keys | `.sort()` on keys | U-1, U-3, U-24, I-1, I-4a |
| T5 loose `!= undefined` | Strict `=== undefined` drop | U-13, I-3 |
| T6 NaN / -0 | `numberKey` + `['d']` tag | U-12, U-16, U-17 |
| T7 cycle / depth crash | `seen` + `MAX_DEPTH` markers | U-18, U-20, I-6c |
| T8 duck-typing | Nominal `instanceof` first | U-19, U-12, I-1 |
| T9 multi-site | Collection / group / converter tests | I-1, I-2, I-4, I-5, I-6 |
| T10 untested util | Unit file + gate | `test:coverage:gate:unit` |
| T11 range collapse | Footers → `(#41)` | grep audit |

## Tests added

| Id | Suite | Asserts | Guards |
| -- | ----- | ------- | ------ |
| U-1…U-23 | unit `firestoreValueEquality` | behavior matrix | T1–T8, D4, N3, N12 |
| U-24 | unit `queryBuilderTerminals` | call-site wiring | T4 |
| I-1 | integration query-builder | real decoded structured equality | T4, T8, N10 |
| I-2 | integration query-builder | different structured stay distinct | T1, T8 |
| I-3 | existing (unedited) | null vs undefined | T5 |
| I-4a/b | integration collection-group | equal/different maps across depths | T4, T9 |
| I-5 | existing (unedited) | stored-path + select rejection | D3, R2 |
| I-6a/b/c | integration converter | Date merge / identity / cycle | D4, T2, T7 |

## Mutation checks

| Test | Mutation | Result |
| ---- | -------- | ------ |
| U-1 | Remove `.sort()` | **Fails** — Expected length 1, received 2 |
| U-14 | Fresh `IdentityRegistry` per value | **Fails** — Expected length 3, received 1 |
| U-10 | Delimiter-join `naiveKey` | **Fails** — Expected length 2, received 1 |
| U-17 | Encode `-0` distinctly via `Object.is` | **Fails** — Expected length 1, received 2 (plan's literal `String(value)` is a no-op in JS) |
| U-12 | Bare number + bare null | **Fails** — NaN vs null → length 1 |
| U-13 | Drop via `value == null` | **Fails** — expected `[null]`, got `[]` |
| U-18 | Remove `seen` **and** `MAX_DEPTH` | **Fails** — `RangeError: Maximum call stack size exceeded` (cycle guard alone is masked by depth) |
| U-7 | Key refs by `identityKey` instead of `.path` | **Fails** — Expected length 1, received 2 |

## Gate results

### Run 1 (pre self-review fixes)

Suite counts: unit **32 / 407** (was 31 / 383); integration **34 / 503** (was 34 / 497; +6 then I-6c made +7 on run 2).

```
npm run test:types                         ✓
npm run lint                               ✓
npm run check:format                       ✓ (after prettier --write)
npm run test:unit                          ✓ 32 suites / 407 tests
npm run test:integration:emulator          ✓ 34 suites / 503 tests (pre I-6c)
npm run test:unit:coverage + gate:unit     ✓ All unit coverage gates passed (utils incl. new file)
npm run test:integration:coverage + gate   ✓ All integration coverage gates passed
npm run build                              ✓
npm run check:package                      ✓ 94 files
npm run check:consumer                     ✓ firebase-admin@^14.0.0 (dev peer only)
npm run check:docs                         ✓ 183 doc files scanned
npm run docs:build                         ✓; no leaked `:::` (no new aside added — check vacuous)
```

Probes: `P-canonical-key-algorithm.mjs` exit 0 (NESTED 0/27 wrong); `N-instanceof-across-read-path.mjs` ALL NOMINAL CHECKS HOLD.

### Run 2 (after F1/F2 fixes) — `/tmp/gate-rerun2.log`, EXIT=0

```
npm run test:types                         ✓
npm run lint                               ✓
npm run check:format                       ✓
npm run test:unit                          ✓ 32 / 407
npm run test:integration:emulator          ✓ 34 / 504  (+7 vs baseline 497)
npm run test:unit:coverage + gate:unit     ✓
npm run test:integration:coverage + gate   ✓
npm run build                              ✓
npm run check:package                      ✓
npm run check:consumer                     ✓ firebase-admin@^14.0.0
npm run check:docs                         ✓ 183 doc files
npm run docs:build                         ✓ Complete!
```

## Anti-instructions checklist

| Anti-instruction | Confirmed |
| ---------------- | --------- |
| No `isEqual` as dedupe primitive | ✓ keys by path / tagged tree |
| No delimiter-joined keys | ✓ nested JSON tree |
| No duck-typed recognizers | ✓ `instanceof` + `isGenuineVectorValue` |
| No options / overload on `distinctValues` | ✓ signature unchanged |
| No `select(field)` / field mask | ✓ raw read untouched |
| No shared `isPlainObject` extract from `safeObject` | ✓ local duplicate kept |
| Not exported from `index` / `vector` | ✓ |
| No edits to `website/.../2.0/**` | ✓ |
| ADR number from `ls`, not hardcoded | ✓ claimed 0034 after `ls` |
| No `(#40–#41)` / `(#41–#41)` in live footers | ✓ all `(#41)`; historical 0017:#39 amendment kept |
| No sweep of `README.md:17,19` | ✓ |
| No `CHANGELOG.md` hand-edit | ✓ |
| No `review.md` written by implementer | ✓ |
| §5 unverified not claimed verified | ✓ see Could-not-verify |
| No commit unless asked | ✓ |

## §11 audit

| §11 item | Result | Evidence |
| -------- | ------ | -------- |
| Branch rebased; §3.1 re-verified | PASS | rebase no-op; `QueryBuilder.ts:1364` was `new Set`, now `distinctFirestoreValues` |
| Util verbatim §6.1 + 6 invariants | PASS | `src/utils/firestoreValueEquality.ts` |
| QB edits 1–3; signature unchanged | PASS | import L20; JSDoc; return L1365 |
| No options / mask / public export | PASS | D2/D3/D6; `grep distinctValues src/index.ts` empty for util |
| U-1…U-23 with JSDoc header | PASS | `firestoreValueEquality.unit.test.ts` |
| U-24 | PASS | `queryBuilderTerminals.unit.test.ts` |
| I-1, I-2, I-4, I-6; I-3/I-5 unedited | PASS | three integration files |
| Eight §8.4 mutations recorded | PASS | Mutation checks section |
| §8.5 every trap/site | PASS | after I-6c for T7@converter |
| ADR-0034 filed, 11 content items | PASS | `docs/adr/0034-…md` |
| README index row after 0033 | PASS | `docs/adr/README.md` |
| 0017 new amendment + singular #41 refs | PASS | amendment after #39 block; References bullet |
| Ten live footers → `(#41)`; README/0017 history untouched | PASS | grep audit |
| No `(#40–#41)` / `(#41–#41)` live | PASS | only historical #39 amendment keeps `#40–#41` |
| #75 in Notes + ADR scope; not Deferred/footers | PASS | after F1 footer fix |
| Capability row moved | PASS | `scope-and-capabilities.md` |
| Three Starlight pages; no new `:::` aside | PASS | queries/query-builder/migration; vacuous ::: check |
| §9.4 greps incl. no `new Set(values)` | PASS | empty |
| 14-leg gate; suites up | PASS | run 2: 32/407, 34/504 |
| Plan probes re-run | PASS | exit 0 / ALL NOMINAL CHECKS HOLD |
| §7 anti-instructions | PASS | checklist above |
| Refute-first self-review | PASS | dispositions below |
| Commit subject ready; no BREAKING; no CHANGELOG edit | PASS | see handoff |
| Plan dir still present | PASS | not `git rm`'d |

## Independent adversarial review

**Reviewer:** Task subagent `generalPurpose` (id `9f79d31b-c85e-4634-9023-13a1767d7bd1`), fresh context,
implementation-review refute prompt · **Reviewed:** working tree on `6620b9e` + uncommitted
implementation · **Fixes in:** working tree (F1, F2) · **Verdict:** pass-with-nits → dispositions
applied

Given: diff, plan, tests — **not** these notes. Prompted to refute.

### Findings fixed

1. **F1 minor — ADR-0034 living footer cited #75** — Removed #75 from the living-index footer;
   kept in Related + Decision scope (§9.5). File: `docs/adr/0034-…md` footer.
2. **F2 minor — T7 @ converter untested** — Added I-6c cyclic converter test.

### Findings not treated as defects

- **F3** — I-2 second delta: already deviation #2 with emulator evidence; U-5 pins nanoseconds.
- **F4** — Symbol-keyed plain-object over-merge: §6.1 verbatim uses `Object.keys`; unreachable for
  stored Firestore maps. Residual converter exotic; not a plan violation.
- **F5** — Plural "deferrals (#41)": cosmetic nit; T11 form `(#41)` is correct.

### Findings deferred

(none)

### Gate re-run after fixes

Full 14-leg chain EXIT=0 (`/tmp/gate-rerun2.log`). Unit 32/407; integration 34/504.

## External review (round 1) — dispositions

**Source:** `docs/plans/issue-40-distinct-values-semantic-equality/review.md` (Claude Code Opus 5,
APPROVE WITH FIXES). Reviewed uncommitted working tree on `6620b9e`. Implementer did **not** edit
`review.md`.

### Findings fixed

1. **M1 major — absolute "cannot crash" invariant is false** — Narrowed claims in
   `src/utils/firestoreValueEquality.ts` (MAX_DEPTH JSDoc) and ADR-0034 Decision 5: depth/`seen`
   bound *recursion depth* only; shared-subtree DAG from `readConverter` can still OOM because the
   canonical form is fully expanded. Memoization filed as [#77](https://github.com/reggieofarrell/firestore-orm/issues/77);
   linked from ADR Related/References and the util JSDoc.

2. **N1 minor — stale I-2 header comment** — Reworded
   `repository-query-builder.integration.test.ts` header from "Timestamps differing by a
   nanosecond" to "Timestamps a full second apart (see the note below)", matching deviation #2 and
   the inline comment at the seed site.

### Findings deferred

3. **N2 minor — `VectorValue` by-value equality pinned only in-process** — Coverage gap, not a
   defect (reviewer verified decoded path on emulator). Deferred to
   [#76](https://github.com/reggieofarrell/firestore-orm/issues/76); linked from ADR-0034 Related /
   References. Not in living footers (not an ADR-0017 deferral).

### Findings not treated as defects

4. **N3 nit — `check:docs` count 183 vs plan's 182** — Arithmetic miss in PLAN.md (§10 counted ADR
   but not `notes.md`). No code action; not re-quoted elsewhere.

### Gate re-run after external-review remediation

### Run 3 (after M1/N1 + #76/#77 bookkeeping) — `/tmp/gate-rerun3-issue40.log`, EXIT=0

```
npm run test:types                         ✓
npm run lint                               ✓
npm run check:format                       ✓ (prettier --write on ADR-0034 after Decision 5 edit)
npm run test:unit                          ✓ 32 / 407
npm run test:integration:emulator          ✓ 34 / 504
npm run test:unit:coverage + gate:unit     ✓
npm run test:integration:coverage + gate   ✓
npm run build                              ✓
npm run check:package                      ✓
npm run check:consumer                     ✓ firebase-admin@^14.0.0
npm run check:docs                         ✓ 184 doc files (183 + review.md now present)
npm run docs:build                         ✓ Complete!
```

## Could-not-verify

Carried from plan §5:

- CI peer matrix (`admin-compat` / `firestore-floor-compat`) not run locally — only
  `check:consumer` against `firebase-admin@^14.0.0`.
- Production Firestore behavior not observed (emulator only), including map key-order normalization
  and `-0` round-trip.
- Duplicated `@google-cloud/firestore` defeating `instanceof` not reproduced (degrades to identity).

## Open questions for the reviewer

None blocking. Optional: whether F4 (symbol keys) deserves a follow-up issue — implementer left it
as residual §6.1 risk, not a new issue.
