# Issue #37 — Implementation notes (for adversarial review)

**Implementer:** agent (Cursor Grok 4.5) · **Branch:** `cursor/issue-37-query-explain` · **Plan:**
`docs/plans/issue-37-query-explain/PLAN.md` · **Baseline:** plan cites `main` @ `746bb7f`; branch
already contained `main` @ `0db80f1` (no rebase — `HEAD..main` empty). §3 line numbers for `get()`
(~1439), collection `toResult` (~1485), group `toResult` (~182), vector cast (~175), exports (~15)
re-verified before editing; no cite drift.

## Status

**Done — pending external review.** Shipped `explain()` on `FirestoreQueryBuilderBase` +
`VectorQueryBuilder`, `QueryExplainResult` from root and `/vector`, unit/integration/type tests,
ADR-0031, living-index footers → `(#38–#41)`, Starlight updates, follow-up [#65](https://github.com/reggieofarrell/firestore-orm/issues/65).
Full §10 gate green twice (before and after adversarial fixes). Plan directory left in place.
**Committed** on `cursor/issue-37-query-explain` (local; Part A).

## Ambiguities resolved

- ADR number claimed from live `docs/adr/`: **0031** (next free after 0030).
- Follow-up `explainStream` issue opened as **#65**.
- Historical ADR-0017 #36 amendment still says remaining `(#37–#41)` — left untouched per §9.3
  “never rewrite earlier amendments.” Living footers and new #37 amendment use `(#38–#41)`.
  §10’s “grep `#37–#41` must be empty” therefore still matches that one historical line; recorded
  as intentional (Deviation 1).

## Deviations from the plan

1. **§10 grep `#37–#41` not empty on ADR-0017** — historical #36 amendment retained per §9.3.
   Living footers and References updated to `#38–#41` / point #37 at ADR-0031.
2. **U-5 strengthened beyond plan text** — plan said “plain Error message preserved for No explain
   results”; that cannot fail if `parseFirestoreError` is removed (ErrorParser rethrows `Error`).
   Post-review F1: U-5 now uses a coded `{ code: 5 }` rejection → `NotFoundError`.
3. **Added U-5v** (vector parseFirestoreError path) — not in §8 table; added for adversarial F5.
4. **Extended `scripts/check-packed-consumer.mjs`** to import `QueryExplainResult` from root and
   `/vector` (adversarial F4 / plan S5 intent).
5. **First `test:integration:emulator` attempt** hit a flaky unrelated vector-search ordering
   failure (`nearest` vs `middle`); re-run was green. Not an explain regression.

## Files touched and why

| File | Change | Plan reference |
| ---- | ------ | -------------- |
| `src/core/QueryBuilder.ts` | D9 aliases, `QueryExplainResult`, `explain()` on base | §6.1 |
| `src/vector/VectorQueryBuilder.ts` | optional `explain?`, `explain()` after findNearest | §6.2 |
| `src/index.ts` | export `QueryExplainResult` | §6.3 |
| `src/vector/index.ts` | re-export `QueryExplainResult` | §6.3 / D5 |
| `src/tests/unit/query-explain.unit.test.ts` | U-1…U-9 + U-2v/U-3v/U-4g + U-5v | §8.1 |
| `src/tests/integration/query-explain.integration.test.ts` | I-1…I-4 | §8.2 |
| `src/tests/types/query-explain.type-test.ts` | T-1…T-4 | §8.3 |
| `scripts/check-packed-consumer.mjs` | import `QueryExplainResult` root+/vector | F4 |
| `docs/adr/0031-query-explain.md` | new ADR | §9.2 |
| `docs/adr/README.md` | index row | §9.2 |
| `docs/adr/0017-…` + 0023–0030 footers | amendment + living index | §9.3 |
| Starlight: scope, query-builder, queries, vector-search, migration | docs | §9.4 |
| `docs/plans/.../notes.md` | execution artifacts | skill |

**Deliberately not touched:** `ErrorParser`, express, `packageExports.unit.test.ts`, READMEs,
`website/**/2.0/**`, CHANGELOG, generated agent config.

## Edge cases / traps handled

| Trap | Handled by | Pinned by |
| ---- | ---------- | --------- |
| T1 null vs [] | Distinct branches Core+vector | U-2, U-3, U-2v, U-3v |
| T2 raw ExplainResults | `QueryExplainResult` + toResult | U-4, T-2 |
| T3 group toResult | method on base; group inherits | U-4g |
| T4 required explain | `explain?` optional | compiles; U-9 |
| T5 explainStream | not implemented | anti-checklist |
| T6 emulator success | integration asserts throw | I-1…I-4 |
| T7 ErrorParser mapping | none added | U-5 coded path |
| T8 Core capability | typeof guard | U-6 |
| T9 vector before findNearest | guard | U-7 |
| T10 living index | footers → #38–#41 | grep |
| T11 ::: leak | docs:build + grep | gate |
| T12 Explain\* imports | D9 aliases only | source grep |

## Tests added

| Id | Suite | Asserts | Guards |
| -- | ----- | ------- | ------ |
| U-1 | unit | options forwarded | D2 |
| U-2 / U-3 | unit | null vs [] | T1 |
| U-4 / U-4g | unit | collection / group toResult | T2/T3 |
| U-5 | unit | coded error → NotFoundError | D7 |
| U-6 | unit | missing explain | T8 |
| U-7 / U-8 | unit | findNearest gate + mapping | T9/D2 |
| U-2v / U-3v | unit | vector null vs [] | T1/S2 |
| U-9 | unit | vector missing explain | D6 |
| U-5v | unit | vector parseFirestoreError | F5 |
| I-1…I-4 | integration | emulator No explain results | T6 |
| T-1…T-4 | types | return / projection / distance / exports | D2/D5 |

## Mutation checks

| Test | Mutation | Result |
| ---- | -------- | ------ |
| U-2 | Core: plan-only `null` → `[]` | **Fails** — `Expected: null, Received: []` |
| U-3 | Core: empty docs → `null` | **Fails** — `Expected: [], Received: null` |
| U-4g | Core: map `{…data,id}` instead of `toResult` | **Fails** — missing `path`/`parentPath` |
| U-5 | Core: `throw error` instead of `parseFirestoreError` | **Fails** — Expected `NotFoundError`, Received `Object` |
| U-2v | Vector: null → `[]` | **Fails** — `toBeNull` on `[]` |
| U-3v | Vector: empty → `null` | **Fails** — Expected `[]`, Received `null` |
| I-1 | Core: explain returns fake success (no SDK call) | **Fails** — promise resolved instead of rejected |

## Gate results

### Run 1 (before adversarial fixes)

| Leg | Result |
| --- | ------ |
| `test:types` | ✓ |
| `lint` | ✓ |
| `check:format` | ✓ (after prettier on ADRs) |
| `test:unit` | ✓ **31 suites / 382 tests** (was 30 / 370) |
| `test:integration:emulator` | ✓ **31 / 456** (was 30 / 452); one flaky re-run needed |
| `test:unit:coverage` + `gate:unit` | ✓ |
| `test:integration:coverage` + `gate:integration` | ✓ (QueryBuilder / vector gates pass) |
| `build` | ✓ |
| `check:package` | ✓ |
| `check:consumer` | ✓ (admin ^14) |
| `check:docs` | ✓ |
| `docs:build` + `:::` grep | ✓ no leak |

### Run 2 (after adversarial fixes)

| Leg | Result |
| --- | ------ |
| All 14 legs | ✓ |
| `test:unit` | ✓ **31 / 383** (+U-5v) |
| `test:integration:emulator` | ✓ **31 / 456** |
| `check:consumer` | ✓ (now imports `QueryExplainResult`) |
| `:::` grep | ✓ no leak |

## Anti-instructions checklist

| Anti-instruction | Confirmed |
| ---------------- | --------- |
| No `explainStream` | ✓ (JSDoc mention only) |
| No AggregateQuery.explain wrap | ✓ |
| No raw ExplainResults return | ✓ |
| No null ↔ [] coerce | ✓ |
| explain on base, not collection-only | ✓ |
| Vector requires findNearest | ✓ |
| No ErrorParser mapping for No explain results | ✓ |
| No firebase-admin peer bump | ✓ |
| No Explain\* import from admin or gcloud | ✓ |
| Vector explain optional | ✓ |
| No hasLimitToLast reject on explain | ✓ |
| Docs do not claim emulator metrics work | ✓ |
| No 2.0 archive / CHANGELOG / agent-config edits | ✓ |
| Do not commit unless asked | ✓ |

## §11 audit

| §11 item | Result | Evidence |
| -------- | ------ | -------- |
| 1 D1–D9 / anti-instructions | PASS | source + checklist above |
| 2 explain on base + vector; exports | PASS | `QueryBuilder.ts:1501`, `VectorQueryBuilder.ts:246`, `index.ts`, `vector/index.ts` |
| 3 group inherits; U-4g | PASS | `query-explain.unit.test.ts` U-4g |
| 4 Core + vector typeof guards | PASS | U-6, U-9 |
| 5 D9 aliases only | PASS | local `type ExplainOptions = …` in both files |
| 6 tests + mutation checks | PASS | mutation table; U-5 strengthened |
| 7 I-1…I-4 | PASS | `query-explain.integration.test.ts` |
| 8 T-1…T-4 | PASS | `test:types` green |
| 9 ADR-0031 + 0017 + footers | PASS | `docs/adr/0031-*.md`; footers `#38–#41` |
| 10 Starlight pages | PASS | scope / query-builder / queries / vector / migration |
| 11 explainStream follow-up | PASS | [#65](https://github.com/reggieofarrell/firestore-orm/issues/65) |
| 12 READMEs unaffected; packageExports untouched | PASS | no README diff; packageExports diff empty |
| 13 Full gate; suite counts up | PASS | gate run 1+2; 30→31 suites both |
| 14 notes.md | PASS | this file (commit deferred per instruction) |
| 15 probes → committed tests | PASS | §8 tests exist; probes remain for history |
| 16 remove plan dir | N/A yet | left in place for review |

## Independent adversarial review

**Reviewer:** Task subagent [Adversarial review #37](5bf784b5-d149-44f9-8aa0-32f20fdb4fee) ·
**Reviewed:** post-gate-1 tree · **Fixes in:** same tree · **Verdict:** pass with fixes → pass after
remediation

Adversarial self-review stayed in the implementer report (not written as `review.md` — that
filename is reserved for an external reviewer). Handed diff/plan/tests — **not** these notes.
Prompted to refute. Dispositions summarized below.

### Findings fixed

1. **F1 major — U-5 false green** — coded error → `NotFoundError`; mutation fails without
   `parseFirestoreError`.
2. **F2 major — ADR probe path rot** — inlined probe summary; dropped plan path.
3. **F3 major — /vector docs omit type** — `QueryExplainResult` listed in vector-search.md.
4. **F4 minor — packed consumer** — imports from root and `/vector`.
5. **F5 minor — vector catch untested** — U-5v added.
6. **F6 nit — #65 link in queries.md** — linked.

### Findings not treated as defects

- None remaining after remediation. F7 process items closed by re-gate + notes.

### Findings deferred

- None.

### Gate re-run after fixes

All 14 legs green again. Unit **31 / 383**, integration **31 / 456**.

## Could-not-verify

Carried from plan §5:

- Production metrics shape — never executed against a real Firestore project.
- Peer matrix legs — local work used admin 14 + firestore 8.6.0; CI owns fan-out.
- Exact firestore 7.4 floor not installed locally for the typeof guard (guard is unit-tested).

## Open questions for the reviewer

- Whether to add a separate issue for `AggregateQuery.explain` (mentioned optionally in #65) —
  currently only a note on #65.
- Whether the historical ADR-0017 `#37–#41` in the #36 amendment should ever be rewritten for grep
  cleanliness (we left it per §9.3).
