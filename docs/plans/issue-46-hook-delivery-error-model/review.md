# Issue #46 — implementation review

**Reviewer:** Codex (GPT-5) · **Round:** 1 · **Reviewed:** `HEAD` `ce6b027`
(`chore: cleanup`) plus the uncommitted issue-46 working tree · **Branch:**
`feat/issue-46-hook-delivery-error-model` · **Plan:** `PLAN.md` at baseline `284ef98` · **Tree:**
all reviewer mutations were reverted byte-for-byte; this review adds only `review.md`.

The candidate is intentionally uncommitted per the user's instruction, so there is no implementation
SHA to name. `docs/design/transactional-outbox.md` appeared as an unrelated untracked file during the
review; it was not created or edited by the reviewer, and the final gate includes its current
formatted contents.

---

## What I ran

Every claimed result below comes from this review's run, not `notes.md`.

| Check | Command | Result |
| ----- | ------- | ------ |
| Initial full §10 gate | Exact 14-leg `&&` chain under Node `v24.18.0`, output redirected, chain status captured | `EXIT=1`: `test:types` and `lint` passed; `check:format` reported `docs/design/transactional-outbox.md`, so legs 4–14 were skipped |
| Skipped legs | Each remaining leg run individually; emulator legs rerun with local-port permission | Unit/build/package/consumer/docs legs passed; sandbox-only emulator attempts failed to bind ports (`EPERM`) and were rerun successfully outside the sandbox |
| Final full §10 gate | Exact 14-leg `&&` chain under Node `v24.18.0`, output redirected to `/private/tmp/issue46-review-final-gate.log`, chain status captured | **`EXIT=0`** — all 14 legs passed on the final candidate tree |
| Suite counts | `test:unit`, `test:integration:emulator` | Unit **32 suites / 417 tests** (baseline 32/407); integration **35 suites / 529 tests** (baseline 34/504) |
| Unit coverage gate | Fresh `test:unit:coverage` then `test:coverage:gate:unit` | Utils 98.93 / 94.47 / 100; error-validation 98.42 / 92.92 / 100; index 100 / 100 / 75.76 — all above thresholds |
| Integration coverage gate | Fresh `test:integration:coverage` then `test:coverage:gate:integration` | Repository 97.89 / 91.89 / 93.33; query 96.90 / 88.26 / 100; collection group 99.55 / 97.22 / 100; validation 95.97 / 90.51 / 100; vector 93.26 / 88.03 / 96.55 — all above thresholds |
| Package/consumer/docs | `build`, `check:package`, `check:consumer`, `check:docs`, `docs:build` | Package allowlist passed (98 files); packed ESM/CJS root/vector/Express consumers passed on firebase-admin 14; 185 doc files scanned; 61 production pages built |
| Plan probes | `N-write-outcome-sites.mjs`; both behavioral probes under the emulator | Site enumeration completed; before/after/read-back/partial cases returned `WriteOutcomeError` with expected persistence; retry probe observed 4 callbacks, 4 before hooks, final value 2 |
| Completed sweeps | The three §10 `rg` commands | All hook/commit/read-back/export/doc rows inspected; no shared README callback/outcome contract was introduced |
| Mutation T1/T3/T5 | Make `commitInChunks` rethrow the later-chunk cause | I5 alone failed: expected `WriteOutcomeError`, received `ConflictError` (`1 failed, 24 skipped`); restored I5 passed |
| Mutation T2 | Make `runHooks` rethrow the raw parsed hook error | I1 `beforeCreate` alone failed (`1 failed, 24 skipped`); restored test passed |
| Mutation T6 | Replace parser preservation with `new Error(error.message)` | U2 alone failed: expected the same `WriteOutcomeError`, received plain `Error` (`1 failed, 23 skipped`); restored test passed |
| Mutation T9 | Replace the closure-local attempt with one module-global counter shared by both logical transactions | **I4 incorrectly passed** (`1 passed, 24 skipped`), proving B2 |
| Nested outcome probe | Built package; a `beforeCreate` hook threw a committed/after-hook `WriteOutcomeError` | Observed `{"sameInstance":true,"state":"committed","phase":"after-hook","event":"afterCreate"}`, proving B1 |
| Nested read-back probe | Invoke the built `readAfterCommit` boundary with a not-committed/before-hook `WriteOutcomeError` | Observed `{"sameInstance":true,"state":"not-committed","phase":"before-hook"}`, proving B1's second site |
| Dispatcher type mutation | Change the `beforeUpdate` payload to numeric `42`, then run `test:types` | **`EXIT=0`**, proving N1; restored source hash matched the pre-mutation hash |
| Revert integrity | SHA-256 before/after mutations plus targeted green reruns | `FirestoreRepository.ts` restored to `fdf34f…d939`; `ErrorParser.ts` restored to `de1b0f…8991`; status matched the pre-final-gate snapshot before this review file was added |

