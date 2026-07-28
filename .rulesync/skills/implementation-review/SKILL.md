---
name: implementation-review
description: Review a plan-backed implementation on a local branch and write the findings to docs/plans/<issue>/review.md so the implementer can act on them. Use when an agent (Cursor, a cloud agent, a teammate) says an issue is "ready for review" and the work is a local branch or unpushed commit, or via the write-review command. NOT for reviewing a GitHub pull request — use the built-in review flow for that. NOT for reviewing the PLAN before implementation starts — that is plan-review.md, see the implementation-planning skill. NOT for reviewing your own implementation — that is the plan-execution skill's refute-first self-review, which stays in chat.
targets:
  - '*'
---

# Implementation Review (firestore-orm)

You are the **external reviewer** in a local loop: an agent implements on a branch, you review, they
act, you re-review. The loop's two channels are files in the plan directory —

- **inbound** `notes.md`: the implementer's account of what they did.
- **outbound** `review.md`: your findings, in a form they can act on without your context.

`review.md` is reserved for you (`docs/plans/README.md`); implementers must not write it. Writing
your findings only into chat is the failure this skill exists to prevent — the implementer is a
different agent in a different session, and chat does not survive the handoff.

Read [`AGENTS.md`](../../../AGENTS.md) "Working mode" first. The exhaustive standard applies to the
review: enumerate before you conclude, verify against source with `file:line`, and never report a
check as passing that you did not run.

## The one rule that matters most: verify, do not trust `notes.md`

`notes.md` is a claim, not evidence. Read it to learn where to look, then prove or break every
load-bearing claim yourself. In #37 the notes stated "Full §10 gate green twice" and the gate was
**red** — `check:docs` failed on a broken link that `notes.md` itself had introduced after the last
gate run. The claim was sincere and stale, which is the normal case.

Concretely:

1. **Re-run the full §10 gate yourself.** Every leg, on the tree as committed. Never accept a leg
   from the notes.
2. **Capture the chain's exit code explicitly.** `(leg1 && leg2 && …) > log 2>&1; echo "EXIT=$?"`.
   A wrapper whose last statement is an `echo` reports success while the `&&` chain failed, and a
   background-task notification reports the wrapper's status, not the chain's. Grep the log for the
   failing leg rather than reading the summary line.
3. **A short-circuited chain leaves later legs unrun, not passing.** When leg 13 fails, leg 14 has no
   result. Run the remainder individually so your verdict covers all of them.
4. **Read the source diff, not the summary table.** `git show <sha> -- <paths>`. Cite `file:line` for
   every claim you make about the code.

## You review; you do not implement

Do not edit `src/`, tests, or docs to fix what you find. If you fix your own findings, nothing
independently confirms the fix, and the implementer loses the chance to disagree.

Two carve-outs, both temporary and both requiring a verified revert:

- **Mutation checks** (below) — break the implementation on purpose, observe, `git checkout --` it,
  then re-run the affected suite to prove the revert took.
- **Throwaway probes** under `src/` for a type or SDK question — delete before you report, and
  confirm `git status` is clean.

State in `review.md` that the tree is unchanged. If you did leave something modified, say so at the
top — a reviewer who silently mutates the tree costs the implementer a debugging session.

## Mutation-test the load-bearing tests yourself

Reading a test and concluding it *would* fail under a mutation is not the same as making it fail. The
implementer already recorded mutation checks; re-run the ones that pin the plan's top traps.

Pick the tests guarding the highest-ranked §4 traps, break the implementation the way the trap
describes, and confirm **the right test fails and only it**:

> #37 T3 (collection-group identity): replaced `this.toResult(doc)` with `{...data, id}` in
> `explain()`. Result: `1 failed, 12 passed` — U-4g alone. Precisely targeted, so the trap is
> genuinely pinned. Reverted; 13/13 green again.

"Only it" is the part worth the extra minute: a mutation that fails six tests tells you the suite is
coupled, not that the trap is guarded.

## Where a reviewer adds value beyond the checklist

Auditing the definition of done finds omissions. Finding **defects** means probing surfaces the plan
never named — the plan cannot warn about what its author did not consider. Ask:

