# Issue #79 — Correct lifecycle-hooks `query().delete()` contradiction

**Implementer:** Cursor Cloud Agent or later session · **Reviewer:** independent agent via the
`implementation-review` skill · **Baseline:** `cursor/issue-76-decoded-vector-equality-c567` @
`32566c722b0d479e2d6007d788a7c543aaab59c8` (`chore: remove issue 76 plan directory after review`) ·
**Branch:** `cursor/issue-79-lifecycle-hooks-query-delete-docs-e6df` — already created and pushed with
this plan on it; check it out, do not cut a new one

**Affected file identity vs `origin/main`:** `website/src/content/docs/guides/concepts/lifecycle-hooks.md`
is byte-identical to `origin/main` @ `8c5ed6d` on this baseline (verified: empty `git diff
origin/main -- <that path>`).

**Issue:** [#79](https://github.com/reggieofarrell/firestore-orm/issues/79) — label `bug` only. This
is a **docs-only** bug. It is **not** an ADR-0017 `#35–#41` deferral, so the deferral /
living-index bookkeeping does **not** apply. Do **not** open a new ADR for correcting prose to match
an already-shipped contract.

> **Acceptance (verbatim from the issue):**
>
> Correct the example explanation without changing runtime behavior. Keep the distinction explicit:
> query-level delete skips per-document `beforeDelete` / `afterDelete`, but does run
> `beforeBulkDelete` / `afterBulkDelete`.

---

## §0 How to use this plan

1. Read §1 (settled — do not re-litigate) and §4 (traps) **before** editing.
2. §6 is the **exact prose replacement** for one paragraph in the Lifecycle Hooks guide. It is not
   TypeScript. It was applied temporarily, verified with `EXPECT_CONTRADICTION=0` on the
   contradiction probe and `npm run check:docs`, then reverted (see §12).
3. Every claim in §3 was produced by an executed probe or file read on this baseline. Probes live in
   `docs/plans/issue-79-lifecycle-hooks-query-delete-docs/probes/`. **Do not trust the issue body's
   line numbers over §3** — they are stale (P2).
4. **No prototype of production source was retained.** Runtime already matches the intended docs
   (P4–P6). This is a prose fix only; bounds are in §5.
5. **Follow the `plan-execution` skill** — write `notes.md` as you go, re-run the §10 post-fix
   probes, and complete the refute-first self-review before external review. Never write
   `review.md` yourself.
6. Leave this directory present through external review. Remove it only in the final cleanup commit
   after review (§11).

---

## §1 Owner-approved decisions

| Id | Fork | Decision | Rejected alternative and why |
| --- | ---- | -------- | ---------------------------- |
| **D1** | Docs-only vs runtime change | **Correct the Lifecycle Hooks guide prose only.** Runtime already fires bulk delete hooks and skips per-document delete hooks on `query().delete()` (P4–P6). | Changing `QueryBuilder.delete()` would invent a behavior change the issue explicitly forbids and would break existing integration coverage (P7–P8). |
| **D2** | Rewrite the example vs rewrite the explanation | **Keep the `afterDelete` → `orderRepo.query()…delete()` example.** Rewrite only the explanation so it matches the bulk-vs-per-document distinction already stated in the next section and on sibling pages (P3, P9). | Dropping the example loses the recursive-cleanup teaching point the page is using; changing the example to `bulkDelete` would obscure that query-level delete is the intended path. |
| **D3** | Touch frozen `docs/2.0/` archive vs leave it | **Do not edit `website/src/content/docs/2.0/**`.** The v2 archive correctly documents that v2 query-level writes ran **no** hooks (P10). | "Fixing" the archive would falsify historical v2 behavior and violate the frozen-archive rule in the planning skill / `docs-api-sync` map. |
| **D4** | New ADR vs bookkeeping-only | **No new ADR.** Update ADR-0035's Related/References wording that still says #79 is deferred/out-of-scope so it points at the resolution once this ships (P11). | A new ADR for a three-line docs correction would invent architecture theater; the contract did not change. |
| **D5** | New regression test vs rely on existing coverage | **No new unit/integration/type test.** Existing emulator coverage already observes bulk hooks on `query().delete()` (P7–P8). A new runtime test would pass on the unfixed baseline and therefore would not guard this docs fix (skill rule: every new test must fail on the unfixed baseline). | Adding a "per-document hooks skipped" integration assertion is a valid coverage improvement but is a second defect/gap — defer it (see §2 / §9.6). |

`D2`–`D5` are derived from the issue's acceptance text and baseline evidence; they were not separately
asked as questions. Do not re-litigate.

---

## §2 Scope

### In scope

| Area | Change |
| ---- | ------ |
| Lifecycle Hooks guide | Replace the false example explanation at `lifecycle-hooks.md:155-157` with the §6 prose so it no longer claims delete hooks do not fire, while keeping the recursive-cleanup teaching point via the per-document / bulk distinction. |
| ADR-0035 cross-reference | Update the Related + References bullets that still label #79 as deferred / out-of-scope so they record the docs resolution (no amendment blockquote required — the ADR's decisions are unchanged). |
| Verification | Re-run both probes (post-fix mode on the text probe), `check:docs`, `docs:build` (and grep built HTML if any aside is added — none are prescribed), and the full §10 gate. |

### Explicitly **out** of scope

- **Any `src/**` edit** — runtime already matches acceptance (P4–P6); issue forbids behavior change (D1).
- **`website/src/content/docs/2.0/**`** — frozen archive; v2 claim is historically correct (D3, P10).
- **Sibling v3 pages** that already state the correct distinction (`crud-operations.md`,
  `queries.md`, `troubleshooting.md`, `query-builder.md`, `repository.md`) — leave them alone (P9).
- **`best-practices.md:107-111` incompleteness** — it correctly says bulk hooks run, but lists only
  per-document `before/afterUpdate` (omits delete) when telling readers what is skipped. That is a
  minor incompleteness, **not** the contradiction #79 filed. Deferred (§9.6).
- **New tests** — would not fail on the unfixed baseline (D5).
- **README / `npm-readme.md`** — grepped; neither contains the false claim (P12).
- **New ADR / ADR-0017 living-index footers / scope-and-capabilities row moves** — not a deferral
  ship; contract unchanged (D4).
- **JSDoc on `QueryBuilder.delete()`** — the method body wires bulk hooks and the `select()` guard
  already names them; expanding JSDoc is optional polish, not required to close #79.

### Scope correction — where the issue is stale

The issue cites `lifecycle-hooks.md:120-122` for the false claim and `124-133` for the correct bulk
section. On this baseline those line numbers are wrong (P2):

| Issue claim | Actual on baseline `32566c7` |
| ----------- | ---------------------------- |
| False claim at 120–122 | False claim at **155–157** |
| Correct bulk section at 124–133 | Correct section heading at **159**; body at **161–165** |
| Runtime at `QueryBuilder.ts:2161-2174` | `beforeBulkDelete` / `afterBulkDelete` wiring at **2267–2280** |

Re-enumerate from §3 before editing if `main` moved.

---

## §3 Verified facts

### 3.1 Contradiction still present — `probes/contradiction-text.mjs`

```bash
node docs/plans/issue-79-lifecycle-hooks-query-delete-docs/probes/contradiction-text.mjs
```

| Id | Expression / condition | Observed | Note |
| -- | ---------------------- | -------- | ---- |
| **P1** | File contains both the false claim substring and the correct bulk-hooks section | `contradictionPresent: true`; false claim line **155**; correct heading line **159**; `hasCorrectBulkBody: true` | This is the defect #79 names. |
| **P2** | Issue body line numbers vs current file | Issue 120–122 / 124–133 do not match; actual 155–157 / 159+ | Issue filed during #46 planning; page grew afterward. |

### 3.2 Sibling pages already correct — file reads

| Id | Path | Observed |
| -- | ---- | -------- |
| **P3** | `guides/concepts/lifecycle-hooks.md:159-165` | Section "Query-level writes run the bulk hooks" correctly states `query().delete()` runs `beforeBulkDelete` / `afterBulkDelete` and skips per-document delete hooks. |
| **P9** | `crud-operations.md:291-292`; `queries.md:474`; `troubleshooting.md:55-56`; `query-builder.md:282`; `repository.md:406-407` | All state the bulk-vs-per-document distinction correctly. The false "does **not** fire delete hooks" phrasing appears **only** at `lifecycle-hooks.md:155` among live v3 pages. |

### 3.3 Runtime wiring and emulator behavior

| Id | Expression / condition | Observed | Note |
| -- | ---------------------- | -------- | ---- |
| **P4** | `src/core/QueryBuilder.ts:2267-2280` | `delete()` calls `runHooks('beforeBulkDelete', …)` then `runHooks('afterBulkDelete', …)` after `commitInChunks` | Authoritative wiring. |
| **P5** | `rg runHooks\|beforeDelete\|afterDelete` on `QueryBuilder.ts` | No `beforeDelete` / `afterDelete` calls; only bulk update/delete hook names | Per-document delete hooks cannot fire from this path. |
| **P6** | `probes/query-delete-hook-wiring.mjs` under `firebase emulators:exec` | `beforeBulkDelete: 1`, `afterBulkDelete: 1`, `beforeDelete: 0`, `afterDelete: 0` | Both sides of the docs distinction observed in one run. |
| **P7** | `repository-hook-immutability.integration.test.ts:294-315` | `query().whereId(...).delete()` exercises `beforeBulkDelete` / `afterBulkDelete` | Existing coverage. |
| **P8** | `repository-write-outcomes.integration.test.ts:312-333` | `query().delete()` after-hook failure reports `hook.event: 'afterBulkDelete'` | Existing coverage; proves the after bulk hook is on the query path. |

### 3.4 Archive, ADR, READMEs, baseline counts

| Id | Source | Observed |
| -- | ------ | -------- |
| **P10** | `website/src/content/docs/2.0/guides/lifecycle-hooks.md:91-103` | Archive says query-level writes run **no** hooks — correct for v2; must not be "fixed". |
| **P11** | `docs/adr/0035-hook-delivery-and-write-outcome-errors.md:9-10,95-96` | Related + References still call #79 "out of scope here" / "deferred". |
| **P12** | `rg` over `README.md` + `npm-readme.md` for the false claim / `query().delete` hook wording | No hits — READMEs unaffected. |
| **G1** | `npm run test:unit` on clean tree | **32 suites / 426 tests** passed. |
| **G2** | `npm run test:integration:emulator` on clean tree | **36 suites / 545 tests** passed. |

### 3.5 Authoritative site enumeration (`32566c7`)

| File | Lines | Action |
| ---- | ----- | ------ |
| `website/src/content/docs/guides/concepts/lifecycle-hooks.md` | **155–157** | Replace prose per §6. |
| `docs/adr/0035-hook-delivery-and-write-outcome-errors.md` | **9–10**, **95–96** | Retarget #79 from deferred → resolved (wording only). |

**Deliberately NOT changed** (justify in `notes.md` if you touch them):

- `src/core/QueryBuilder.ts:2239-2285` — runtime already correct (P4–P6); issue forbids behavior change (D1).
- `website/src/content/docs/guides/concepts/lifecycle-hooks.md:159-169` — already correct (P3); do not rewrite the whole section.
- `website/src/content/docs/guides/working-with-data/crud-operations.md:291-292` — already correct (P9).
- `website/src/content/docs/guides/working-with-data/queries.md:469-474` — already correct (P9).
- `website/src/content/docs/reference/troubleshooting.md:55-56` — already correct (P9).
- `website/src/content/docs/reference/query-builder.md:278-282` — already correct (P9).
- `website/src/content/docs/reference/repository.md:406-407` — already correct (P9).
- `website/src/content/docs/2.0/guides/lifecycle-hooks.md:91-103` — frozen v2 truth (P10, D3).
- `website/src/content/docs/guides/designing/best-practices.md:107-111` — incomplete delete mention deferred (§9.6), not the filed contradiction.
- `README.md` / `npm-readme.md` — no false claim (P12).
- All test files — no new tests (D5); existing coverage stays.

### 3.6 Gate headroom

Not applicable: no production / coverage-gated source paths change. Suite counts must stay **32/426**
unit and **36/545** integration.

### 3.7 Temporary §6 verification (reverted)

| Step | Result |
| ---- | ------ |
| Applied §6 prose to `lifecycle-hooks.md` | Old paragraph matched and replaced once |
| `EXPECT_CONTRADICTION=0 node …/contradiction-text.mjs` | `contradictionPresent: false`; exit 0 |
| `npm run check:docs` | `✓ documentation links OK (186 doc files scanned)` |
| `git checkout -- website/.../lifecycle-hooks.md` | Contradiction restored (`contradictionPresent: true`) |

---

## §4 Traps

Ordered by how badly a reasonable implementer gets them wrong.

### T1 — "Fixing" the claim by saying hooks never fire (P1, P3, P6)

The false sentence says delete hooks do not fire. A naïve fix is to delete the sentence or replace
it with "hooks do not run." That **re-widens** the lie: bulk hooks **do** run. Silent docs
regression against P6 and against the next section on the same page. The §6 prose must keep both
halves of the distinction.

### T2 — Editing the already-correct section instead of the example explanation (P1–P3)

The page's defect is the **example explanation** at 155–157 contradicting the correct section at
159+. Rewriting 159+ "to be clearer" while leaving 155–157 intact leaves the contradiction. Trap
coverage: post-fix `contradiction-text.mjs` with `EXPECT_CONTRADICTION=0` must see the false
substring gone.

### T3 — Touching `docs/2.0/` because it has the same English (P10, D3)

The archive's "does not fire delete hooks" / "do not run any hooks" language is **correct for v2**.
Editing it "for consistency" falsifies the published 2.0 docs. Do not open those files.

### T4 — Softening "recursively" into an overclaim about bulk hooks (P6, D2)

The example's point is avoiding re-entry into **per-document** `afterDelete` cleanup. After the fix,
`orderRepo`'s `afterBulkDelete` **will** still fire. Wording that says "avoids re-triggering cleanup
hooks" (unqualified) is false. §6 says **per-document** cleanup explicitly.

### T5 — Adding a runtime test that cannot fail on the unfixed baseline (D5)

A new integration assertion that bulk hooks fire / per-doc hooks skip passes today. It does not
guard the docs edit. Do not invent suite churn under the guise of #79.

### T6 — Shipping a new ADR or living-index footer churn (D4)

#79 is a `bug` label, docs-only. Copying the ADR-0017 deferral bookkeeping pattern from a feature
issue is a known failure mode (skill map; #54). Only retarget ADR-0035's #79 cross-reference text.

### T7 — Leaving ADR-0035 saying "deferred" after the fix (P11)

If the guide is fixed but ADR-0035 still says #79 is deferred, the durable record lies. Update both
Related and References bullets.

---

## §5 Could not verify / scope bounds

- **Full fourteen-leg gate on the finished docs edit** — not run during planning (no committed
  implementation yet). The planner verified the temporary §6 apply + `check:docs` + both probes +
  baseline suite counts (G1–G2, §3.7). The implementer owes the full §10 chain on the real edit.
- **`docs:build` HTML aside grep** — not applicable unless the implementer adds a `:::note` /
  `:::caution` (none prescribed). If they do, they must `docs:build` and grep the built HTML for a
  leaked literal `:::`.
- **Peer-admin matrix / `check:consumer` legs beyond the default** — docs-only; no peer surface
  change. Still run `check:consumer` once in §10 as part of the standard gate.
- **Carried over, explicitly deferred** — `best-practices.md` incomplete per-document delete mention
  (§9.6); optional "per-doc hooks skipped on `query().delete()`" integration pin (D5).

---

## §6 API specification

There is no public API or TypeScript change. The "spec" is the exact prose replacement.

### 6.1 `website/src/content/docs/guides/concepts/lifecycle-hooks.md` — example explanation

**Replace** the paragraph currently at lines 155–157 (exact old text):

```markdown
In the last example, `query().delete()` is a query-level bulk write that does **not** fire delete
hooks (see below) — which is exactly what you want here, since it avoids re-triggering cleanup logic
recursively.
```

**with** this paragraph (copy-verbatim):

```markdown
In the last example, `query().delete()` is a query-level bulk write: it runs
`beforeBulkDelete` / `afterBulkDelete` on the target repository, but does **not** run the
per-document `beforeDelete` / `afterDelete` hooks — which is exactly what you want here, since it
avoids re-triggering per-document cleanup logic recursively.
```

**How this block was checked:** temporary apply → `EXPECT_CONTRADICTION=0` contradiction probe exit 0
with `contradictionPresent: false` → `npm run check:docs` green → revert (§3.7 / §12). The false
claim substring used by the probe (`query().delete()` is a query-level bulk write that does **not**
fire delete) must be absent after the edit.

Guards: T1, T2, T4.

`website/**/*.md` is prettier-exempt — match surrounding wrap style by hand (already mirrored above).

### 6.2 `docs/adr/0035-hook-delivery-and-write-outcome-errors.md` — cross-reference retarget

In **Related** (lines 9–10), change the #79 parenthetical from docs-only / out-of-scope to resolved,
preserving the link. Exact replacement for the Related fragment:

```markdown
  [Issue #79](https://github.com/reggieofarrell/firestore-orm/issues/79) (lifecycle-hooks prose
  contradiction for `query().delete()` — resolved; docs-only),
```

In **References** (lines 95–96), change:

```markdown
- [Issue #79](https://github.com/reggieofarrell/firestore-orm/issues/79) (docs contradiction,
  deferred)
```

to:

```markdown
- [Issue #79](https://github.com/reggieofarrell/firestore-orm/issues/79) (docs contradiction,
  resolved)
```

Do **not** add an `> Amendment` blockquote — ADR-0035's decisions are unchanged; only the follow-up
pointer updates (D4, T6, T7).

### 6.3 Size

2 files, ~±8 lines total. No runtime behavior change. No new tests. No new ADR file.

---

## §7 Implementation sequence and anti-instructions

1. Check out `cursor/issue-79-lifecycle-hooks-query-delete-docs-e6df` — it already carries this plan.
   If the cloud base / `main` moved past `32566c7`, rebase and **re-verify §3 line numbers** before
   editing.
2. Apply §6.1 to `lifecycle-hooks.md` (the example explanation only).
3. Apply §6.2 to ADR-0035 Related + References.
4. Run post-fix probes (§10). Confirm `EXPECT_CONTRADICTION=0` exits 0 and the emulator hook probe
   still reports bulk fire / per-doc skip (runtime unchanged).
5. Run `npm run check:docs` and `npm run docs:build`.
6. Full gate (§10). Write `notes.md`. Leave the plan directory in place for review.

### Anti-instructions

- **Do not** edit `src/core/QueryBuilder.ts` or any other `src/**` file (D1, T5).
- **Do not** edit `website/src/content/docs/2.0/**` (T3).
- **Do not** rewrite the already-correct "Query-level writes run the bulk hooks" section as a
  substitute for fixing lines 155–157 (T2).
- **Do not** say unqualified "hooks do not run" or "cleanup hooks are skipped" (T1, T4).
- **Do not** add new unit/integration/type tests for this issue (D5, T5).
- **Do not** create a new ADR or touch ADR-0017 living-index footers (T6).
- **Do not** edit sibling pages that are already correct, or fold in the `best-practices.md`
  incompleteness (out of scope / §9.6).
- **Do not** hand-edit `CHANGELOG.md`.
- **Do not** write `review.md`.
- **Do not** remove `docs/plans/issue-79-*/` until after external review (§11).
- **Do not** commit unless your workflow requires it for the handoff PR; keep Conventional Commits
  subject as in §10.

---

## §8 Test specification

### 8.1 No new suite entries

| Id | Asserts | Observable when it fails | Guards |
| -- | ------- | ------------------------ | ------ |
| _(none)_ | — | — | — |

Existing coverage that already pins the runtime half of the distinction (do not modify):

| Existing | File | What it observes |
| -------- | ---- | ---------------- |
| E-1 | `src/tests/integration/repository-hook-immutability.integration.test.ts` (query delete nested-forge case) | `beforeBulkDelete` / `afterBulkDelete` run on `query().delete()` |
| E-2 | `src/tests/integration/repository-write-outcomes.integration.test.ts` (`query().delete() afterBulkDelete failure…`) | after-hook phase names `afterBulkDelete` for query delete |

### 8.2 Trap coverage — the inverse direction

| Trap | Site | Falsifying check | What it observes |
| ---- | ---- | ---------------- | ---------------- |
| T1 | `lifecycle-hooks.md` example explanation | `EXPECT_CONTRADICTION=0` contradiction probe | False "does **not** fire delete" substring absent; correct bulk section still present |
| T2 | same | same probe + visual read that 155–157 changed | Fix landed on the example explanation, not only on § "Query-level writes…" |
| T3 | `docs/2.0/**` | `git diff -- website/src/content/docs/2.0` empty | Archive untouched |
| T4 | example explanation wording | manual read of §6.1 as applied | "per-document cleanup" present; no unqualified "hooks skipped" |
| T5 | `src/tests/**` | `git diff -- src/tests` empty | No new tests |
| T6 | `docs/adr/**` except 0035 cross-ref | no new ADR file; no living-index footer edits | Only §6.2 text change |
| T7 | ADR-0035 Related + References | file read | "#79" no longer labeled deferred/out-of-scope |

### 8.3 Coverage gates

| Changed path | Gate |
| ------------ | ---- |
| `website/src/content/docs/guides/concepts/lifecycle-hooks.md` | neither (docs); enforce via `check:docs` + `docs:build` |
| `docs/adr/0035-hook-delivery-and-write-outcome-errors.md` | neither (in-repo ADR) |

Suite counts must remain G1/G2. No coverage-headroom claim needed.

---

## §9 Docs and ADR bookkeeping

### 9.1 Bookkeeping — what does **not** apply

- **Not** an ADR-0017 `#35–#41` deferral ship → **no** amendment blockquote in ADR-0017, **no**
  living-index footer decrements, **no** `scope-and-capabilities.md` row move.
- **Not** a contract-level change → **no** new ADR from `0000-template.md`.
- **Not** a public API / export / signature change → **no** Starlight API reference rewrites beyond
  the one false paragraph, **no** `src/index.ts` / packageExports churn, **no** readme-sync.

### 9.2 New ADR

**None.** Say so in the PR body.

### 9.3 ADR bookkeeping edits

| File | Edit |
| ---- | ---- |
| `docs/adr/0035-hook-delivery-and-write-outcome-errors.md` | §6.2 — retarget #79 from deferred/out-of-scope to resolved in Related + References only. |

### 9.4 Website — 1 page

| Page | Line | Change |
| ---- | ---- | ------ |
| `website/src/content/docs/guides/concepts/lifecycle-hooks.md` | 155–157 | §6.1 prose replacement |

No new asides. No sidebar changes. `website/**/*.md` is prettier-exempt — match wrap style by hand.

### 9.5 READMEs

Grepped both (`README.md`, `npm-readme.md`) for the false claim and for `query().delete` hook
wording — **neither is affected** (P12). State that in the PR body. Do not run a needless
readme-sync pass.

### 9.6 Follow-up issue to open (after this PR, or with it if the implementer prefers)

**Title:** `docs: mention per-document delete hooks in best-practices query-level note`

**Body:** `website/src/content/docs/guides/designing/best-practices.md:107-111` correctly says
`query().update()` / `query().delete()` run bulk hooks, but when naming the skipped per-document
hooks it only lists `before/afterUpdate`. Mirror `lifecycle-hooks.md` / `crud-operations.md` and
also name `before/afterDelete`. Docs-only; found while planning #79; deliberately out of scope
there.

**Labels:** `bug` (or `documentation` if that label exists).

Optional second follow-up (coverage, not docs): emulator assertion that `beforeDelete` /
`afterDelete` stay at zero across `query().delete()` while bulk hooks fire — only if desired; not
required to close #79 (D5).

---

## §10 Gate and commit

```bash
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"
npm run test:types && npm run lint && npm run check:format && npm run test:unit && npm run test:integration:emulator && npm run test:unit:coverage && npm run test:coverage:gate:unit && npm run test:integration:coverage && npm run test:coverage:gate:integration && npm run build && npm run check:package && npm run check:consumer && npm run check:docs && npm run docs:build
```

Fourteen legs. Report failures with output — never claim a leg passed that you did not execute.

Baseline before your change: unit **32 suites / 426 tests**, integration **36 suites / 545 tests**.
Both must stay unchanged (docs/ADR-only). Coverage gates should be unaffected.

Re-run the probes against the finished docs:

```bash
EXPECT_CONTRADICTION=0 node docs/plans/issue-79-lifecycle-hooks-query-delete-docs/probes/contradiction-text.mjs
# expect: contradictionPresent false, exit 0

npm run build && npx firebase emulators:exec --project demo-firestoreorm-test --only firestore \
  "node docs/plans/issue-79-lifecycle-hooks-query-delete-docs/probes/query-delete-hook-wiring.mjs"
# expect: bulkHooksFired true, perDocumentHooksSkipped true (runtime unchanged)
```

**Commit subject** (Conventional Commits; commitlint runs on `commit-msg`):

```
docs(website): correct query().delete() hook contradiction (#79)
```

**Is it breaking?** **No.** Consumer-visible runtime and TypeScript contracts are unchanged; only
prose is corrected to match existing behavior. Folds into the unreleased `3.0.0` docs surface without
a `!` commit.

---

## §11 Definition of done

| # | Item |
| - | ---- |
| 1 | §6.1 applied: false "does **not** fire delete hooks" claim gone from `lifecycle-hooks.md` |
| 2 | Example explanation keeps the bulk-vs-per-document distinction and "per-document cleanup" wording (T1, T4) |
| 3 | Correct section at ~159+ left intact (T2) |
| 4 | `docs/2.0/**` untouched (T3) |
| 5 | No `src/**` or test-file changes (D1, D5) |
| 6 | ADR-0035 Related + References no longer call #79 deferred/out-of-scope (T7) |
| 7 | No new ADR; no ADR-0017 living-index / scope-and-capabilities churn (T6, §9.1) |
| 8 | READMEs untouched; PR body notes they were grepped clean (P12) |
| 9 | Post-fix probes green (§10) |
| 10 | Full gate green (§10) with real output; suite counts unchanged at 32/426 and 36/545 |
| 11 | Nothing in the §7 anti-instruction list violated |
| 12 | `notes.md` committed: deviations, unverified items, adversarial self-review |
| 13 | Assertion probes were not "promoted" as tests — correctly left as investigation probes (D5) |
| 14 | `git rm -r docs/plans/issue-79-lifecycle-hooks-query-delete-docs/` — plan directory removed in this PR **after** external review |
| 15 | Follow-up for `best-practices.md` incompleteness opened or explicitly deferred in `notes.md` (§9.6) |

---

## §12 Pre-handoff verification

What the **planner** ran before pushing this plan — not the implementer's checklist (§11).

| Check | Command / method | Result |
| ----- | ---------------- | ------ |
| Baseline identity | `git log -1 --oneline`; `git rev-parse HEAD`; `gh issue view 79 --json …` | `32566c7`; issue open; title/labels/`bug`; acceptance quoted in header |
| Contradiction probe (unfixed) | `node …/contradiction-text.mjs` | `contradictionPresent: true`; false claim line 155; correct heading 159 |
| Contradiction probe (expect fixed, on unfixed tree) | `EXPECT_CONTRADICTION=0 node …` | exit 1 (expected) |
| Emulator hook probe | `firebase emulators:exec … query-delete-hook-wiring.mjs` | bulk 1/1, per-doc 0/0 |
| Source wiring read | `QueryBuilder.ts:2267-2280` + `rg` | bulk hooks only; no per-doc delete hooks on query path |
| §6 prose as written | temporary apply + `EXPECT_CONTRADICTION=0` + `check:docs` + revert | contradiction cleared; links OK (186 files); reverted |
| Every `from '…'` specifier in §6 | N/A — markdown only | — |
| Declaration emit | N/A — no public types | — |
| Sibling / README / 2.0 greps | §3 commands | P9–P12 as recorded |
| Baseline suite counts | `test:unit`; `test:integration:emulator` | **32/426**; **36/545** |
| Gate headroom | N/A — no coverage-gated paths | — |
| Unresolved conditionals | re-read §§2–9 | none (best-practices deferred to §9.6; no-new-test resolved by D5) |
| Trap coverage inverse walk | §4 against §8.2 | every trap × site has a falsifying check |
| Full §10 gate on unfinished tree | not claimed green for the docs edit | planner ran baseline suites + `check:docs` on temp apply; implementer owes full fourteen legs |

---

## Appendix — probe inventory (`probes/`, beside this file)

| File | What it proves |
| ---- | -------------- |
| `probes/contradiction-text.mjs` | Live guide still contains the false claim next to the correct bulk section (P1); post-fix mode via `EXPECT_CONTRADICTION=0` |
| `probes/query-delete-hook-wiring.mjs` | Emulator: `query().delete()` fires bulk delete hooks and skips per-document delete hooks (P6) |
