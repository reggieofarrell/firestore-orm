---
targets:
  - '*'
---

# Write Review

Review a plan-backed implementation on a local branch and write the findings to
`docs/plans/issue-NN-<slug>/review.md`, so the implementer — usually a different agent in a different
session — can act on them without your context.

**Follow the `implementation-review` skill** — it owns the verify-don't-trust rule, the mutation-check
obligation, the finding shape, the three verdicts, and the round-trip protocol. This command is the
entry point and the sequence; the skill is the standard.

Argument: the issue number (e.g. `/write-review 37`). If none is given, infer it from the branch and
say which you picked.

## Use this command when

An agent or teammate says a plan-backed issue is **ready for review** and the work is a local branch
or an unpushed commit. Not for a GitHub pull request — use the built-in review flow there. Not for
reviewing the **plan** before implementation (that is `plan-review.md`, via `write-plan`). Not for
reviewing your own implementation — that is the `plan-execution` refute-first self-review, which
stays in chat and dispositions into `notes.md`.

## Steps

1. **Locate the work.** `git log --oneline main..HEAD`, `git status -sb`, and check for a PR. Say
   plainly whether the implementation is committed, unpushed, or absent — do not assume "ready for
   review" means pushed.
2. **Check the base.** If `main` has moved past the branch's merge-base, note it: a rebase may be
   owed, and the plan's §3 line numbers may have drifted.
3. **Read `notes.md` for orientation, then set it aside.** It tells you where to look. It is not
   evidence.
4. **Start the full §10 gate early** — it is the long pole; read the diff while it runs. Capture the
   chain's exit code explicitly (`; echo "EXIT=$?"`), and grep the log for the failing leg rather than
   trusting a summary or a task notification.
5. **Read every source diff** (`git show <sha> -- <paths>`) against the plan's §6, §1 decisions, and
   §7 anti-instructions. Cite `file:line`.
6. **Mutation-check the load-bearing tests yourself** — the ones pinning the plan's top-ranked traps.
   Confirm the right test fails **and only it**, then revert and prove the revert took.
7. **Probe at least one surface the plan never named.** Auditing the definition of done finds
   omissions; probing unnamed surfaces is what finds defects.
8. **Account for every gate leg**, including any the chain short-circuited past — run those
   individually so the verdict covers all fourteen.
9. **Write `review.md`** from the skill's `review-template.md`. Findings ranked blockers-first with
   ids, `file:line`, executed evidence, and what closes each. Include what you verified **and it
   held**, and judge each deviation from the plan right or wrong.
10. **End on one of the three verdicts**, naming what closes the gap. Report it in chat too, but the
    file is the artifact the implementer acts on.
11. **Do not commit it unless asked**, and do not fix your own findings — leave `src/` untouched and
    `git status` clean.

## Then

The implementer picks it up under `plan-execution`: every finding id dispositioned in `notes.md`
(fixed / not a defect / deferred + issue), then a full gate re-run. Your next round reviews the
deltas plus a fresh gate run — append to `review.md`, never renumber.