- What **other class** could reach this code? (#37: does `explain()` leak out of a transaction? →
  `QueryBuilder.ts` has zero transaction references, so no. Clean, and worth the two minutes.)
- Does a new guard/branch have any **reachable** configuration? A guard no supported version can hit
  is defensible, but say so rather than counting it as coverage.
- Does an added check actually **assert** what it appears to? (#37: the packed-consumer addition
  asserts mutual assignability of the root and `/vector` types, so a future divergence fails that
  leg — stronger than the bare import it looked like.)
- Where the implementer **deviated from the plan**, is the deviation right? Sometimes the plan is
  wrong and the deviation is the correct call — say so explicitly, so the next reviewer does not
  "fix" it back. (#37: the plan demanded a grep return empty; the one hit was inside a historical
  amendment blockquote that the bookkeeping rules forbid rewriting. The implementer was right.)

## Findings: id, severity, evidence, and what closes it

Every finding needs a stable id so `notes.md` can carry a disposition against it, and enough for an
agent with none of your context to act:

| Field | Requirement |
| ----- | ----------- |
| **Id** | `B1`, `B2` … blocker · `M1` … major · `N1` … minor/nit. Stable across rounds — never renumber |
| **Severity** | Blocker = gate red, contract wrong, or a trap unguarded. Major = real defect, ships wrong behavior. Minor = accuracy, docs, consistency. Nit = taste |
| **Location** | `file:line` for every claim |
| **Evidence** | The command you ran and its actual output, or the diff you read. No finding on reasoning alone |
| **Failure scenario** | Concrete inputs/state → wrong output. If you cannot write one, it is a nit, not a defect |
| **What closes it** | The smallest change that resolves it — not a redesign |

Rank blockers first. **Say what you verified and it held**, too: a review that lists only problems
gives the implementer no way to know which surfaces are settled, and they will re-check them.

## Verdict — one of three

End with exactly one, and name what closes the gap:

- **BLOCKED** — the gate is red, or a blocker has no agreed fix.
- **APPROVE WITH FIXES** — everything substantive is verified; named fixes remain, each small and
  independent. Say which, and what to re-run after.
- **APPROVE** — gate green on the tree as committed, definition of done audited against source.

"Approve pending a one-line link fix, then re-run `check:docs` and `docs:build`" is a good verdict.
"Looks good overall" is not a verdict.

## The round trip

1. You write `review.md` and say what you ran. You do **not** commit it unless asked — say it is
   there and let the owner decide.
2. The implementer (`plan-execution`) dispositions **every id** in `notes.md`: **fixed** (say how),
   **not a defect** (say why, with evidence), or **deferred** (open an issue and link it). An
   undisposed finding makes the round trip unfalsifiable.
3. They re-run the full gate after remediation — fixing one finding can break another.
4. Your second pass reviews the **deltas plus a fresh full gate run**, not the whole diff again.
   Append a new round to `review.md`; do not rewrite round 1, and do not renumber ids.
5. Do not re-litigate a disposed finding without new evidence. If you disagree with a "not a defect",
   say why with something you executed.
6. The loop ends at **APPROVE**. Then the plan directory is removed in a final cleanup commit and the
   PR merges (`docs/plans/README.md` lifecycle).

## Before you send it

- [ ] Full gate re-run **by you**, chain exit code checked, every leg accounted for including any the
      chain short-circuited past
- [ ] Suite counts compared against the plan's baseline — both must have gone up
- [ ] Coverage gates read from the run's own output, not the notes
- [ ] Load-bearing mutation checks re-run by you, with the revert verified
- [ ] Every finding has `file:line`, executed evidence, and a failure scenario
- [ ] At least one surface probed that the plan never named
- [ ] Deviations from the plan each judged right or wrong, explicitly
- [ ] What you verified **and it held** is listed, not just the problems
- [ ] One of the three verdicts, with what closes the gap
- [ ] `git status` clean — mutations and probes reverted, and the revert re-verified

Skeleton: [`review-template.md`](review-template.md).

## Lifecycle

`review.md` is branch-scoped and dies with the plan directory. Anything durable goes somewhere that
survives: a contract decision to the ADR, a deferred defect to its own issue, a recurring process
gap to the skill that should have caught it. A finding that only exists in a deleted file was not
worth writing down.
