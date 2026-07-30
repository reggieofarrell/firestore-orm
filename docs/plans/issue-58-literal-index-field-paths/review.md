# Issue #58 — implementation review

**Reviewer:** Codex (GPT-5) · **Round:** 1 · **Reviewed:** uncommitted working tree at
`56ae2d0` (`docs(plan): add issue 58 implementation plan`) · **Branch:**
`codex/issue-58-literal-index-field-paths` · **Plan:** `PLAN.md` @ baseline `e0e7296` · **Tree:**
unchanged by this review except for this `review.md`; the seven implementation/notes files that were
already modified remain modified

**Verdict: APPROVE WITH FIXES** — replace the invalid internal-review link in `notes.md`, correct
the recorded mutation diagnostic count, and rerun the full §10 chain.

---

## What I ran

Every claim below traces to a row here. The full chain short-circuited at `check:docs`; the skipped
`docs:build` leg was then run separately.

| Check | Command | Result |
| ----- | ------- | ------ |
| Full §10 gate | `(14-leg chain) > /tmp/issue58-review-gate.log 2>&1; echo EXIT=$?` | `EXIT=1`: legs 1–12 passed; `check:docs` failed; `docs:build` was skipped |
| Failing leg | `npm run check:docs` | Failed on one broken link at `notes.md:165`: target `75841de7-d0f1-4bea-9405-c0cb78ea4174` does not exist |
| Skipped leg | `npm run docs:build` | Passed separately: 61 pages built; Pagefind indexed 82 HTML files |
| Suite counts | full-chain `test:unit`, `test:integration:emulator`, and both coverage suites | unit `32/417` (baseline `32/417`) · integration `35/532` (baseline `35/532`) |
| Unit coverage | `test:unit:coverage` + `test:coverage:gate:unit` | 87.22% lines overall; utilities 98.93% lines / 94.47% branches / 100% functions, validation 98.42% / 92.92% / 100%, entry exports 100% / 100% / 75.76%; all thresholds passed |
| Integration coverage | `test:integration:coverage` + `test:coverage:gate:integration` | 94.13% lines overall; repository 98.00%, query builder 96.91%, collection group 99.55%, validation 95.97%, vector 93.26% lines; all branch/function/line thresholds passed |
| T2 mutation | Return `LiteralOnly<S>` instead of `S` from the no-`id` branch | `test:types` failed with exactly one diagnostic, TS7053 at `union-model-paths.type-test.ts:139`; arbitrary index access was rejected |
| T1 mutation | Restore unconditional distributive `Omit<S, 'id'>` while retaining the tests | `test:types` failed with 33 diagnostics, all in `union-model-paths.type-test.ts`; aliases, Core/repository, collection-group, vector, masks, and the indexed union pin failed |
| Mutation reverts | Restore each exact source spelling and rerun `npm run test:types` | Green after each revert; final status contains no probe or mutation file |
| Planned alias probe | `node .../probes/resolve.mjs .../probes/field-paths.probe.ts` | P1/P14 paths resolve to `name \| score \| nested \| nested.deep`; P15 retains the intersection; P16 is `unknown`; P19 remains `never`; P24/P25 are `name` |
| Unplanned nominal surface | Temporary compile probe for `OmitId<NominalModel>` where the class has a private brand and no `id` | Passed: `OmitId<NominalModel>` is exactly `NominalModel`, and remains assignable to the nominal class |
| Rejected-helper grep | `rg -n "OmitIdForPaths\|LiteralKeysForPaths" src` | No rows |
| Built-doc directive grep | `rg -n ":::" website/dist --glob '*.html'` | No rows |
| Diff hygiene | `git diff --check HEAD --` | Passed |

---

## Blockers

None.

---

## Major

### M1 — The candidate cannot pass the required documentation gate (`docs/plans/issue-58-literal-index-field-paths/notes.md:165`)

The independently run 14-leg chain exited `1` at leg 13. `check:docs` interpreted the Markdown link
around the internal subagent identifier as a repository-relative documentation target and reported:

```text
✗ 1 broken documentation link(s):

  docs/plans/issue-58-literal-index-field-paths/notes.md:165  [link]  75841de7-d0f1-4bea-9405-c0cb78ea4174
```

This also falsifies the current-tree claims that all 14 legs are green at `notes.md:105` and that
Definition-of-Done item 15 passes at `notes.md:156`.

**Failure scenario:** run the prescribed §10 chain on this working tree; `check:docs` returns
non-zero, short-circuits the chain, and prevents `docs:build` from running in that invocation.

**What closes it:** remove the Markdown link syntax around the internal identifier or replace it
with a durable valid URL/path, then rerun the complete 14-leg chain with an explicit final exit code.

---

## Minor / nits

