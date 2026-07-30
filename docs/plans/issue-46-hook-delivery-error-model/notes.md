# Issue #46 — Implementation notes (for adversarial review)

**Implementer:** Cursor Grok 4.5 (plan-execution) · **Branch:**
`feat/issue-46-hook-delivery-error-model` · **Plan:**
`docs/plans/issue-46-hook-delivery-error-model/PLAN.md` · **Baseline:** `main` @ `284ef98`
(unchanged after `git fetch` + rebase; §3 line numbers matched live probe output — no drift)

## Status

Done-pending-external-review. D1–D6 implemented (ADR-0035), core source + Express + docs + I1–I7 /
U1–U5 tests. Full §10 gate green (two runs: pre- and post-self-review fixes). Plan directory left in
place. **Not committed** (user instruction).

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

1. **`HookDataFor` type alias removed** — plan §6.3 suggested it; `HookFnMap` already correlates
   event→callback. Unused alias failed eslint `no-unused-vars`. Equivalent map kept.
2. **`WriteOutcomeError` / `ErrorOptions`** — see Ambiguities; ES2020 target constraint.
3. **Bulk `returnDoc` read-backs** wrap each `getByIdOrThrow` in `readAfterCommit` inside
   `Promise.all` (rather than one wrapper around the whole `Promise.all`). Same classification;
   slightly finer-grained failure attribution.
4. **Commit deferred** — user explicitly forbade committing; Conventional Commits subject recorded
   below for the eventual commit.

## Files touched and why

| File | Change | Plan reference |
| ---- | ------ | -------------- |
| `src/core/Hooks.ts` | New: `HookEvent`, `HookContext`, `buildHookContext` | §6.1, §7.3 |
| `src/core/Errors.ts` | `WriteOutcome`, `WriteOutcomeError` | §6.2, §7.4 |
| `src/core/ErrorParser.ts` | Preserve `WriteOutcomeError` | §6.6, §7.5 |
| `src/core/FirestoreRepository.ts` | Context dispatcher, attempt, commit counts, read-back | §6.3–§6.5, §7.6–10 |
| `src/core/QueryBuilder.ts` | Bound `RunHook` / `commitInChunks` signatures | §7.7, T13 |
| `src/index.ts` | Export new symbols | §6.6 |
| `src/express/index.ts` | HTTP 500 + safe `outcome` | §6.6, §7.11 |
| `docs/adr/0035-*.md` + README | ADR D1–D6 | §9.1 |
| `website/src/content/docs/**` | Hooks, txs, errors, express, migration, repo, CRUD, types, scope | §9.2–§9.6 |
| `src/tests/integration/repository-write-outcomes.integration.test.ts` | I1–I7 | §8.1 |
| `src/tests/unit/errors|errorParser|errorHandler|packageExports` | U1–U4 | §8.2 |
| `src/tests/types/hook-write-outcomes.type-test.ts` | U5 | §8.2 |
| Existing hook assertion tests | Second-arg `HookContext` | §8 |

## Edge cases / traps handled

| Trap | Handled by | Pinned by |
| ---- | ---------- | --------- |
| T1 wrap-only outcome-sensitive | `commitInChunks` zero→cause; ordinary precommit classes | I6 + unit |
| T2 control-flow outcome | dispatcher / helpers set phase from site | I1–I7 |
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
| T13 QueryBuilder bound | signature widen only | query I2 |
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
| I4 | integration | contention attempts ≥1 and max≥2 | diagnostic |
| I5 | integration | 501 partial 500/501 | T1/T3/T5 |
| I6 | integration | first-chunk ConflictError | T1 |
| I7 | integration | six returnDoc read-backs | T7 |
| U1–U4 | unit | Errors / parser / Express / exports | contracts |
| U5 | type-test | narrowing + one-arg + exhaust + never-tx-after | T10/T12 |

## Mutation checks

| Test | Mutation | Result |
| ---- | -------- | ------ |
| I1 beforeCreate | `runHooks` catch rethrows raw error | **Fails** — expected WriteOutcomeError objectContaining, received bare Error |
| I5 partial 501 | `commitInChunks` always `throw cause` | **Fails** — expected WriteOutcomeError, received ConflictError |
| U2 parser preserve | early branch returns `new Error(message)` | **Fails** — expected same WriteOutcomeError instance, received plain Error |

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

### Gate re-run after fixes

Run 2 is the post-remediation full gate (recorded above). Fixing F3–F10 did not regress other legs.

| Anti-instruction | Confirmed |
| ---------------- | --------- |
| Do not re-litigate §1 | ✓ |
| No outbox (#80) | ✓ |
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
| attempt owned/null, not dedupe key | PASS | I3 + docs/ADR |
| Coverage gates | PASS | gate logs |
| 14 §10 legs | PASS | gate runs |
| Docs build + links | PASS | check:docs / docs:build |
| notes.md present | PASS | this file |
| Breaking Conventional Commit subject ready | PASS | below (not committed) |

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
  and presence of attempt 1.
- **F11 low — I5 create-only** — Plan allows I5 + shared helper as minimum.
- **F12 low — no ErrorOptions** — ES2020 lib constraint; explicit `cause` field is the public API.

### Findings deferred

- (none)

### Gate re-run after fixes

Recorded in next section when Run 2 completes.

## Could-not-verify

- Contention schedule is emulator/SDK-specific (plan §5).
- Full firebase-admin 12/13/14 peer matrix is CI-owned; local consumer used admin 14.
- Exact production retry schedules remain SDK-owned.

## Open questions for the reviewer

- Whether per-doc `readAfterCommit` inside `Promise.all` for bulk `returnDoc` is preferred over a
  single wrapper (deviation 3).