## Blockers

### B1 — Nested `WriteOutcomeError` bypasses the current write phase (`src/core/FirestoreRepository.ts:1088`)

`writeOutcomeFromHookFailure` returns an existing `WriteOutcomeError` unchanged at lines 1088–1090,
and `readAfterCommit` does the same at lines 1109–1110. That contradicts the control-flow rule stated
at lines 1080–1082 and plan trap T2: the **outer** outcome must come from the phase that caught the
failure, regardless of the cause's class.

Executed evidence:

- A `beforeCreate` hook throwing a nested committed/after-hook error returned that same instance and
  reported `committed` / `after-hook` / `afterCreate`, even though the outer create never reached its
  write.
- The postcommit read-back boundary returned a nested not-committed/before-hook error unchanged,
  even though the outer write was already committed.

**Failure scenario:** an `afterCreate` hook calls another repository whose hook fails with
`WriteOutcomeError`; the outer create committed, but callers receive the nested repository's
possibly `not-committed` outcome. Conversely, a before hook can throw a nested `committed` outcome
and make a never-written outer create appear committed. Retry and compensation logic then acts on the
wrong document state.

**What closes it:** remove the existing-error early returns from the phase-owning hook/read-back
helpers. Always create the outer phase's `WriteOutcomeError`, using
`parseFirestoreError(error)`—which correctly preserves the nested error—as `cause`. Add focused
integration tests for a hook and a read converter that throw an existing `WriteOutcomeError`, and
assert the outer outcome plus nested cause identity.

### B2 — I4 does not pin attempt scope per logical transaction (`src/tests/integration/repository-write-outcomes.integration.test.ts:437`)

I4 flattens all hook attempts into one array, then asserts only a global minimum of 1 and maximum of
at least 2 (lines 437–478). Its own comment admits per-worker monotonicity is unrecoverable. This
does not implement the plan requirement that each logical callback's observations begin at 1,
increase monotonically, and match that callback's invocation count.

Executed evidence: I replaced the correct closure-local counter at
`src/core/FirestoreRepository.ts:3679–3685` with a module-global counter shared by both concurrent
logical transactions. The targeted I4 test still passed (`1 passed, 24 skipped`), even though one
logical transaction necessarily began above 1.

**Failure scenario:** a refactor moves the counter to repository/module scope. A second logical
`runInTransaction` begins with attempt 2 or higher, so diagnostics no longer mean “callback
invocations for this logical call”; I4 remains green.

**What closes it:** record callback and hook attempts per worker/logical transaction. Assert each
worker sequence begins at 1, is consecutive/monotonically increasing, hook observations exactly
match that worker's callback invocation count, and at least one worker retries. Re-run the shared
counter mutation and confirm I4 alone fails.

## Major

### M1 — “Safe to retry” guidance ignores already-delivered hook side effects (`src/core/Errors.ts:79`)

The public JSDoc example and the published error guide both say a `not-committed` outcome is “safe to
retry the whole create” (`src/core/Errors.ts:79`,
`website/src/content/docs/reference/errors.md:187`). `not-committed` describes the database write,
not rollback of hook effects. Hooks are sequential and fail-fast: earlier hooks may have completed
external effects before a later hook throws, and even the throwing hook may have performed an effect
before rejecting.

**Failure scenario:** the first `beforeCreate` hook sends an email, the second throws, and the
application follows the example by retrying the create. The document was not written, but the first
email is sent twice.

**What closes it:** replace both “safe to retry” comments with guidance that the database write did
not commit, but callers must account for potentially delivered hook side effects and retry only with
an idempotent business/write identity.

## Minor / nits

### N1 — The claimed event-to-payload type correlation stops at registration (`src/core/FirestoreRepository.ts:1063`)

The plan allowed `HookFnMap` instead of `HookDataFor` only if it equivalently typed the dispatcher.
`runHooks` still accepts `data: any` and casts callbacks through `payload: any` (lines 1063 and
1071–1073); QueryBuilder's bound `RunHook` repeats `data: any`
(`src/core/QueryBuilder.ts:44–49`). Only the after-create emitters have typed wrapper methods.

