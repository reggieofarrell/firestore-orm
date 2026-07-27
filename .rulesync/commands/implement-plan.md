---
targets:
  - '*'
---

# Implement Plan

Execute an existing plan from `docs/plans/issue-NN-<slug>/`, keeping `notes.md` as you go, and pass
your own independent adversarial review before declaring the work ready.

**Follow the `plan-execution` skill** — it owns the notes contract, the mutation-check discipline, and
the refute-first self-review protocol. This command is the entry point and the sequence; the skill is
the standard.

Argument: the issue number or plan path (e.g. `/implement-plan 38`). If none is given, list
`docs/plans/` and ask which.

## Use this command when

You have been handed a committed plan. If you and the user just produced a plan in this session and
you are implementing it directly, you do not need this — but the skill's gate, mutation checks and
§9 bookkeeping rules still apply.

## Steps

1. **Read `PLAN.md` end to end** before editing. §1 is settled — do not re-litigate. §4 traps are the
   failures you will otherwise walk into. §7 anti-instructions are binding.
2. **Check out the branch** from the plan header — it exists and carries the plan. Do not cut a new
   one. If `main` moved past the baseline sha, rebase and **re-verify §3's line numbers first**.
3. **Re-run the probes** in `probes/` for any §3 row you doubt. §3 outranks the issue body.
4. **Implement in §7's order** — where it says order matters, it matters. Record every deviation in
   `notes.md` at the moment you decide it, not afterwards.
5. **Write the tests from §8**, then **mutation-check the load-bearing ones**: revert the fix, confirm
   the test fails, restore. Record test / mutation / observed failure.
6. **Do the §9 bookkeeping**, reading current values out of the tree rather than copying them from the
   plan — claim the next free ADR number, and grep the live `(#N–#41)` range rather than trusting a
   file list.
7. **Run the full §10 gate** and report real output. Suite counts must move as predicted. After
   `docs:build`, grep the built HTML for a leaked literal `:::`.
8. **Independent adversarial self-review** — fresh context, prompted to refute. Hand it the diff, the
   plan and the tests, **not** your notes. Give every finding an id, a severity and a disposition
   (fixed / not a defect / deferred with an issue).
9. **Re-run the full gate after those fixes**, and report both runs.
10. **Audit §11 against source**, one row per item with the file that proves it.

## Then

Report ready for external review. Leave the plan directory in place — its removal is a separate
cleanup commit after review, so the reviewer can read the plan and `notes.md` in the PR diff. Do not
commit unless asked; report the §10 Conventional Commits subject.
