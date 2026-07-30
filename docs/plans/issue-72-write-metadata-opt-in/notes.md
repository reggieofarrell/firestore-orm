# Implementation notes — issue #72

The implementer owns this file. Record deviations from `PLAN.md`, mutation-check results, commands
actually run, and dispositions from the independent refute-first self-review. Commit it with the
implementation before external review.

## Status

- Branch: `codex/issue-72-write-metadata-plan` (already checked out)
- Baseline: `main` @ `07f72c3` — **unchanged** since plan; no rebase required
- Next free ADR: `0037` (highest present: `0036-query-explain-stream.md`)
- Implementation started: 2026-07-30
- Ready for external review: yes (after adversarial remediations + gate run 2)

## Ambiguities resolved (§1 / §2)

- §1 D1–D4 treated as settled; not re-litigated.
- Scope correction noted: `commitInChunks` + QueryBuilder callback type are in scope; `bulkWrite` /
  query writes / transactions / `recursiveDelete` remain out.

## Deviations from the plan

1. **bulkDelete metadata shape (D2 over §6.2 wording):** §6.2 wrote
   `WriteResultWithMetadata<{ count; writeTimes }>`, which would also require a singular
   `writeTime` via the `R & WriteMetadata` intersection. Owner decision **D2** specifies
   `{ count, writeTimes }` only. Implemented D2's shape (no singular `writeTime` on bulk delete).
2. **Auto-id `create` always uses `doc().set()`** (not only when `withMetadata: true`): keeps one
   write path and always yields a `WriteResult`; id generation remains client-side. Matches §7
   step 3 ("change auto-id create to doc().set") rather than dual-pathing `add()` for the default.
3. **Unit suite count:** plan predicted type + integration counts rise. Integration: 35→36 suites,
   534→540 tests. Unit: 32 suites unchanged; tests 425→426 (packageExports type-only assertion).
   Type coverage is `test:types` (tsc), not a Jest suite count.
4. **schemaContracts unit update** (not in §3 list): existing mock expected `collection.add()`;
   updated to `doc().set()` to match T1. Required for green unit gate after create-path change.

## Files touched and why

- `src/core/FirestoreRepository.ts` — WriteMetadata types, UpdateOptions.withMetadata, direct + fixed
  batch overloads, commitInChunks → WriteResult[], exclusive-options guard (incl. patch)
- `src/core/QueryBuilder.ts` — FirestoreWriteBatch private alias return type (T5)
- `src/index.ts` — re-export WriteMetadata / WriteResultWithMetadata
- `src/tests/types/write-metadata.type-test.ts` — T-1…T-4
- `src/tests/integration/repository-write-metadata.integration.test.ts` — I-1…I-6
- `src/tests/unit/schemaContracts.unit.test.ts` — create path mock (add → doc/set)
- `src/tests/unit/packageExports.unit.test.ts` — type-only export absence assertion (§9.2)
- `docs/adr/0037-write-metadata-opt-in.md` + `docs/adr/README.md` + ADR-0017 amendment + living indexes
- `website/src/content/docs/reference/{repository,types,scope-and-capabilities}.md`

## Edge cases / traps handled

- **T1:** auto-id create → `doc().set()` so writeTime is available
- **T2:** commitInChunks concatenates only successful chunk results; WriteOutcomeError still counts
- **T3:** bulkDelete pairs receipts to surviving snapshots / capturedIds
- **T4:** assertExclusiveWriteResultOptions before I/O on create/update/upsert/**patch**/bulkCreate*;
  overload cells reject the pair; I-6 covers create/patch/update/upsert
- **T5:** QueryBuilder callback retyped to Promise<WriteResult[]>

## Tests added · Mutation checks

### Tests added
- `src/tests/types/write-metadata.type-test.ts` — T-1…T-4
- `src/tests/integration/repository-write-metadata.integration.test.ts` — I-1…I-6 (6 tests)
- `src/tests/unit/packageExports.unit.test.ts` — +1 type-only export assertion

### Mutation checks (restore via file backup, never `git restore`)

| Test | Mutation | Observed failure |
| --- | --- | --- |
| I-1 | M1: `create` withMetadata returned `{ id }` without `writeTime` | `expect(created.writeTime).toBeInstanceOf(Timestamp)` — received `undefined` |
| I-6 | M2: `assertExclusiveWriteResultOptions` no-op | `expect(…).rejects.toThrow()` — promise resolved to read-back doc |
| I-5 | M3: bulkDelete metadata used `ids.length` + invented times | `expect(result.count).toBe(2)` — received `3` |
| I-4 | M4: bulkCreate withMetadata truncated to 500 receipts | `expect(receipts).toHaveLength(501)` — received `500` |
| I-6 (patch) | M5: removed exclusivity assert from `patch` only | I-6 failed — patch proceeded into `update`/`NotFoundError` instead of mutual-exclusion Error |

## Gate results

### Run 1 (pre–adversarial review) — 2026-07-30

