<!--
Skeleton for docs/plans/issue-NN-<slug>/notes.md — see SKILL.md (plan-execution) for the rules.
Write sections as you go, not at the end. Delete bracketed prompts. Keep a section even when the
answer is "nothing to report" — an absent section reads as an omission.
-->

# Issue #NN — Implementation notes (for adversarial review)

**Implementer:** [agent/person + model] · **Branch:** `<branch>` · **Plan:**
`docs/plans/issue-NN-<slug>/PLAN.md` · **Baseline:** `main` @ `<sha>` [if you rebased, say from what
to what, and whether §3 line numbers drifted]

## Status

[Done / done-pending-review / blocked. One paragraph: what shipped, what did not, and why.]

## Ambiguities resolved

[Every place the plan left a real choice, what you chose, and the reason. If you had to decide
something §1 did not settle, flag it explicitly — the reviewer needs to know it was yours.]

## Deviations from the plan

[Numbered. Each: what the plan said, what you did instead, why, and what would have gone wrong
otherwise. This is the section the reviewer reads most carefully. "None" is an acceptable answer only
if it is true.]

1.

## Files touched and why

| File | Change | Plan reference |
| ---- | ------ | -------------- |

## Edge cases / traps handled

[One row per §4 trap: how the implementation avoids it, and which test pins it.]

| Trap | Handled by | Pinned by |
| ---- | ---------- | --------- |

## Tests added

| Id | Suite | Asserts | Guards |
| -- | ----- | ------- | ------ |

## Mutation checks

[Revert the fix, confirm the test fails, restore. A test that passes both ways guards nothing.]

| Test | Mutation | Result |
| ---- | -------- | ------ |
|      |          | **Fails** — [the actual error] |

## Gate results

[Every leg, with real output. Report failures. State suite counts before → after.]

```
npm run test:types                         [✓ / ✗ + output]
npm run lint                               
npm run check:format                       
npm run test:unit                          [N suites / N tests  (was N / N)]
npm run test:integration:emulator          [N suites / N tests  (was N / N)]
npm run test:unit:coverage + gate:unit     
npm run test:integration:coverage + gate   
npm run build                              
npm run check:package                      
npm run check:consumer                     [which peer leg ran locally]
npm run check:docs                         
npm run docs:build                         [grepped built HTML for leaked `:::`]
```

## Anti-instructions checklist

[One row per §7 anti-instruction, confirmed not violated.]

| Anti-instruction | Confirmed |
| ---------------- | --------- |

## §11 audit

[Every definition-of-done row, verified against source rather than memory, with the file that proves
it.]

| §11 item | Result | Evidence |
| -------- | ------ | -------- |

## Independent adversarial review

**Reviewer:** [fresh session / subagent + model] · **Reviewed:** `<commit>` · **Fixes in:**
`<commit>` · **Verdict:** [pass / pass with fixes / needs work]

[What it was given — diff, plan, tests, and **not** these notes. What it was asked to do: refute.]

### Findings fixed

1. **[Fn severity — title]** — [the defect, and the fix.]

### Findings not treated as defects

- **[Fn]** — [why it is not a defect.]

### Findings deferred

- **[Fn]** — [why, and the issue opened for it.]

### Gate re-run after fixes

[All legs, again. Fixing findings can break something else.]

## Could-not-verify

[Carried from plan §5, plus anything new. What you reasoned about rather than ran; which CI legs are
still owed. Be honest — this is the section that protects the reviewer from your blind spots.]

## Open questions for the reviewer

[Anything you want a second opinion on. Empty is fine.]
