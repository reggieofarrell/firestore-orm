# Issue #36 — Implementation notes (for adversarial review)

**Implementer:** cloud agent (Cursor Grok 4.5) · **Branch:**
`cursor/issue-36-typed-query-bounds-8a8d` · **Plan:**
`docs/plans/issue-36-typed-query-bounds/PLAN.md` · **Baseline:** plan authored against `main` @
`387db6f`; current tip was `b1ab4b4` (plan merge via #62). Plan branch
`cursor/issue-36-typed-query-bounds-3dc6` was already deleted after merge — cut
`cursor/issue-36-typed-query-bounds-8a8d` from current `main` instead. §3.4 line numbers re-verified
(minor drift only; symbols unchanged).

## Status

Implementation + tests + ADR/docs in progress toward full §10 gate. Core API, both `select()` flag
copies, §8 tests, ADR-0030, living-index footers, and Starlight pages are written. Mutation checks
and full gate still owed below.

## Ambiguities resolved

1. **Plan branch missing** — created `cursor/issue-36-typed-query-bounds-8a8d` from current `main`
   (cloud agent branch suffix). Plan content already on `main` via #62.
2. **Shared empty-args helper** — plan allowed a tiny private helper; used `assertBoundArgs(method,
   args)` for all four bound methods.
3. **Stale “no startAfter” copy outside §9.4** — also updated `express.md` and `examples.md` (not
   frozen `2.0/**`) so consumer docs do not contradict the new API. Recorded as a docs-accuracy
   expansion, not an API change.

## Deviations from the plan

1. **Branch name** — plan header named `cursor/issue-36-typed-query-bounds-3dc6`; that ref no longer
   exists remotely. Used `cursor/issue-36-typed-query-bounds-8a8d` per cloud-agent naming. No code
   impact.
2. **Extra Starlight pages** — §9.4 listed four pages; also fixed `guides/integrations/express.md`
   and `guides/advanced/examples.md` which still claimed “no `.startAfter()` chaining.” Left
   `website/src/content/docs/2.0/**` untouched (§7).
3. **Unit file placement** — §8.2 allowed extending `queryBuilderStream.unit.test.ts` or a small new
   file; chose new `queryBuilderBounds.unit.test.ts` so stream-only suite stays focused, and added a
   few sibling guard cases (empty `startAfter`/`end*`, `limitToLast` validation) beyond the U-1…U-4
   minimum.

## Files touched and why

| File | Change | Plan reference |
| ---- | ------ | -------------- |
| `src/core/QueryBuilder.ts` | Bounds, offset, limitToLast, flag, guards, select copy | §6.1–6.7 |
| `src/core/CollectionGroup.ts` | `hasLimitToLast` select copy | §6.7 / T3 |
| `src/tests/integration/query-bounds.integration.test.ts` | I-1…I-14 | §8.1 |
| `src/tests/unit/queryBuilderBounds.unit.test.ts` | U-1…U-4 (+ siblings) | §8.2 |
| `src/tests/types/query-bounds.type-test.ts` | T-1…T-4 | §8.3 |
| `docs/adr/0030-…` + README + 0017 amendment + living footers | Bookkeeping | §9 |
| Starlight query-builder / queries / subcollections / scope + express/examples | Docs | §9.4 |

## Edge cases / traps handled

| Trap | Handled by | Pinned by |
| ---- | ---------- | --------- |
| T1 flag sticky after `limit()` | `limit()` clears `hasLimitToLast` | I-11, U-2 |
| T2 paginate+limitToLast silent override | local throw in paginate/offsetPaginate | I-9 |
| T3 select drops flag | both select() sites copy flag | I-12 |
| T4 onSnapshot wrongly guarded | no guard on onSnapshot | I-14 |
| T5 arity==orderBy.length | not added | (by absence; P14) |
| T6 opaque token change | encodeCursor untouched | (by absence) |
| T7 methods only on concrete builder | methods on base | I-13, T-2 |
| T8 offset via assertPositiveInt | assertNonNegativeInt | I-10, U-4 |
| T9 DocumentReference footgun | JSDoc on startAt | docs |
| T10 aside fence leak | grepped after docs:build (pending) | §10 |
| T11 ADR footer partial sweep | grepped `#36–#41` living footers | ADR files |

## Tests added

| Id | Suite | Asserts | Guards |
| -- | ----- | ------- | ------ |
| I-1…I-14 | integration | bounds, reverse page, guards, group, onSnapshot | §8.1 |
| U-1…U-4 (+siblings) | unit | stream/offset/empty-args/last-wins | §8.2 |
| T-1…T-4 | types | collection + group surface; vector absent | §8.3 |

## Mutation checks

_(pending — run before declaring ready)_

| Test | Mutation | Result |
| ---- | -------- | ------ |
|      |          |        |

## Gate results

_(pending)_

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

_(pending final source audit)_

## Independent adversarial review

_(pending)_

## Could-not-verify

Carried from plan §5:

- No prototype was on `src/` before this work; overload cast used as planned.
- Production Firestore foreign-cursor behavior may differ from emulator — tests pin emulator.
- Local `check:consumer` covers one peer major; CI fans out `^12`/`^13`/`^14` — do not claim all
  peer legs unless run.
- Missing `docs/development/v3-release-review.md` — not invented.
- Deferred: reverse opaque `prevCursor`; field-value opaque tokens; `PaginatedResult` cleanup;
  `limit()` positive-int hardening.

## Open questions for the reviewer

None yet.
