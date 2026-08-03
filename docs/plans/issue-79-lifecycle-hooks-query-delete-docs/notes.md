# Issue #79 — Implementation notes (for adversarial review)

**Implementer:** Cursor Cloud Agent (Grok 4.5) · **Branch:**
`cursor/issue-79-lifecycle-hooks-query-delete-docs-e6df` · **Plan:**
`docs/plans/issue-79-lifecycle-hooks-query-delete-docs/PLAN.md` · **Baseline:** `main` @
`8c5ed6d` — no rebase required (`origin/main` still at that sha; §3 line numbers matched before
edit)

## Status

Done-pending-review. Shipped the §6.1 Lifecycle Hooks prose fix, the §6.2 ADR-0035 #79
cross-reference retarget, and (owner request) the §9.6 best-practices note naming skipped
per-document delete hooks. No `src/**`, tests, READMEs, new ADR, or `docs/2.0/` changes. Full §10
fourteen-leg gate green on the implementation commit; suite counts unchanged (32/426 unit, 36/544
integration). Plan directory left in place for external review.

## Ambiguities resolved

None beyond §1. The §9.6 `best-practices.md` incompleteness was folded into this PR at the owner's
request after the initial implementation (see Deviations).

## Deviations from the plan

1. **§9.6 best-practices incompleteness — folded into this PR (owner request).** The plan deferred
   naming skipped per-document `before/afterDelete` in
   `website/src/content/docs/guides/designing/best-practices.md:107-111`. Owner asked to make that
   change on this branch instead of opening a follow-up. Applied to mirror `crud-operations.md` /
   `lifecycle-hooks.md` (still docs-only; no `src/**`).

## Files touched and why

| File | Change | Plan reference |
| ---- | ------ | -------------- |
| `website/src/content/docs/guides/concepts/lifecycle-hooks.md` | Replaced false example explanation with bulk-vs-per-document wording | §6.1 |
| `docs/adr/0035-hook-delivery-and-write-outcome-errors.md` | Related + References: #79 deferred/out-of-scope → resolved | §6.2 |
| `website/src/content/docs/guides/designing/best-practices.md` | Named skipped per-document delete hooks in the query-level note | §9.6 (owner: fold in) |
| `docs/plans/issue-79-lifecycle-hooks-query-delete-docs/notes.md` | This file | plan-execution |

## Edge cases / traps handled

| Trap | Handled by | Pinned by |
| ---- | ---------- | --------- |
| T1 | §6.1 names bulk hooks that do run | `EXPECT_CONTRADICTION=0` contradiction probe |
| T2 | Only the example explanation (155–158) changed; bulk section left | probe + file read |
| T3 | No `docs/2.0/**` edits | `git diff -- website/src/content/docs/2.0` empty |
| T4 | Wording says “per-document cleanup logic” | file read of applied §6.1 |
| T5 | No new tests | `git diff -- src/tests` empty |
| T6 | No new ADR; no living-index footers | only ADR-0035 cross-ref text |
| T7 | ADR-0035 Related/References say resolved | file read |

## Tests added

| Id | Suite | Asserts | Guards |
| -- | ----- | ------- | ------ |
| _(none)_ | — | — | D5 / §8.1 |

## Mutation checks

N/A — no new tests (D5). Docs fix verified by post-fix contradiction probe (fails with
`EXPECT_CONTRADICTION=0` on the unfixed tree; passes after the edit).

| Test | Mutation | Result |
| ---- | -------- | ------ |
| contradiction-text.mjs (`EXPECT_CONTRADICTION=0`) | Unfixed baseline (pre-edit) | **Fails** — `contradictionPresent: true` |
| contradiction-text.mjs (`EXPECT_CONTRADICTION=0`) | After §6.1 apply | **Passes** — `contradictionPresent: false` |

## Gate results

Baseline (plan): unit 32/426 · integration 36/544.
After change: unit 32/426 · integration 36/544 (unchanged, as predicted).

```
npm run test:types                         ✓
npm run lint                               ✓
npm run check:format                       ✓
npm run test:unit                          ✓ 32 suites / 426 tests
npm run test:integration:emulator          ✓ 36 suites / 544 tests
npm run test:unit:coverage + gate:unit     ✓ all unit coverage gates passed
npm run test:integration:coverage + gate   ✓ all integration coverage gates passed
npm run build                              ✓
npm run check:package                      ✓ 98 files
npm run check:consumer                     ✓ firebase-admin@^14 (default local leg)
npm run check:docs                         ✓ 188 doc files scanned
npm run docs:build                         ✓ 61 pages; lifecycle-hooks HTML has bulk hooks +
                                             per-document cleanup; no literal `:::` on that page
```