- **N1** — The mutation evidence says the unfixed source produced 32 diagnostics
  (`docs/plans/issue-58-literal-index-field-paths/notes.md:73`, repeated at `:149`), but the
  independent unconditional-`Omit` mutation produced **33** diagnostics under the locked toolchain,
  all in the intended type-test file. Update the count or document why a different mutation was
  measured.

---

## Verified and holding

- The central implementation matches D1/D2: `LiteralOnly<T>` recovers explicit keys without
  exporting a helper, `LiteralKeys<T>` routes through it, and `OmitId<S>` returns `S` unchanged when
  there is no literal `id` (`src/utils/pathTypes.ts:44–63`, `:208–212`).
- The type-test additions cover direct/nested/numeric aliases, declared and dynamic stored values,
  Core and repository consumers, field masks, collection-group and vector builders, negative
  widening cases, explicit/optional/readonly `id`, the union-intersection case, and the #82 bound
  (`src/tests/types/union-model-paths.type-test.ts:96–286`).
- The two review mutations demonstrate that both value-position index preservation and conditional
  omission are load-bearing. Each mutation was reverted with a clean `test:types` rerun.
- The three Starlight pages accurately distinguish declared literal paths from arbitrary dynamic
  keys and retain the SDK `FieldPath` escape hatch. The types page explicitly documents the #82
  bound.
- ADR-0028 retains its historical limitation and rejected alternative, then appends the issue #58
  amendment and #82 reference (`docs/adr/0028-distributive-omit-id.md:90–120`).
- No Core/vector consumer signature, public export, README, package manifest, runtime source, Jest
  test, or frozen v2 page changed. The rejected path-only helper names are absent.
- The planned probe matches P1–P25, including pure-record/numeric-index/symbol rejection and the
  explicit-`id` intersection bound.
- Legs 1–12 of the full gate passed under Node 24, with baseline suite counts and both suite-specific
  coverage gates holding. The separately run docs build also passed.
- **Deviations from the plan:** Prettier-only ADR wrapping is appropriate. The F1–F5 precision pins
  strengthen the planned tests/docs without changing D1–D5. Removing the implementer-authored
  external-review artifact was appropriate, but retaining its raw agent id as a Markdown link
  introduced M1.

---

## Not defects

- `{ id: string; name: string } & Record<string, unknown>` still resolving to no typed paths is the
  explicit D4/#82 bound, and U58-6 correctly prevents this implementation from overclaiming support.
- No Jest test was added for the type-only alias change; `test:types` is the owning regression gate,
  while both Jest coverage gates remain regression checks.
- The unplanned nominal-class probe shows an observable precision effect: a no-`id` model retains
  private nominal identity instead of becoming a mapped public-property shape. That is consistent
  with D1's explicit “return `S` exactly” contract, so it is not an implementation deviation.

---

## Round 2

**Reviewed:** remediated uncommitted working tree at `56ae2d0` · **Dispositions checked against
`notes.md`:** M1, N1 · **Tree:** unchanged by this review except for this appended Round 2; all
temporary mutations and the nominal probe were reverted

| Finding | Implementer disposition | Reviewer check |
| ------- | ----------------------- | -------------- |
| M1 | **Fixed** — removed Markdown link syntax around the internal agent id, withdrew the stale Run 1/2 gate claims, and recorded a fresh Run 3 | **Confirmed.** `notes.md:107–135` now distinguishes the falsified runs from Run 3, `notes.md:195–201` contains plain text rather than a link, and the independent full chain passed `check:docs` as leg 13 |
| N1 | **Fixed** — corrected the mutation count from 32 to 33 and identified the earlier value as a miscount | **Confirmed.** `notes.md:74–90` and `:179` consistently report 33; an independent Round 2 unconditional-`Omit` mutation produced exactly 33 diagnostics, all in `union-model-paths.type-test.ts` |

**Fresh gate run:** the complete 14-leg Node 24 chain exited **`0`** with no short-circuit. Unit
tests passed at **32 suites / 417 tests** and integration tests at **35 suites / 532 tests**,
matching the plan baseline. Unit coverage was 87.22% lines overall and every unit path gate passed;
integration coverage was 94.13% lines overall and every integration path gate passed.
`check:package` passed with 98 files, the packed consumer passed for Firebase Admin 14 across the
documented ESM/CJS and Express surfaces, `check:docs` passed for 186 files, and `docs:build` produced
61 pages with 82 Pagefind HTML files. No `:::` directive leaked into built HTML.

**Focused rechecks:** the T2 value-shape mutation failed with exactly one TS7053 diagnostic at
`union-model-paths.type-test.ts:139`; the T1 unconditional-`Omit` mutation failed with exactly 33
diagnostics in only that type-test file. Each source spelling was restored and `test:types` returned
green. The unplanned nominal-class exact-identity probe passed again and was deleted.

No new findings.

**Verdict: APPROVE** — M1 and N1 are resolved, the full required gate is green on the remediated
tree, and the implementation satisfies the plan's definition of done.