Executed evidence: changing the production `beforeUpdate` dispatch payload from `toUpdate` to numeric
`42` left `npm run test:types` green.

**Failure scenario:** a later edit sends an ids-only object to `beforeBulkDelete`; declaration/type
tests remain green while consumer hooks receive missing `documents` at runtime.

**What closes it:** derive the dispatcher payload from
`Parameters<HookFnMap<T, W, WO>[E]>[0]` (or restore `HookDataFor`) and give QueryBuilder an
event-correlated bound signature. Add a compile-fail type assertion or retain the reviewer mutation
as a negative probe.

### N2 — Keep the concurrent outbox draft out of the issue-46 commit (`docs/design/transactional-outbox.md:1`)

This untracked file appeared during review and is not listed in the implementation notes. Plan
§2.5 explicitly defers the outbox to #80.

**Failure scenario:** a later `git add -A` bundles a separate future design into the breaking
hook-outcome change, expanding review scope and contradicting the plan's anti-instruction.

**What closes it:** do not stage this file with issue #46; handle it in its own #80 branch/change.

## Verified and holding

- The final exact 14-leg gate is green on the reviewed working tree with an explicitly captured
  `EXIT=0`; no skipped leg is being described as passing.
- Suite counts increased from 32/407 to 32/417 unit and from 34/504 to 35/529 integration.
- Fixed-batch accounting increments only after successful `batch.commit()` and reports 500/501 with
  a `ConflictError` cause; the mutation proved I5 pins this.
- First-chunk failure stays top-level `ConflictError`; ordinary validation/not-found/precondition
  contracts remain intact.
- All six postcommit read-back sites use `readAfterCommit`; ordinary converter sentinels are
  classified committed/read-back and persistence is emulator-verified.
- Hook delivery remains sequential/fail-fast; after-hook persistence and query update/delete bulk
  hook propagation are emulator-verified.
- The current transaction implementation itself is correct: the counter is closure-local,
  increments before each SDK callback entry, and a fresh transaction repo receives that value
  (`src/core/FirestoreRepository.ts:3679–3709`). B2 is the missing regression guard, not a claim that
  the current implementation is already globally scoped.
- Direct-on-transaction-clone context, caller-managed `attempt: null`, direct-only after-hook types,
  one-argument callback compatibility, parser preservation, root exports, and Express cause
  redaction all passed their targeted and full-suite checks.
- ADR-0035 records D1–D6 and the public docs cover ordering, fail-fast delivery, retry context,
  partial writes, read-back failures, Express metadata, and outbox deferral, subject to M1.
- Vector and no-hook `bulkWrite` / `recursiveDelete` surfaces were not changed. The README grep
  remains non-contractual, so `readme-sync` is not required.

## Deviations from the plan

1. **Removing `HookDataFor`: wrong as implemented.** `HookFnMap` types registration but not
   dispatch payloads; N1 records the gap.
2. **Explicit `cause` assignment under the ES2020 lib:** correct. It preserves identity without
   requiring unavailable `ErrorOptions` types.
3. **Per-document `readAfterCommit` inside bulk `Promise.all`: acceptable for ordinary failures**
   and gives precise site attribution, but the existing-error bypass inside the helper is wrong
   (B1).
4. **Deferring the commit:** correct under the user's explicit no-commit instruction; the review is
   necessarily against a captured working tree rather than a SHA.

## Not defects

- `parseFirestoreError` preserving an existing `WriteOutcomeError` is correct at generic
  repository/query catch boundaries. B1 concerns **phase-owning** helper boundaries, which must wrap
  that preserved error as the cause of a new outer outcome.
- The contention test must not require the emulator's exact `[2, 2]` schedule. B2 asks for per-worker
  invariants, not an exact global retry schedule.
- `HookContext<'afterCreate'>` being proven direct-only through `Extract<…, { execution:
  'transaction' }>` is a valid alternative to a brittle object-literal `@ts-expect-error`.

## Verdict

**BLOCKED** — close B1 by reclassifying nested errors at the outer hook/read-back phase and adding
regressions; close B2 by strengthening I4 and proving the shared-counter mutation fails. Also correct
M1, type the dispatcher for N1, and keep N2 out of the issue commit. Then disposition every id in
`notes.md` and rerun the complete §10 gate before round 2.

---

## Round 2

**Reviewed:** `HEAD` `8810566` (`docs(agents): ban git checkout restores during mutation checks`)
plus the uncommitted remediation working tree · **Dispositions checked against `notes.md`:** B1,
B2, M1, N1, N2 · **Tree:** remediation unchanged by this review; all temporary mutations restored
byte-for-byte; this section is the reviewer's only persistent edit.

