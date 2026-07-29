# Issue #39 — Implementation notes (for adversarial review)

**Implementer:** Cursor Grok 4.5 (plan-execution subagent) · **Branch:**
`feat/issue-39-snapshot-metadata-detailed-listener` · **Plan:**
`docs/plans/issue-39-snapshot-metadata-detailed-listener/PLAN.md` · **Baseline:** `main` @
`32ce4c1` — no rebase needed (`merge-base HEAD main` === `32ce4c1`; §3.4 line numbers re-verified
against the tree and matched before editing).

## Status

**Done-pending-review.** Read snapshot metadata (`{ withMetadata: true }`) and detailed listeners
(`onSnapshotDetailed` / `listenOneDetailed`) are implemented per §6–§9. Full §10 gate passed twice
(before and after adversarial-review fixes). Plan directory left in place. **Not committed** (per
instruction).

## Ambiguities resolved

None that re-litigated §1. Mechanical choices:

- `findByField` / `getAll` metadata branches inlined like §6.3 `getAll` (rather than casting through
  `toDocumentResult`) for clean typing without `as` casts.
- Adversarial F5 addressed with both a type-test row and a runtime `getOne({ withMetadata: true })`
  assert beside I-1#13.

## Deviations from the plan

1. **None on the public contract.** Implementation follows §6 copy-verbatim for the load-bearing
   surfaces (helpers, overloads, `onSnapshotDetailed`, `listenOneDetailed`, exports).
2. **Operational:** briefly used `git checkout -- src/core/FirestoreRepository.ts` during an early
   mutation attempt, which wiped in-progress repository edits; fully re-applied from §6 before
   continuing. Subsequent mutations used in-place reverse edits only.
3. **Prettier gate:** an untracked `.claude/worktrees/issue-40-distinct-values/` tree polluted
   `prettier --check .`. Parked it outside the repo for gate runs; restored afterward. Not a product
   deviation.

## Files touched and why

| File | Change | Plan reference |
| ---- | ------ | -------------- |
| `src/core/SnapshotMetadata.ts` | New types + `buildDocumentMetadata` | §6.1 |
| `src/core/QueryBuilder.ts` | Helpers, six terminal overloads, `onSnapshotDetailed` | §6.2 |
| `src/core/FirestoreRepository.ts` | Helpers, seven read overloads, `listenOneDetailed` | §6.3 |
| `src/index.ts` | Type-only re-exports | §6.4 |
| `src/vector/index.ts` | Type-only re-exports | §6.5 |
| `src/tests/types/snapshot-metadata.type-test.ts` | T-1 (+ F4/F5 rows) | §8 T-1 |
| `src/tests/integration/repository-snapshot-metadata.integration.test.ts` | I-1 | §8 I-1 |
| `src/tests/integration/repository-detailed-listener.integration.test.ts` | I-2 | §8 I-2 |
| `src/tests/integration/repository-collection-group.integration.test.ts` | I-3 (+ F1/F3 harden) | §8 I-3 |
| `docs/adr/0033-…md` + README + ADR-0017/0023–0032 | Deferral bookkeeping | §9 |
| `website/src/content/docs/**` | Starlight contract docs | §9.6 |
| `docs/plans/…/notes.md` | This file | plan-execution |

`CollectionGroup.ts` **not** modified (R3).

## Edge cases / traps handled

| Trap | Handled by | Pinned by |
| ---- | ---------- | --------- |
| T1 | Existence guards before `buildDocumentMetadata` | I-1 #3/#5/#7/#10, I-2 #10 |
| T2 | `stream` overload signatures without `*` | T-1 + I-3 #3 |
| T3 | Four `getMany` overloads | T-1 V6 + I-1 #8 |
| T4 | `paginateWithCount` forwards 3rd arg | I-1 #13 |
| T5 | `getByIdOrThrow` forwards options | I-1 #6 + T-1 `getByIdOrThrow` row |
| T6 | Map all `docChanges` including `removed` | I-2 #5/#6 + I-3 #4 (hardened) |
| T7 | Separate `mapManySnapshotsWithMetadata` | I-1 #9 |
| T8 | Local `hasSelect` reject on `onSnapshotDetailed` | I-2 #8 |
| T9 | CG `doc.path === metadata.path` | I-3 #1–#2 |
| T10 | No boolean public overload; document hoisted opts | T-1 V2/V3 + Starlight/ADR |