| Leg | Result |
| --- | --- |
| probe `sdk-write-results.ts` | `{"directIsTimestamp":true,"batchLength":1,"batchIsTimestamp":true}` |
| README grep | only `npm-readme.md:121` (generic returnDoc example) — READMEs left unchanged |
| `test:types` | pass |
| `lint` | pass |
| `check:format` | pass (after prettier --write on touched files) |
| `test:unit` | **32 suites / 425 tests** (then + schemaContracts fix) |
| `test:integration:emulator` | **36 suites / 540 tests** (was 35 / 534; +1 suite / +6 tests) |
| unit coverage + gate | pass |
| integration coverage + gate | pass |
| `build` / `check:package` / `check:consumer` / `check:docs` / `docs:build` | pass |
| built HTML `:::` grep | no matches |

### Run 2 (post–adversarial review) — 2026-07-30

Full fourteen-leg §10 command under Node 24: **all pass**.

| Leg | Result |
| --- | --- |
| `test:types` / `lint` / `check:format` | pass |
| `test:unit` | **32 suites / 426 tests** (+1 packageExports assertion) |
| `test:integration:emulator` | **36 suites / 540 tests** |
| unit + integration coverage gates | pass (FirestoreRepository lines 98.14%, branches 92.58%, functions 93.41%) |
| `build` / `check:package` / `check:consumer` / `check:docs` / `docs:build` | pass |
| built HTML `:::` grep (`rg -l -F ':::' website/dist -g '*.html'`) | no matches (exit 1) |

## Could-not-verify

- Carried from plan §5: CI peer matrix unverified until PR checks; no full prototype was made at
  plan time (implementer proceeded with static enumeration).

## Anti-instructions checklist

- [x] Do not use `add()` for metadata-enabled create — auto-id create always uses `doc().set()`; no
      `writeCol().add` remains in repository
- [x] Do not change default return shapes / hooks / validation ordering / WriteOutcomeError counts
- [x] Do not add write metadata to transactions, bulkWrite, query writes, or recursiveDelete
- [x] Do not use DocumentMetadata/WithMetadata for commit receipts — distinct WriteMetadata types
- [x] Do not edit frozen 2.0 docs or historic ADR-0017 #39 amendment text — new #72 amendment only
- [x] Do not commit unless asked — reported subject instead

## Independent adversarial review

Reviewer: fresh Task subagent (`a5c999b9-9802-4263-9a20-23cd77d46054`), refute-first; handed diff +
plan + tests (not notes.md). Verdict was **REQUEST CHANGES**.

| Id | Severity | Disposition |
| --- | --- | --- |
| **F1** | blocker | **fixed** — `patch()` now calls `assertExclusiveWriteResultOptions` before forwarding |
| **F2** | major | **fixed** — I-6 now probes create/patch/update/upsert JS exclusivity; M5 mutation confirms |
| **F3** | major | **fixed** — JSDoc updated on update/patch/upsert/bulkPatch (+ newId stale add() prose) |
| **F4** | major | **fixed** — ADR-0031 and ADR-0032 living footers now include #72 / ADR-0037 |
| **F5** | major | **fixed** (coverage) / **not a defect** (baseline mutation) — I-2 expanded to all direct
  defaults + bulkCreate; it intentionally pins non-leakage of `writeTime` on legacy shapes (would
  pass on unfixed baseline by design). Load-bearing mutation coverage is I-1/I-4/I-5/I-6. |
| **F6** | minor | **fixed** — `newId()` JSDoc now says `doc().set()` |
| **F7** | minor | **fixed** — packageExports asserts type aliases are not runtime values; T-4 remains
  compile-time root-import guard |
| **F8** | nit | **not a defect** — harness may retain unused `add` mock; create contract asserts
  `doc`+`set`; leaving `add` does not weaken the assertion |

## §11 Definition of done audit

| # | Item | Status | Proving file |
| --- | --- | --- | --- |
| 1 | D1–D4 implemented exactly | PASS | `src/core/FirestoreRepository.ts` (types + overloads; no `*InTransaction` withMetadata) |
| 2 | §3 sites re-enumerated; non-sites justified | PASS | notes Status + Probe; transactions/bulkWrite/query writes untouched |
| 3 | Direct/batch receipts are SDK writeTimes; 500-chunk + partial accounting | PASS | `commitInChunks`; I-1/I-3/I-4 |
| 4 | Every §4 trap has §8 test; mutation-fails | PASS | Mutation table M1–M5 |
| 5 | Root exports, JSDoc, website, ADR, 0017 amendment, living indexes | PASS | `src/index.ts`, ADR-0037, website reference pages, living footers |
| 6 | README grep + docs HTML `:::` check recorded | PASS | Gate results (npm-readme:121 only; no `:::`) |
| 7 | §10 gate + probe; notes include self-review | PASS | Gate run 1 + run 2; this section |
| 8 | §7 anti-instructions not violated | PASS | Anti-instructions checklist |
| 9 | Plan dir cleanup after external review | PENDING | Leave `docs/plans/issue-72-write-metadata-opt-in/` in place |