### Disposition verification

| Finding | Implementer disposition | Reviewer check |
| ------- | ----------------------- | -------------- |
| **B1** | fixed — phase-owning hook/read-back helpers always construct a new outer `WriteOutcomeError`; three nested-error integration tests added | **Confirmed.** `src/core/FirestoreRepository.ts:1103–1134` now derives the outer outcome from the current control-flow phase and preserves the nested error as `cause`. All three tests at `src/tests/integration/repository-write-outcomes.integration.test.ts:649–778` passed. Reintroducing the hook early return made the beforeCreate regression alone fail (`1 failed, 27 skipped`); reintroducing the read-back early return made the read-back regression alone fail (`1 failed, 27 skipped`). |
| **B2** | fixed — I4 records attempts per logical worker and asserts start-at-1, consecutiveness, and callback/hook count equality | **Confirmed.** `src/tests/integration/repository-write-outcomes.integration.test.ts:441–503` uses `AsyncLocalStorage` to attribute concurrent hook observations without a shared-current-worker race. Replacing the closure-local counter at `src/core/FirestoreRepository.ts:3720–3726` with a module-global counter made I4 alone fail (`Expected: 2, Received: 4`; `1 failed, 27 skipped`). |
| **M1** | fixed — retry guidance now distinguishes database non-commit from already-delivered hook effects | **Confirmed.** `src/core/Errors.ts:79–80` and `website/src/content/docs/reference/errors.md:187–189` now require an idempotent business/write identity and explicitly warn that earlier hook side effects may already have been delivered. No “safe to retry the whole create” occurrence remains. |
| **N1** | fixed — event-correlated `HookDataFor` now types repository and QueryBuilder dispatcher payloads | **Confirmed.** `HookDataFor` is derived from `HookFnMap` at `src/core/FirestoreRepository.ts:326–337`, used by `runHooks` at `1075–1091`, and propagated through QueryBuilder's bound `RunHook` at `src/core/QueryBuilder.ts:44–55`. Mutating repository `beforeUpdate` to pass `42` made `test:types` fail with TS2345; mutating QueryBuilder `beforeBulkUpdate` likewise failed with TS2345. The restored tree passes `test:types`. |
| **N2** | fixed — remove the out-of-scope outbox draft | **Confirmed.** `docs/design/transactional-outbox.md` is deleted in the remediation diff and is absent from the working tree. The deletion correctly removes the file that was accidentally included in `72def39`; no other outbox implementation surface was added. |

### Fresh verification

| Check | Result |
| ----- | ------ |
| Targeted remediation tests | B1's three nested-outcome tests plus strengthened I4: **4 passed, 24 skipped** |
| Mutation restores | `FirestoreRepository.ts` restored to SHA-256 `accd75…de5d8`; `QueryBuilder.ts` restored to `df1b50…7a760`; targeted tests and `test:types` green after restoration |
| Full §10 gate | Exact 14-leg `&&` chain under Node `v24.18.0`, output redirected to `/private/tmp/issue46-review-r2-full-gate.log`, explicit chain status **`EXIT=0`** |
| Suite counts | Unit **32 suites / 417 tests** (baseline 32/407); integration **35 suites / 532 tests** (baseline 34/504) |
| Unit coverage gate | Utils 98.93 / 94.47 / 100; error-validation 98.42 / 92.92 / 100; index 100 / 100 / 75.76 — all above thresholds |
| Integration coverage gate | Repository 98.00 / 92.28 / 93.33; query 96.91 / 88.26 / 100; collection group 99.55 / 97.22 / 100; validation 95.97 / 90.51 / 100; vector 93.26 / 88.03 / 96.55 — all above thresholds |
| Package/consumer/docs | Build passed; package allowlist passed (98 files); packed ESM/CJS root/vector/Express consumer passed on firebase-admin 14; 185 doc files scanned; 61 production pages built |
| Tree integrity | `git status --porcelain=v1 -uall` matched the pre-gate snapshot before this round was appended; `git diff --check` passed |

No new findings were introduced by the remediation delta. The current source behavior, focused
regressions, adversarial mutations, type-boundary mutations, full test suites, coverage gates,
package consumers, and published documentation agree on the issue-46 contract.

## Verdict

**APPROVE** — B1, B2, M1, N1, and N2 are independently verified closed; the fresh exact gate is
green with `EXIT=0`. The implementation owner can commit the remediation, then proceed with the
plan-directory cleanup lifecycle.