## Tests added

| Id | Suite | Asserts | Guards |
| -- | ----- | ------- | ------ |
| T-1 | `test:types` | Overload matrix, ExpectEqual, CG, stream, paginateWithCount, getByIdOrThrow, getOne | T2/T3/T4/T5/T10 |
| I-1 | integration | 8 tests — reads, getMany cells, tx bare shape, converter, paginateWithCount+getOne | T1/T3/T4/T5/T7 |
| I-2 | integration | 6 tests — docChanges lifecycle, select reject, onSnapshot bare, listenOneDetailed | T6/T8/D5 |
| I-3 | integration | 3 tests — CG get/stream/onSnapshotDetailed inheritance | T2/T6/T9/R3 |

## Mutation checks

| Test | Mutation | Result |
| ---- | -------- | ------ |
| I-1#6 T5 | `getByIdOrThrow` calls `getById(id)` without options | **Fails** — `TypeError: Cannot read properties of undefined (reading 'updateTime')` |
| I-1#13 T4 | `paginateWithCount` calls `paginate(pageSize, cursor)` without options | **Fails** — `TypeError: Cannot read properties of undefined (reading 'readTime')` |
| I-2#5 T6 | `docChanges().filter(c => c.type !== 'removed')` | **Fails** — `Timed out waiting for emission: removed change` |
| I-2#8 T8 | Remove `hasSelect` guard on `onSnapshotDetailed` | **Fails** — `Received promise resolved instead of rejected` (resolved to unsubscribe) |
| I-3#2 T9 | `path: snapshot.ref.path + '/MUTATED'` in `buildDocumentMetadata` | **Fails** — `expect(row.doc.path).toBe(row.metadata.path)` mismatch |

## Gate results

**Run 1** (after implementation + docs, before adversarial fixes):

```
npm run test:types                         ✓
npm run lint                               ✓
npm run check:format                       ✓ (after prettier-write; worktree parked)
npm run test:unit                          31 suites / 383 tests (unchanged vs baseline 31/383)
npm run test:integration:emulator          34 suites / 497 tests (was 32 / 480)  ✓ +2 suites
npm run test:unit:coverage + gate:unit     ✓ (index.ts lines/branches still 100%)
npm run test:integration:coverage + gate   ✓ (QueryBuilder functions 100%)
npm run build                              ✓
npm run check:package                      ✓
npm run check:consumer                     ✓ firebase-admin@^14 local peer leg
npm run check:docs                         ✓
npm run docs:build                         ✓ ; grep ::: website/dist/ → no rows
```

**Run 2** (after F1/F3–F7 fixes): same 14 legs all ✓; suite counts still **31/383** unit and
**34/497** integration.

## Anti-instructions checklist

| Anti-instruction | Confirmed |
| ---------------- | --------- |
| Do not commit unless asked | Yes — no commit |
| Do not flag `mapManySnapshots` / touch tx reads | Yes — separate helper; `getManyInTransaction` still calls bare mapper @ 3713 |
| Do not add withMetadata to VectorQueryBuilder terminals | Yes — only type re-exports in `vector/index.ts` |
| Do not add withMetadata to explain/count/sum/average/aggregate/distinctValues/exists | Yes |
| Do not add boolean-accepting *public* overload for T10 | Yes — only implementation-signature unions |
| Do not overlay metadata onto document | Yes — sibling `{ doc, metadata }` |
| Do not change getByIdWithUpdateTime / PaginatedResult / listenOne / onSnapshot | Yes |
| Do not export `buildDocumentMetadata` | Yes |
| Do not named-import DocumentChange from firebase-admin/firestore | Yes — ambient `FirebaseFirestore.*` |
| Do not rewrite earlier ADR amendment blockquotes | Yes — frozen `0017:122` left alone |
| Do not assert readTime monotonicity | Yes |
| Do not delete plan directory | Yes |

