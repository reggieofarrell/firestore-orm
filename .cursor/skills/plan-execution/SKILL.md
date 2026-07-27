---
name: plan-execution
description: Execute a committed implementation plan from docs/plans/ that was handed to you, keeping notes.md as you go and passing an independent refute-first adversarial review before declaring the work ready. Use when picking up a plan-backed issue branch, or via the implement-plan command. NOT for writing the plan — see the implementation-planning skill. NOT for a plan you produced with the user in this same session, where the notes artifact and plan-directory lifecycle do not apply.
---
# Plan Execution (firestore-orm)

You have been handed a plan under `docs/plans/issue-NN-<slug>/`. It is a **contract**, and it was
written from executed evidence — treat it as authoritative over the issue body it came from.

You owe three things: the change, the tests, and **`notes.md`** — a section-by-section reply to the
plan. A deep adversarial review follows your work, and `notes.md` is the first thing the reviewer
reads. Write it accordingly.

Read [`AGENTS.md`](../../../AGENTS.md) "Working mode" first. Plan conventions and lifecycle:
[`docs/plans/README.md`](../../../docs/plans/README.md). The explicit entry point is the
`implement-plan` command.

**Scope:** this is for a **committed plan handed to you**. If you and the user produced a plan together
in this session and you are implementing it directly, you do not owe the `notes.md` artifact or the
plan-directory lifecycle — there is no context boundary to survive. You do still owe the gate, the
mutation checks, the §9 bookkeeping, and the refute-first self-review, which are not handoff-specific.

## Before you touch anything

1. **Read `PLAN.md` end to end**, especially §1, §4 and §7. §1 decisions are **settled** — do not
   re-litigate them. §4 traps are the failures you are most likely to walk into. §7's
   anti-instructions are **binding**.
2. **Check out the branch** named in the header — it already exists and carries the plan. Do not cut a
   new one. If `main` has moved past the plan's baseline sha, rebase and **re-verify §3's line
   numbers before editing**; they drift.
3. **Re-run the probes** in `probes/` if you doubt a §3 row. §3 outranks the issue.
4. If a §6 block does not apply cleanly, that is a **deviation** — record it and say why. Never
   silently improvise a different design.

## While you work — notes as you go, not reconstructed at the end

Write each deviation **at the moment you decide it**. Notes assembled afterwards lose exactly what
the reviewer needs: why you diverged, and what you knew when you did.

`notes.md` mirrors the plan, section by section. Start from
[`notes-template.md`](notes-template.md):

| `notes.md` section                | Answers    |
| --------------------------------- | ---------- |
| Status · Ambiguities resolved     | §1, §2     |
| **Deviations from the plan**      | §6, §7     |
| Files touched and why             | §3         |
| Edge cases / traps handled        | §4         |
| Tests added · **Mutation checks** | §8, §11    |
| **Gate results**                  | §10        |
| Could-not-verify                  | §5         |
| Anti-instructions checklist       | §7         |
| **Independent adversarial review**| this skill |

## The gate

Run every leg from §10 and **report real output**. Never claim a leg you did not execute; if one
fails, say so with the failure.

- **Suite counts must move as the plan predicted.** Both should go up. An unexpected change in an
  existing suite means you diverged from §6 — investigate before proceeding.
- **Every new test must fail on the unfixed baseline.** Mutation-check the load-bearing ones: revert
  the fix (or `git stash`), confirm the test fails, restore. Record each as a row — test, mutation,
  observed failure. A test that passes both ways guards nothing.
- **ADR bookkeeping (§9): read the current values out of the tree, never copy them from the plan.**
  Claim the next free number in `docs/adr/`, and grep the current `(#N–#41)` range rather than
  trusting an enumerated file list — the set of living-index footers grows every time an issue ships.
- **After `docs:build`, grep the built HTML for a leaked literal `:::`.** `website/**/*.md` is
  prettier-exempt and an aside whose closing fence lands on a content line renders as text. Neither
  `check:docs` nor `docs:build` catches it. This shipped live twice.

## Self-review before you declare the work ready

Do this yourself, before asking for external review. It is not optional and it is not a formality.

1. **Use a genuinely independent reviewer — fresh context.** A new session, tab, or subagent
   depending on your tool; not you asking yourself, which reproduces your own blind spots.
2. **Hand it the diff, the plan, and the tests — _not_ your `notes.md`.** Your notes are an account
   of what you believe you did; feeding them in anchors the reviewer to that account instead of the
   code.
3. **Prompt it to refute, not to confirm.** "Review this" produces agreement. Ask it to find what is
   wrong, to default to a finding when uncertain, and to check §7 anti-instruction violations and §4
   trap semantics specifically.
4. **Audit §11 against source, not memory.** One row per definition-of-done item, each PASS backed by
   the file that proves it.
5. **Give every finding an id and a disposition.** `F1`, `F2`, … with a severity, and each one landing
   in exactly one bucket: **fixed** (say how), **not a defect** (say why), or **deferred** (open an
   issue and reference it). An undisposed finding makes the review unfalsifiable.
6. **Re-run the full gate after the fixes.** Fixing findings can break something else — and "gate not
   re-run after remediation" has itself been a finding here. Report both runs.

If the reviewer's report is long, save it as `review.md` beside `notes.md` and summarize the
dispositions in the notes.

## Ready for external review

- [ ] Every §11 row satisfied and audited against source
- [ ] Full gate green with real output; suite counts as predicted; gate re-run after self-review fixes
- [ ] Mutation checks recorded for the load-bearing tests
- [ ] Assertion probes promoted to committed tests (§8), not left in `probes/`
- [ ] Every §7 anti-instruction confirmed not violated, as a checklist
- [ ] All findings disposed; nothing left silently open
- [ ] `notes.md` committed, including honest could-not-verify items carried from §5
- [ ] The plan directory **still present** — review happens with it in place

## What you do not do

- **Do not commit unless asked.** Leave the tree clean and report the Conventional Commits subject
  from §10.
- **Do not delete the plan directory.** Its removal is a separate cleanup commit after review, so the
  reviewer can read the plan and your notes in the PR's Files-changed view.
- **Do not fold in a second defect you discover.** Defer it, pin today's behavior with a test, and open
  a follow-up issue — the plan's §5 and §7 say which ones are already known and deliberately out of
  scope.
- **Do not re-litigate §1**, and do not quietly drop a §9 bookkeeping edit because it looks
  redundant.
- **Do not overclaim.** Anything you reasoned about rather than ran belongs in could-not-verify.
