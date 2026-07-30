# Issue #46 — Implementation notes (for adversarial review)

**Implementer:** Cursor Grok 4.5 (plan-execution) · **Branch:**
`feat/issue-46-hook-delivery-error-model` · **Plan:**
`docs/plans/issue-46-hook-delivery-error-model/PLAN.md` · **Baseline:** `main` @ `284ef98`
(unchanged after `git fetch` + rebase; §3 line numbers matched live probe output — no drift)

## Status

Implementation committed (`72def39`). External review round 1 (`review.md`) findings **B1, B2, M1,
N1, N2** addressed in the working tree (not yet committed — user instruction). Full §10 gate
re-run after remediation recorded below.

## Ambiguities resolved

- ADR number: claimed **0035** (highest existing was 0034).
- Living `(#N–#41)` footers: grepped live tree. Issue #46 is **not** an ADR-0017 deferred item
  (#31–#41); no living-index footer rewrite required. Remaining living footers still list `#41`.
- `WriteOutcomeError` constructor: ES2020 lib has no `ErrorOptions` / typed `Error.cause`, so cause
  is assigned explicitly (`this.cause = cause`) rather than `super(msg, { cause })`.
- U5 after+transaction `@ts-expect-error`: object-literal assignment emits property errors that
  TypeScript does not attribute to a single call-site `@ts-expect-error`. Pinned instead via
  `Extract<HookContext<'afterCreate'>, { execution: 'transaction' }> extends never`.

## Deviations from the plan

1. **`HookDataFor` restored (review N1)** — initial implementation dropped the alias because eslint
   flagged it unused when only `HookFnMap` typed registration. External review proved dispatch still
   accepted `data: any`. Restored as `export type HookDataFor<E,T,W,WO> =
   Parameters<HookFnMap…>[E]>[0]` on the dispatcher + QueryBuilder `RunHook`.
2. **`WriteOutcomeError` / `ErrorOptions`** — see Ambiguities; ES2020 target constraint.
3. **Bulk `returnDoc` read-backs** wrap each `getByIdOrThrow` in `readAfterCommit` inside
   `Promise.all` (rather than one wrapper around the whole `Promise.all`). Same classification;
   slightly finer-grained failure attribution. Nested-error early-return inside the helper was wrong
   (B1) and is removed.
4. **Commit of remediation deferred** — user forbade committing this remediation pass.

## Files touched and why

| File | Change | Plan reference |
| ---- | ------ | -------------- |
| `src/core/Hooks.ts` | New: `HookEvent`, `HookContext`, `buildHookContext` | §6.1, §7.3 |
| `src/core/Errors.ts` | `WriteOutcome`, `WriteOutcomeError`; M1 retry guidance | §6.2, §7.4 |
| `src/core/ErrorParser.ts` | Preserve `WriteOutcomeError` | §6.6, §7.5 |
| `src/core/FirestoreRepository.ts` | Context dispatcher, attempt, commit counts, read-back; B1 wrap; N1 HookDataFor | §6.3–§6.5 |
| `src/core/QueryBuilder.ts` | Bound event-correlated `RunHook` | §7.7, T13, N1 |
| `src/index.ts` | Export new symbols | §6.6 |
| `src/express/index.ts` | HTTP 500 + safe `outcome` | §6.6, §7.11 |
| `docs/adr/0035-*.md` + README | ADR D1–D6 | §9.1 |
| `website/src/content/docs/**` | Hooks, txs, errors, express, migration, repo, CRUD, types, scope | §9.2–§9.6 |
| `src/tests/integration/repository-write-outcomes.integration.test.ts` | I1–I7 + B1 + strengthened I4 | §8.1 |
| `src/tests/unit/errors|errorParser|errorHandler|packageExports` | U1–U4 | §8.2 |
| `src/tests/types/hook-write-outcomes.type-test.ts` | U5 + N1 compile-fail | §8.2 |
| Existing hook assertion tests | Second-arg `HookContext` | §8 |
| `docs/design/transactional-outbox.md` | **Removed** from tree (N2 / #80) | §2.5, §7 |

## Edge cases / traps handled

| Trap | Handled by | Pinned by |
| ---- | ---------- | --------- |
| T1 wrap-only outcome-sensitive | `commitInChunks` zero→cause; ordinary precommit classes | I6 + unit |
| T2 control-flow outcome | dispatcher / helpers always allocate outer phase (B1) | I1–I7 + B1 nested |
| T3 increment after commit | `committedWrites +=` only post-`await commit` | I5 mutation B |
| T4 action-building after success | try/catch around chunk loop | commitInChunks structure |
| T5 exact totals | `totalWrites: actions.length` | I5 |
| T6 parser preserve | early `instanceof WriteOutcomeError` | U2 mutation C |
| T7 six read-backs | `readAfterCommit` at all six sites | I7 |
| T8 no blanket tx on clone | default direct; only `*InTransaction` passes tx | I3 T8 test |
| T9 attempt 1-based / null | `observedAttempt++`; `?? null` | I3 / I4 |
| T10 after direct-only | types + runtime `startsWith('before')` guard | U5 + Hooks.ts |
| T11 split delete aliases | before/after delete overloads | types + I1/I2 |
| T12 one-arg hooks | TS fewer-params | U5 |
| T13 QueryBuilder bound | event-correlated HookDataFor | N1 type-test |
| T14 no HTTP cause | Express body `{ error, outcome }` | U3 |
| T15 fail-fast sequential | for-await loop | I2 laterCalls=0 |
| T16 no durable promise | docs + ADR | lifecycle-hooks.md |
| T17 no-hook paths | untouched | bulkWrite docs |
| T18 no #79 fix | contradictory prose left | lifecycle-hooks.md |

## Tests added

| Id | Suite | Asserts | Guards |
| -- | ----- | ------- | ------ |
| I1 | integration write-outcomes | all 6 before families full outcome | not-committed |
| I2 | integration | afterCreate/Update/Delete/BulkCreate + query bulk | committed/fail-fast |
| I3 | integration | tx attempt 1, null raw, direct-on-clone, tx failure hook | T8/T9 |
| I4 | integration | **per-worker** attempts begin at 1, consecutive, match callbacks | B2 |
| I5 | integration | 501 partial 500/501 | T1/T3/T5 |
| I6 | integration | first-chunk ConflictError | T1 |
| I7 | integration | six returnDoc read-backs | T7 |
| B1 | integration | nested WOE reclassified at before/after/read-back | T2 |
| U1–U4 | unit | Errors / parser / Express / exports | contracts |
| U5 | type-test | narrowing + one-arg + exhaust + never-tx-after + N1 | T10/T12/N1 |

## Mutation checks

| Test | Mutation | Result |
| ---- | -------- | ------ |
| I1 beforeCreate | `runHooks` catch rethrows raw error | **Fails** — expected WriteOutcomeError objectContaining, received bare Error |
| I5 partial 501 | `commitInChunks` always `throw cause` | **Fails** — expected WriteOutcomeError, received ConflictError |
| U2 parser preserve | early branch returns `new Error(message)` | **Fails** — expected same WriteOutcomeError instance, received plain Error |
| I4 per-worker (B2) | module-global shared `__ormObservedAttempt` | **Fails** — `Expected: 2, Received: 3` on consecutive attempt assert; restored via backup; I4 green again |

Restored via file backups (not `git checkout`) after each check.

## Gate results

**Run 1** (pre-self-review fixes): types/lint/format/unit/integration/coverage gates/build/package/consumer/docs/docs:build all passed after prettier fix.

- unit: **32 suites / 417 tests** (was 32/407)
- integration: **35 suites / 526 tests** (was 34/504)
- unit coverage gates: passed (error-validation 98.42 / 92.92 / 100)
- integration coverage: repository 97.89 / 91.85 / 93.33; others above thresholds
- `check:package` / `check:consumer` (admin 14) used temp `npm_config_cache`
- built HTML: **0** literal `:::` leaks
- README grep: no new callback/outcome contract (readme-sync not required)

**Run 2** (after F3–F6/F9/F10 fixes): all 14 §10 legs passed again.

- unit: **32 suites / 417 tests**
- integration: **35 suites / 529 tests** (+3 from expanded I1/I2)
- both coverage gates passed; build/package/consumer (admin 14)/check:docs/docs:build passed
- built HTML `:::` count: **0**

**Run 3** (after external review B1/B2/M1/N1/N2 remediation): all 14 §10 legs passed under Node `v24.18.0`
(temp `npm_config_cache`).

- unit: **32 suites / 417 tests**
- integration: **35 suites / 532 tests** (+3 B1 nested-outcome tests vs Run 2’s 529)
- unit coverage gates: utils 98.93 / 94.47 / 100; error-validation 98.42 / 92.92 / 100; index 100 / 100 / 75.76
- integration coverage: repository 98.00 / 92.28 / 93.33; query 96.91 / 88.26 / 100; others above thresholds
- build / package (98 files) / consumer (admin 14) / check:docs / docs:build passed
- built HTML literal `:::` files: **0**

### Gate re-run after fixes

Run 2 is the post-self-review full gate. Run 3 is the post-external-review remediation gate (green).

| Anti-instruction | Confirmed |
| ---------------- | --------- |
| Do not re-litigate §1 | ✓ |
| No outbox (#80) | ✓ — N2 deleted `docs/design/transactional-outbox.md` from tree |
| No #79 prose fix | ✓ |
| No CHANGELOG hand-edit | ✓ |
| No frozen 2.0 docs | ✓ |
| No README contract expansion | ✓ |
| No bulkWrite/recursiveDelete change | ✓ |
| Do not commit unless asked | ✓ |
| Leave plan directory | ✓ |

## §11 audit

| §11 / DoD item | Result | Evidence |
| -------------- | ------ | -------- |
| D1–D6 in ADR | PASS | `docs/adr/0035-hook-delivery-and-write-outcome-errors.md` |
| Every §2 call site inspected | PASS | probes + `rg runHooks/commitInChunks/readAfterCommit` |
| §4 traps tested/dispositioned | PASS | trap table above |
| I1–I7 / U1–U5 | PASS | write-outcomes suite + unit/type tests |
| Persistence backs outcomes | PASS | emulator assertions |
| Ordinary precommit classes | PASS | I6 |
| attempt owned/null, not dedupe key | PASS | I3 + docs/ADR + strengthened I4 |
| Coverage gates | PASS | gate logs |
| 14 §10 legs | PASS | gate runs |
| Docs build + links | PASS | check:docs / docs:build |
| notes.md present | PASS | this file |
| Breaking Conventional Commit subject ready | PASS | shipped as `72def39`; remediation uncommitted |

## Independent adversarial review

**Reviewer:** fresh subagent (composer-2.5) · **Reviewed:** uncommitted tree + PLAN + tests (not
notes) · **Verdict:** pass with fixes

### Findings fixed

1. **F3 medium — I2 missing after families** — added afterUpdate, afterDelete, afterBulkCreate tests.
2. **F4 medium — I1 shallow assertions** — full outcome/cause/hook for all six before families.
3. **F5 medium — repository.md outcome notes** — createWithId/bulkCreateWithIds/update/bulkUpdate/bulkPatch/upsert notes.
4. **F6 low — Express JSON example** — added safe body example.
5. **F9 low — tx failure omitted hook** — assert `outcome.hook` transaction/attempt 1.
6. **F10 low — no runtime T10 guard** — `buildHookContext` rejects transaction on non-before events.

### Findings not treated as defects

- **F1 critical — uncommitted / no gate** — Commit explicitly forbidden by user. Gate evidence exists
  in this session (runs 1–2).
- **F2 high — no baseline-failure audit** — Mutation checks recorded above (A/B/C).
- **F7 low — missing after+transaction `@ts-expect-error`** — TS emits property errors that do not
  pair cleanly with `@ts-expect-error`; `Extract<…> extends never` pins the contract.
- **F8 low — I4 weaker monotonicity** — Plan forbids asserting exact `[2,2]`; strengthened min/max
  and presence of attempt 1. **Superseded by external B2** (per-worker sequences).
- **F11 low — I5 create-only** — Plan allows I5 + shared helper as minimum.
- **F12 low — no ErrorOptions** — ES2020 lib constraint; explicit `cause` field is the public API.

### Findings deferred

- (none)

## External review round 1 (`review.md`) — dispositions

**Reviewer:** Codex (GPT-5) · **Reviewed:** `HEAD` `ce6b027` + then-uncommitted tree · **Verdict was
BLOCKED**. Remediation applied against committed `72def39` working tree.

| Id | Severity | Disposition | Evidence |
| -- | -------- | ----------- | -------- |
| **B1** | blocker | **fixed** | Removed early returns in `writeOutcomeFromHookFailure` / `readAfterCommit`; always allocate outer phase with `parseFirestoreError(error)` as cause. Added 3 integration tests under `B1 — nested WriteOutcomeError reclassification`. |
| **B2** | blocker | **fixed** | I4 now records attempts per worker via `AsyncLocalStorage`; asserts each sequence starts at 1, is consecutive, matches callback count, and at least one worker retries. Shared-counter mutation fails I4 (`Expected: 2, Received: 3`); restored via backup. |
| **M1** | major | **fixed** | Replaced “safe to retry” in `Errors.ts` JSDoc and `website/.../errors.md` with guidance that DB write did not commit but earlier hook side effects may have delivered — retry only with idempotent business/write identity. |
| **N1** | minor | **fixed** | Restored `HookDataFor` from `Parameters<HookFnMap…>[0]`; typed `runHooks` + QueryBuilder `RunHook`. Type-test `@ts-expect-error` for `beforeUpdate`/`42` and incomplete `beforeBulkDelete`. |
| **N2** | nit | **fixed** | Deleted `docs/design/transactional-outbox.md` from the working tree (was incorrectly included in `72def39`). Belongs with #80. Next commit should record the deletion. |

### Verified and holding (from review — not re-litigated)

Parser preserve at generic catch boundaries remains correct; B1 is phase-owning helpers only.
Contention must not require exact `[2,2]`. After+transaction `Extract` pin remains valid.

## Could-not-verify

- Contention schedule is emulator/SDK-specific (plan §5).
- Full firebase-admin 12/13/14 peer matrix is CI-owned; local consumer used admin 14.
- Exact production retry schedules remain SDK-owned.

## Open questions for the reviewer

- (none remaining from implementer) Whether per-doc `readAfterCommit` inside `Promise.all` for bulk
  `returnDoc` is preferred was accepted by review for ordinary failures; nested bypass fixed under B1.
