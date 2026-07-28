# Issue #36 — Implementation notes (for adversarial review)

**Implementer:** cloud agent (Cursor Grok 4.5) · **Branch:**
`cursor/issue-36-typed-query-bounds-8a8d` · **Plan:**
`docs/plans/issue-36-typed-query-bounds/PLAN.md` · **Baseline:** plan authored against `main` @
`387db6f`; tip at start was `b1ab4b4` (plan merge via #62). Plan branch
`cursor/issue-36-typed-query-bounds-3dc6` was already deleted after merge — cut
`cursor/issue-36-typed-query-bounds-8a8d` from current `main` instead. §3.4 line numbers re-verified
(minor drift only; symbols unchanged).

## Status

Done-pending-external-review. Typed bounds / `offset` / `limitToLast` shipped on
`FirestoreQueryBuilderBase` with guards, both `select()` flag copies, §8 tests (plus review
additions), ADR-0030 + bookkeeping, Starlight docs. Full §10 gate green after adversarial-review
fixes. **Maintainer review findings 1–4 addressed** (`hasOffset` guards; `getOne`/`exists` skip
`.limit(1)` under `limitToLast`; ADR/docs notes). Plan directory left in place for review.

## Ambiguities resolved

1. **Plan branch missing** — created `cursor/issue-36-typed-query-bounds-8a8d` from current `main`
   (cloud agent branch suffix). Plan content already on `main` via #62.
2. **Shared empty-args helper** — used `assertBoundArgs(method, args)` for all four bound methods.
3. **Stale “no startAfter” copy outside §9.4** — also updated `express.md` and `examples.md` (not
   frozen `2.0/**`).
4. **I-13 `orderByPath` + `limitToLast().get()`** — emulator throws
   `FAILED_PRECONDITION: does not support descending key scans`. Kept score-field `.get()` coverage;
   `orderByPath` only asserts the local `hasOrderBy` guard (no `.get()`).
5. **Probe F2 “group foreign → empty”** — empty was caused by the foreign snap’s **score:99** field
   values, not membership rejection. Tests and ADR-0030 now state that group foreign snaps use
   orderBy field values (empty or suffix depending on those values).

## Deviations from the plan

1. **Branch name** — used `…-8a8d` because `…-3dc6` was gone after plan merge.
2. **Extra Starlight pages** — also fixed `express.md` / `examples.md` (not 2.0 archive).
3. **Unit file** — new `queryBuilderBounds.unit.test.ts` instead of extending stream suite; added
   U-select-copy (collection + group), `limitToLast(0)`, empty-args siblings beyond U-1…U-4.
4. **I-13 orderByPath** — local-guard only (emulator RPC impossible); score `startAt`/`limitToLast`
   still end-to-end.
5. **Foreign-cursor tests** — added I-16/I-17 after review F4; refined F2 interpretation (field
   values, not membership).
6. **Stale “whole result set” JSDoc** — updated `assertCursorBelongsToSource` comments on base +
   group to current emulator contracts. Left Accepted ADR-0024 historical Context prose untouched
   (ADR-0030 already notes staleness).

## Files touched and why

| File | Change | Plan reference |
| ---- | ------ | -------------- |
| `src/core/QueryBuilder.ts` | Bounds, offset, limitToLast, flag, guards, select copy, JSDoc | §6.1–6.7 |
| `src/core/CollectionGroup.ts` | `hasLimitToLast` select copy + JSDoc | §6.7 / T3 |
| `src/tests/integration/query-bounds.integration.test.ts` | I-1…I-17 | §8.1 + review |
| `src/tests/unit/queryBuilderBounds.unit.test.ts` | U-1…U-4, U-select-copy×2, siblings | §8.2 + review |
| `src/tests/types/query-bounds.type-test.ts` | T-1…T-4 | §8.3 |
| `docs/adr/0030-…` + README + 0017 amendment + living footers | Bookkeeping | §9 |
| Starlight query-builder / queries / subcollections / scope + express/examples | Docs | §9.4 |

## Edge cases / traps handled

| Trap | Handled by | Pinned by |
| ---- | ---------- | --------- |
| T1 flag sticky after `limit()` | `limit()` clears `hasLimitToLast` | I-11, U-2 |
| T2 paginate+limitToLast silent override | local throw in paginate/offsetPaginate | I-9, I-15 |
| T3 select drops flag | both select() sites copy flag | I-12, I-13b, U-select-copy×2 |
| T4 onSnapshot wrongly guarded | no guard on onSnapshot | I-14 |
| T5 arity==orderBy.length | not added | (by absence) |
| T6 opaque token change | encodeCursor untouched | (by absence) |
| T7 methods only on concrete builder | methods on base | I-13, T-2 |
| T8 offset via assertPositiveInt | assertNonNegativeInt | I-10, U-4 |
| T9 DocumentReference footgun | JSDoc on startAt | docs |
| T10 aside fence leak | grepped built HTML — none | §10 |
| T11 ADR footer partial sweep | grepped `#36–#41` living footers | ADR files |

## Tests added

| Id | Suite | Asserts | Guards |
| -- | ----- | ------- | ------ |
| I-1…I-14 | integration | bounds, reverse page, guards, group, onSnapshot | §8.1 |
| I-15…I-17 | integration | limitToLast(0), paginateWithCount reject, foreign snaps | review F4/F8 |
| I-13b | integration | group select flag copy | review F3 |
| U-1…U-4 (+siblings) | unit | stream/offset/empty-args/last-wins | §8.2 |
| U-select-copy ×2 | unit | collection + group select flag | review F3/F6 |
| T-1…T-4 | types | collection + group surface; vector absent | §8.3 |

## Mutation checks

| Test | Mutation | Result |
| ---- | -------- | ------ |
| All `queryBuilderBounds` | Revert `QueryBuilder.ts` + `CollectionGroup.ts` to `main` | **Fails** — methods missing (`*.startAt is not a function`, etc.) |
| U-2 | Remove `hasLimitToLast = false` from `limit()` | **Fails** — `stream() is not supported after limitToLast` |
| select flag (ephemeral) | Drop collection `select` flag copy | **Fails** — stream resolves instead of rejecting |
| paginate guard (ephemeral) | Remove paginate `hasLimitToLast` check | **Fails** — paginate resolves with a forward page |

## Gate results

Baseline @ `387db6f`: unit **29 / 356**, integration **29 / 429**.

**Run 1 (pre-review):** types ✓, lint ✓, format ✗ (prettier), unit **30 / 363**, integration ✗
(I-13 orderByPath+.get), then format+I-13 fixed before review.

**Run 2 (after adversarial fixes):**

```
npm run test:types                         ✓
npm run lint                               ✓
npm run check:format                       ✓
npm run test:unit                          ✓  30 suites / 366 tests  (was 29 / 356)
npm run test:integration:emulator          ✓  30 suites / 447 tests  (was 29 / 429)
npm run test:unit:coverage + gate:unit     ✓
npm run test:integration:coverage + gate   ✓  QueryBuilder/CollectionGroup thresholds met
npm run build                              ✓
npm run check:package                      ✓
npm run check:consumer                     ✓  firebase-admin@^14 local peer leg
npm run check:docs                         ✓
npm run docs:build                         ✓  grepped built HTML — no leaked `:::`
```

Both suite counts and both test counts went up as predicted.

## Anti-instructions checklist

| Anti-instruction | Confirmed |
| ---------------- | --------- |
| Do not change encodeCursor / decodeCursor / opaque tokens | Yes — untouched |
| Do not add startAt only on FirestoreQueryBuilder | Yes — on base |
| Do not reject onSnapshot after limitToLast | Yes — I-14 |
| Do not add orderBy-arity equality checks | Yes — none added |
| Do not apply assertCursorBelongsToSource to typed bounds | Yes |
| Do not modify VectorQueryBuilder | Yes — T-4 |
| Do not add index.ts exports / ErrorParser mappings | Yes |
| Do not rewrite earlier ADR-0017 amendment blockquotes | Yes — appended #36 |
| Do not edit website 2.0 archive | Yes |
| Do not hand-edit CHANGELOG.md | Yes |
| Do not delete plan directory until after review | Yes — still present |
| Do not claim production foreign-cursor beyond §5 | Yes — ADR + notes |

## §11 audit

| §11 item | Result | Evidence |
| -------- | ------ | -------- |
| 1 D1–D9; opaque cursors unchanged | PASS | `QueryBuilder.ts` methods; encode/decode untouched |
| 2 Bounds/offset/limitToLast on base + JSDoc | PASS | `QueryBuilder.ts` ~619–724 |
| 3 hasLimitToLast set/clear; both select copies | PASS | set/clear + `QueryBuilder.ts` select + `CollectionGroup.ts` select; I-12/I-13b/U-select-copy |
| 4 stream/paginate/offsetPaginate guards; onSnapshot not | PASS | guards in source; I-8/I-9/I-14 |
| 5 §8 tests, mutation-checked, pass on fixed tree | PASS | this notes Mutation + Gate sections |
| 6 ADR-0030 + README row | PASS | `docs/adr/0030-…`, `docs/adr/README.md` |
| 7 0017 #36 amendment; footers → `#37–#41` | PASS | 0017 append; 0023–0027/0029/0030 living footers |
| 8 Starlight §9.4; no leaked `:::` | PASS | pages updated; docs:build grep clean |
| 9 Capability matrix Deferred→Supported | PASS | `scope-and-capabilities.md` |
| 10 READMEs declared unaffected in PR body | PASS | PR body |
| 11 No §7 anti-instruction violations | PASS | checklist above |
| 12 Full gate green | PASS | Run 2 above |
| 13 notes.md committed | PASS | this file |
| 14 Assertions in committed tests | PASS | I-*/U-*/T-* in tree; probes remain for reference |
| 15 Plan dir removed after review | N/A | still present (correct) |

## Independent adversarial review

**Reviewer:** fresh `generalPurpose` subagent · **Reviewed:** `b7964fa` (+ WIP) · **Fixes in:**
follow-up commit on this branch · **Verdict after fixes:** pass with fixes · Full report:
`docs/plans/issue-36-typed-query-bounds/review.md`

Given: diff vs main, `PLAN.md`, tests — **not** these notes. Prompted to refute.

### Findings fixed

1. **F1 critical — I-13 orderByPath+.get()** — emulator precondition; local-guard-only assert.
2. **F2 critical — prettier** — `--write` on warned paths.
3. **F3 high — group select flag untested** — I-13b + U-select-copy (group).
4. **F4 high — ADR overclaimed foreign pins** — added I-16/I-17; corrected F2 mechanism in ADR.
5. **F5 medium — stale “whole result set” JSDoc** — updated base + group `assertCursorBelongsToSource`
   comments; left Accepted ADR-0024 Context historical.
6. **F6 medium — U-select-copy missing** — added collection + group unit cases.
7. **F8 low — limitToLast(0) / paginateWithCount** — I-15 + unit `limitToLast(0)`.
8. **F9 low — I-14 setTimeout flake** — wait on first emission with 5s timeout.
9. **F10 low — gate honesty** — Run 2 green; PR body updated.

### Findings not treated as defects

- **F7 medium — zero-arg bounds type-legal** — §6 overload shape is `(...fieldValues: unknown[])`
  matching the plan; runtime `assertBoundArgs` rejects empty calls (U-3). Changing the public
  overload would re-litigate D2/§6.

### Findings deferred

- None opened as follow-up issues. ADR-0024 historical Context prose left as Accepted history
  (covered by ADR-0030 + source JSDoc).

### Gate re-run after fixes

All fourteen §10 legs green (Run 2). Suite counts: unit 30/366, integration 30/447.

## Could-not-verify

- Production Firestore foreign-cursor behavior may differ from emulator — tests pin emulator only.
- Local `check:consumer` covered `firebase-admin@^14` only; CI fans out `^12`/`^13`/`^14`.
- Missing `docs/development/v3-release-review.md` — not invented.
- Deferred product work: reverse opaque `prevCursor`; field-value opaque tokens; `PaginatedResult`
  cleanup; `limit()` positive-int hardening.
- Emulator `orderByPath` + `limitToLast().get()` RPC — not exercised end-to-end (documented).

## Open questions for the reviewer

None.

## Maintainer review follow-up (PR comment)

Addressed findings 1–4 from the GitHub review:

1. **`hasOffset` flag** — set in `offset()`; `paginate` / `offsetPaginate` reject; both `select()`
   sites copy it (R1/R2/R1b tests).
2. **`getOne` / `exists`** — skip `.limit(1)` when `hasLimitToLast` so last-N semantics hold
   (R3/R4).
3. Smaller notes: ADR-0030 Context aligned with Consequences; ADR-0024 amendment for stale foreign
   cursor claim; `queries.md` / `query-builder.md` updated; bound-method JSDoc notes sync SDK throws.
