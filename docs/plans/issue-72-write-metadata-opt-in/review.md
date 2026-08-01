# Issue #72 — implementation review

**Reviewer:** Codex · **Round:** 1 · **Reviewed:** `bcbca07251902941f8b8e0f6715acc7453b97703`
(`feat(repository): add opt-in write metadata (#72)`) · **Branch:**
`codex/issue-72-write-metadata-plan` · **Plan:** `PLAN.md` @ baseline `07f72c3` · **Tree:**
unchanged by this review, except this new outbound `review.md`. Temporary source mutations were
reverted and their targeted tests re-run green.

**Verdict: APPROVE** — the implementation fulfills the plan and issue acceptance; no remediation is
required before the plan-directory cleanup commit.

---

## What I ran

The reviewer-owned fourteen-leg chain was run under Node 24 with `&&` and output captured in
`/private/tmp/issue72-review-gate.log`. Every leg reached a successful completion; the execution
wrapper did not retain its final `EXIT=` echo, so this report does not claim an unavailable marker.
The `&&` chain's final `docs:build` completed, which is only reachable after all preceding legs
succeed. I also read the log directly for all suite and coverage results rather than trusting
`notes.md`.

| Check | Command | Result |
| --- | --- | --- |
| Full §10 gate | `npm run test:types && npm run lint && npm run check:format && npm run test:unit && npm run test:integration:emulator && npm run test:unit:coverage && npm run test:coverage:gate:unit && npm run test:integration:coverage && npm run test:coverage:gate:integration && npm run build && npm run check:package && npm run check:consumer && npm run check:docs && npm run docs:build` | All 14 legs reached and passed on `bcbca07`; final docs build completed. |
| Suite counts | gate log | Unit `32 suites / 426 tests` (plan baseline `32 / 425`); integration `36 / 540` (baseline `35 / 534`). |
| Unit gate | run-owned `coverage/unit/lcov.info` output | All gates passed; `src/index.ts` lines/branches `100%` and functions `75.76%` (threshold `65%`). |
| Integration gate | run-owned `coverage/integration/lcov.info` output | All gates passed; FirestoreRepository `98.14%` lines / `92.58%` branches / `93.41%` functions; QueryBuilder, CollectionGroup, Validation, and vector gates passed. |
| Consumer / docs | full-gate log | Packed ESM/CJS root/vector and Express consumers passed; `check:docs` scanned 187 docs; site build completed. |
| Mutation T1 | replace `create()` metadata return at `src/core/FirestoreRepository.ts:1521` with id only; run I-1 | Exactly `I-1` failed: expected `Timestamp`, received `undefined`; reverted with `apply_patch`; I-1 passed on revert. |
| Mutation T2 | remove final-chunk receipt append at `src/core/FirestoreRepository.ts:3908`; run I-4 | Exactly `I-4` failed: receipt projection reached `undefined.writeTime`; reverted with `apply_patch`; I-4 passed on revert. |
| Unplanned surface | inspect `src/core/QueryBuilder.ts:38-43, 2202, 2274` plus typecheck/full gate | Its injected `commitInChunks` type now accepts `WriteResult[]`; query update/delete still discard it and preserve their count contract. |
| Tree/revert | `git diff --exit-code -- src/core/FirestoreRepository.ts`; `git status --short` before this file | No remaining mutation diff; only this reviewer artifact is now uncommitted. |

## Blockers

None.

## Major

None.

## Minor / nits

None.

## Verified and holding

- **Direct receipt contract** — all direct methods capture their returned SDK receipt and expose it
  only on `{ withMetadata: true }`: auto-id `create` uses `doc().set()` at
  `src/core/FirestoreRepository.ts:1507-1522`; explicit create does the same receipt projection at
  `src/core/FirestoreRepository.ts:1628-1636`; update/patch share the receipt path at
  `src/core/FirestoreRepository.ts:2432-2484` and `2512-2562`; both `upsert` branches preserve it
  at `src/core/FirestoreRepository.ts:2833-2871`; delete returns only `WriteMetadata` at
  `src/core/FirestoreRepository.ts:2928-2965`. I-1 and the reviewer mutation prove auto-id capture.
- **No default-shape regression** — false/omitted paths remain `{ id }`, document, `void`, or count;
  explicit overloads and runtime branches are present at `src/core/FirestoreRepository.ts:1484-1523`,
  `1679-1756`, `2399-2420`, and `3024-3117`. I-2 checks the observable absence of `writeTime`.
- **Batch ordering and partial accounting** — `commitInChunks` appends only completed chunk receipts
  in action order while keeping `committedWrites` as a count at
  `src/core/FirestoreRepository.ts:3879-3929`. Fixed helpers pair indexed receipts to captured ids
  at `1740-1755`, `1863-1878`, and `2693-2703`; bulk delete uses surviving snapshots at
  `3105-3117`. I-4 and the reviewer mutation pin the 500/501 boundary; I-5 pins missing-delete
  filtering.
- **Mutual exclusion and transaction carve-out** — type overloads restrict the pair and
  `assertExclusiveWriteResultOptions` rejects JavaScript callers at
  `src/core/FirestoreRepository.ts:3932-3947`; I-6 exercises create, patch, update, and upsert.
  Transaction method signatures remain free of the option, with type coverage in
  `src/tests/types/write-metadata.type-test.ts:135-145`.
- **Public surface and durable records** — root exports are present in `src/index.ts:2-15`; type
  import coverage is in `src/tests/types/write-metadata.type-test.ts:35-95`; ADR-0037 and the
  historical ADR-0017 amendment are present at `docs/adr/0037-write-metadata-opt-in.md:1-93` and
  `docs/adr/0017-v3-core-operations-scope.md:152-158`. The current website reference documents the
  option and exclusions at `website/src/content/docs/reference/repository.md:193-314`.
- **Deviations from the plan** — all are correct. The implementation follows D2 rather than the
  internally inconsistent §6.2 intersection by returning bulk-delete `{ count, writeTimes }` without
  a synthetic singular `writeTime`; using `doc().set()` for all auto-id creates is necessary for one
  coherent receipt-capable path; the added schema mock update is the required downstream test repair.

## Not defects

- `bulkWrite` has no new `{ withMetadata }` flag: its already-public success branch includes
  `writeTime` at `src/core/FirestoreRepository.ts:134-141` and its implementation maps the SDK
  receipt at `src/core/FirestoreRepository.ts:3277-3291`. Leaving it unchanged is correct.
- The issue #39 amendment still says write metadata was deferred at
  `docs/adr/0017-v3-core-operations-scope.md:133-139`. It is a historical snapshot; the new issue
  #72 amendment correctly closes the deferred half without rewriting history.