Post-fix probes:

```
EXPECT_CONTRADICTION=0 node …/contradiction-text.mjs
  → contradictionPresent: false; exit 0

firebase emulators:exec … query-delete-hook-wiring.mjs
  → beforeBulkDelete:1 afterBulkDelete:1 beforeDelete:0 afterDelete:0
```

Implementation commit: `70d1e23`.

## Anti-instructions checklist

| Anti-instruction | Confirmed |
| ---------------- | --------- |
| Do not edit `src/**` | ✓ |
| Do not edit `docs/2.0/**` | ✓ |
| Do not rewrite the already-correct bulk-hooks section | ✓ |
| Do not say unqualified “hooks do not run” | ✓ |
| Do not add new tests | ✓ |
| Do not create a new ADR / touch living-index footers | ✓ |
| Do not edit sibling pages / fold in best-practices | ✓ for plan-time scope; later **owner-requested** exception — see Deviations #1 |
| Do not hand-edit CHANGELOG.md | ✓ |
| Do not write review.md | ✓ |
| Do not remove plan directory yet | ✓ |
| Commit subject matches §10 | ✓ `docs(website): correct query().delete() hook contradiction (#79)` |

## §11 audit

| §11 item | Result | Evidence |
| -------- | ------ | -------- |
| 1 False claim gone | PASS | `lifecycle-hooks.md:155-158`; probe `falseClaimLine: null` |
| 2 Bulk vs per-doc + per-document cleanup | PASS | same lines |
| 3 Correct section intact | PASS | `lifecycle-hooks.md:160-170` |
| 4 `2.0/**` untouched | PASS | empty diff |
| 5 No src/test changes | PASS | empty diffs |
| 6 ADR-0035 retargeted | PASS | Related 9–10; References 95–96 |
| 7 No new ADR / living-index | PASS | only 0035 wording |
| 8 READMEs untouched | PASS | not in diff; previously grepped clean |
| 9 Post-fix probes green | PASS | both probes above |
| 10 Full gate green; counts unchanged | PASS | gate results section |
| 11 No §7 anti-instruction violations | PASS | checklist |
| 12 notes.md committed with self-review | PASS | this file (commit after `70d1e23`) |
| 13 Probes not promoted as tests | PASS | remain under `docs/plans/.../probes/` |
| 14 Plan dir removed after review | PENDING | correct at this stage |
| 15 best-practices follow-up | PASS (folded in) | `best-practices.md` updated; Deviations #1 |

## Independent adversarial review

**Reviewer:** fresh Task subagent (composer-2.5) · **Reviewed:** `70d1e23` · **Fixes in:** this
notes commit · **Verdict:** pass with fixes (process gaps F1/F2, now addressed)

Given: plan + impl diff + source; **not** these notes. Asked to refute.

### Findings fixed

1. **F1 major — notes.md missing implementation record** — Written and committed in this follow-up
   commit with gate results, trap/§11 audit, and §9.6 deferral.
2. **F2 major — §10 gate not evidenced in reviewable artifacts** — Full fourteen-leg output recorded
   above; both post-fix probes re-run and recorded.

### Findings not treated as defects

- **F3 minor — plan directory still present** — Required until after external review (§11.14).
- **F4 nit — check:docs 188 vs plan’s 186** — Count includes plan-directory files on the branch; no
  link failure.

### Findings deferred

- **Optional coverage pin** (plan D5) — emulator assertion that per-doc delete hooks stay at zero on
  `query().delete()` while bulk hooks fire. Still out of scope; not required to close #79.
- **§9.6 best-practices incompleteness** — **no longer deferred**; applied on this branch per owner
  request (Deviations #1).

### Gate re-run after fixes

No product-code remediation was required after adversarial review (findings were notes/evidence
only). The fourteen-leg gate already ran on `70d1e23` before this notes commit; docs/ADR content was
unchanged by writing notes. Re-running the full chain solely for a notes.md commit is not warranted;
post-fix probes and `check:docs` remain the load-bearing checks for the docs surface and were
green.

## Could-not-verify

- Peer-admin matrix beyond the default `check:consumer` `firebase-admin@^14` leg (plan §5) — CI
  still owns `^12` / `^13` / pinned-firestore legs; no peer surface change expected.
- Opening the §9.6 follow-up issue via `gh` — CLI is write-blocked in this environment; deferred to
  maintainer.

## Open questions for the reviewer

None.