## §11 audit

| §11 item | Result | Evidence |
| -------- | ------ | -------- |
| Branch checked out; §3.4 re-verified | PASS | On `feat/issue-39-…`; baseline `32ce4c1`; line numbers matched |
| D1–D8 honored | PASS | ADR-0033 + implementation |
| In-scope complete; out-of-scope untouched | PASS | No CollectionGroup/vector-terminal/tx-read edits |
| SnapshotMetadata.ts as §6.1 | PASS | `src/core/SnapshotMetadata.ts` |
| QueryBuilder §6.2 | PASS | helpers + 6 terminals + `onSnapshotDetailed` |
| FirestoreRepository §6.3 | PASS | helpers + 7 reads + `listenOneDetailed` |
| CollectionGroup.ts not modified | PASS | `git diff` empty |
| index + vector re-exports; no value export of builder | PASS | `src/index.ts`, `src/vector/index.ts` |
| T-1 written; @ts-expect-error used | PASS | `snapshot-metadata.type-test.ts` |
| I-1/I-2/I-3; I-1#13 present | PASS | test files |
| T1–T10 covered at matrix sites | PASS | + I-3#4 hardened for T6 |
| Mutation checks recorded | PASS | this notes.md |
| ADR-0033 + README | PASS | `docs/adr/0033-…`, `docs/adr/README.md` |
| ADR-0017 amendment without editing earlier | PASS | insert before “We explicitly do not…” |
| Living-index sweep → exactly one `#39–#41` | PASS | `0017:122` only |
| 0026/0027/0029 amendments | PASS | `> Amendment` blocks |
| Starlight + capability matrix | PASS | website pages |
| `:::` grep clean | PASS | both gate runs |
| READMEs unaffected | PASS | no `withMetadata` in README/npm-readme |
| Anti-instructions not violated | PASS | checklist above |
| Full gate; integration count up | PASS | 32→34 suites, 480→497 tests |
| notes.md present | PASS | this file |
| Plan dir still present | PASS | not deleted |

## Independent adversarial review

**Reviewer:** fresh Task subagent (composer-2.5) · **Reviewed:** working tree after gate run 1 ·
**Fixes in:** same branch (uncommitted) · **Verdict after fixes:** pass with fixes

Given: plan + source + tests. **Not** given: these notes. Prompted to refute.

### Findings fixed

1. **F1 high — I-3#4 could pass without a `removed` change** — loop now requires
   `expect(removal).toBeDefined()` and asserts last-known `doc.title` + Timestamp metadata (T6).
2. **F3 medium — incomplete T6 asserts on CG removal** — folded into F1 fix.
3. **F4 medium — no type guard for `getByIdOrThrow`** — added `ExpectEqual` row in T-1.
4. **F5 low — `getOne({ withMetadata })` untested** — type-test row + runtime assert in I-1#13.
5. **F6 low — legacy-default checks incomplete** — bare `findByField` / `getOneByField*` asserts
   added.
6. **F7 nit — I-2 imported internal SnapshotMetadata path** — now imports from `../../index.js`.

### Findings not treated as defects

- **F2 high — untracked core files** — Not a defect for this turn: the user instructed **not to
  commit**. Files exist on disk and are ready to stage; §11’s “notes committed” item awaits an
  explicit commit request.

### Findings deferred

None.

### Gate re-run after fixes

Full 14-leg gate re-run: all PASS. Counts unchanged at 31/383 unit, 34/497 integration.

## Could-not-verify

Carried from plan §5:

1. Emulator-only evidence for metadata / `docChanges` semantics (not production Firestore).
2. `check:consumer` local peer is `^14` only; CI still owes `^12` / `^13` / pinned-firestore legs.
3. No benchmark of `buildDocumentMetadata` allocation cost.
4. Write metadata / aggregate `readTime` remain on #72 by design.

## Open questions for the reviewer

None — ready for external `review.md` once committed/PR’d.
