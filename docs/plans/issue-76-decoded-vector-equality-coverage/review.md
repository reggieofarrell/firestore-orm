# Issue #76 — implementation review

**Reviewer:** Codex (GPT-5.6) · **Round:** 1 · **Reviewed:** `3da77f2`
(`docs(plan): record issue 76 gate and review notes`) · **Implementation:** `e80434d`
(`test(query-builder): pin decoded vector equality (#76)`) · **Branch:**
`cursor/issue-76-decoded-vector-equality-c567` · **Plan:** `PLAN.md` @ baseline `8c5ed6d` ·
**Tree:** implementation unchanged by this review; all temporary mutations were reverted and
`review.md` is the only reviewer-created working-tree file

**Verdict: APPROVE** — the committed implementation matches the plan, the independent fourteen-leg
gate is green, and the decoded-vector regression is precisely mutation-pinned.

---

## What I ran

Every result below was produced during this review rather than accepted from `notes.md`.

| Check | Command | Result |
| ----- | ------- | ------ |
| Baseline / diff enumeration | `git log`, `git merge-base HEAD main`, `git diff --name-status 8c5ed6d..HEAD`, `git show e80434d -- <test paths>` | Baseline is `8c5ed6d`; implementation commit changes only the two prescribed test files plus `notes.md`. No production source changed. |
| Full §10 gate | Exact fourteen-leg `&&` chain to `/tmp/issue76-review-gate.log`, with captured chain status | `EXIT=0`; no short-circuit, so every leg ran. |
| Suite counts | Full gate's own Jest output | Unit `32 suites / 426 tests` (baseline `32 / 426`, unchanged as planned); integration `36 / 545` (baseline `36 / 544`, +1 test as planned). |
| Unit coverage gates | Full gate's own output | Utilities `98.93 / 94.47 / 100`; errors/validation `98.42 / 92.92 / 100`; package exports `100 / 100 / 75.76` (lines / branches / functions). All exceed thresholds. |
| Integration coverage gates | Full gate's own output | Repository `98.11 / 92.42 / 93.48`; QueryBuilder `96.38 / 86.44 / 100`; CollectionGroup `99.55 / 97.22 / 100`; validation `95.97 / 90.51 / 100`; vector `93.26 / 88.03 / 96.55`. All exceed thresholds. |
| T9 mutation | Changed `src/utils/firestoreValueEquality.ts:140` to `false && isGenuineVectorValue(obj)`; ran the complete vector integration file | Precisely targeted: I-1 alone failed with expected length 2 / received length 3; the other 34 tests passed. |
| Mutation revert | Restored line 140 with `apply_patch`; checked source diff; reran the complete vector integration file | Source diff empty; `1 suite / 35 tests` passed. The first combined shell retry was blocked before Jest by sandbox port probing (`listen EPERM`); the direct authorized rerun passed and is the test result reported here. |
| Unplanned surface: the other fixed-vector-harness consumer | Ran `vector-search.integration.test.ts` and `query-explain.integration.test.ts` together against one emulator | `2 suites / 41 tests` passed. This probes the shared `test_vectors` cleanup/parallelism surface at `query-explain.integration.test.ts:137-162`, which the plan did not enumerate as a source site. |
| Independent refute-first diff audit | Separate explorer inspected plan, notes, implementation diff, QueryBuilder read path, harness consumers; it independently ran `test:types` and the targeted emulator file | No actionable findings; targeted file `1 / 35`, typecheck clean, and `git diff --check` clean. |
| Revert / tree verification | `git diff --check`; `git diff -- src/core src/utils src/vector <two test paths>` before writing this report | No output. Mutations and probes left no implementation change. |

The full gate also independently passed lint, format, build, the 98-file package check, packed ESM/CJS
consumer checks on `firebase-admin@^14`, documentation links (188 files), and the 61-page docs build.

## Blockers

None.

## Major

None.

## Minor / nits

None.

## Verified and holding

- **The test crosses the intended SDK boundary.** I-1 writes three genuine vectors through the
  repository at `src/tests/integration/vector-search.integration.test.ts:73-79`, then executes a
  fresh terminal query at lines 81-85. `distinctValues()` obtains a snapshot and reads
  `doc.data()[field]` at `src/core/QueryBuilder.ts:1392-1396`, so the assertion receives decoded
  values rather than the write-side objects.
- **Equal and unequal behavior are both observable.** The two `[1,2,3]` inputs and distinct
  `[1,2,4]` input are asserted as cardinality two plus exact public `toArray()` components at
  `src/tests/integration/vector-search.integration.test.ts:75-91`. The T9 mutation returned all
  three objects and failed only this test, proving the under-merge regression is pinned without
  relying on another assertion.
- **The assertion is behavior-focused.** I-1 contains no constructor, `instanceof`, `_values`, or
  transitive SDK assertion; it observes the public terminal result and `VectorValueLike.toArray()`
  at lines 81-91.
- **The fixed collection is scoped deterministically.** The three-name `in` filter and `name`
  ordering at `src/tests/integration/vector-search.integration.test.ts:81-85` prevent unrelated
  vector rows from entering the distinct set and define first-seen order.
- **The test model correction is type-safe and internal.** `VectorDoc.embedding` is required and
  uses the existing internal structural type at
  `src/tests/integration/helpers/firestoreIntegrationHarness.ts:7,219-224`. `test:types`, build,
  package, and packed-consumer checks all passed; no `@google-cloud/firestore` import was added.
- **No runtime or contract change slipped in.** The implementation diff contains no `src/core`,
  `src/utils`, `src/vector`, ADR, website, README, dependency, or configuration edit. Existing
  nominal recognition at `src/utils/firestoreValueEquality.ts:121-175` remains intact after the
  reviewer mutation was reverted.
- **Existing harness cleanup still holds.** The vector suite uses its established `afterEach` at
  `src/tests/integration/vector-search.integration.test.ts:31-33`; the paired two-file probe also
  passed alongside the query-explain harness consumer.
- **Definition of done:** §11 items 1-14 are evidenced by the source, mutation, probe, and fresh full
  gate. Item 15 is satisfied by this report. Item 16 correctly remains for the post-review cleanup
  commit.

### Deviations from the plan

- **Branch topology:** implementation used `cursor/issue-76-decoded-vector-equality-c567` rather
  than committing directly on `test/issue-76-decoded-vector-equality-coverage`. This is acceptable:
  the branch is based on the pushed plan commit `b6b8c2e`, the merge base remains the plan baseline,
  and no design/test deviation resulted.
- **Mutation restoration method:** the implementer recorded restoring from a file backup rather than
  `git restore`. This is acceptable because the post-restore production diff was empty, the targeted
  test passed, and this review independently repeated the mutation and verified its own revert.
- **Unit count did not increase:** the review skill's generic checklist says both suite counts should
  rise, but plan §10 correctly requires unit to remain `32 / 426` for an integration-only addition.
  The observed unit count is therefore correct, not a missing unit test.

## Not defects

- Existing `as VectorDoc` casts elsewhere in the vector suite remain. Plan §2 explicitly excluded
  that mechanical cleanup, and the new I-1 path introduces no cast.
- The existing vector collection names are fixed rather than timestamp-isolated because vector
  search relies on configured indexes. I-1 scopes its read, reuses the established cleanup, and the
  paired harness-consumer run passed.
- The committed test does not assert decoded constructor identity. That omission is deliberate: a
  future SDK implementation may preserve by-value behavior through a different mechanism, and the
  public ORM result is the contract under review.

## Verdict

**APPROVE** — no fixes remain. The implementation is ready for the plan-directory cleanup commit and
then merge.
