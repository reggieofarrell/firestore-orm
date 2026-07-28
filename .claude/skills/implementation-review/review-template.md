<!--
Skeleton for docs/plans/issue-NN-<kebab-slug>/review.md — see SKILL.md for the rules behind each
section. Written by the EXTERNAL reviewer; the implementer dispositions every finding id in
notes.md and never edits this file.
Delete every bracketed prompt. Append later rounds; never rewrite an earlier round or renumber ids.
-->

# Issue #NN — implementation review

**Reviewer:** [agent/person + model] · **Round:** 1 · **Reviewed:** `<sha>` (`<subject>`) ·
**Branch:** `<branch>` · **Plan:** `PLAN.md` @ baseline `<sha>` · **Tree:** unchanged by this review
[or: name exactly what is still modified]

**Verdict: [BLOCKED / APPROVE WITH FIXES / APPROVE]** — [what closes the gap, in one sentence.]

---

## What I ran

Every claim below traces to a row here. Legs a short-circuited chain skipped are listed as run
separately or as **not run**.

| Check | Command | Result |
| ----- | ------- | ------ |
| Full §10 gate | `(…) > log 2>&1; echo EXIT=$?` | `EXIT=N` — leg-by-leg below |
| [failing leg, if any] | | actual output |
| [legs the chain skipped] | run individually | |
| Suite counts | both suites | unit `N/M` (baseline `N/M`) · integration `N/M` (baseline `N/M`) |
| Coverage gates | from the run's own output | per-gate figures vs threshold |
| Mutation check | [trap id]: [what was broken] | [which test failed, and that only it did] |
| Revert verified | `git checkout --` + re-run suite | clean / green |
| [surface probed that the plan never named] | | |

---

## Blockers

### B1 — [one-line claim] (`file:line`)

[Evidence: the command and its actual output, or the diff read.]

**Failure scenario:** [concrete inputs/state → wrong result.]

**What closes it:** [smallest change.]

---

## Major

### M1 — [claim] (`file:line`)

[Same shape.]

---

## Minor / nits

- **N1** — [claim] (`file:line`). [What closes it.]

---

## Verified and holding

[Not optional. Without this the implementer re-checks what is already settled.]

- [Surface] — [how it was verified, `file:line` or command.]
- **Deviations from the plan:** [each one judged right or wrong, explicitly, so the next reviewer does
  not reverse a correct call.]

---

## Not defects

- [Something that looks wrong and is not, with why — so it does not get "fixed".]

---

## Round 2+ [append; do not rewrite round 1]

**Reviewed:** `<sha>` · **Dispositions checked against `notes.md`:** [ids]

| Finding | Implementer disposition | Reviewer check |
| ------- | ----------------------- | -------------- |
| B1 | fixed / not a defect / deferred → #NN | confirmed / disputed (with new evidence) |

**Fresh gate run:** [EXIT + counts.]

**Verdict: […]**
