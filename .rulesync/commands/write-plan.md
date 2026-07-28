---
targets:
  - '*'
---

# Write Plan

Write an evidence-backed implementation plan for an issue into `docs/plans/issue-NN-<slug>/`, for an
implementer who will not have your context — a teammate, a later session, or a Cursor Cloud Agent on
a fresh clone.

**Follow the `implementation-planning` skill** — it owns the §0–§12 section contract, the evidence
rules, the probe-vs-prototype cost model, and the docs/ADR bookkeeping map. This command is the entry
point and the sequence; the skill is the standard.

Argument: the issue number (e.g. `/write-plan 38`). If none is given, ask which issue.

## Use this command when

The plan must **cross a context boundary**. If you are planning a change you will implement yourself
in this same session, do not use this — plan mode is enough. The committed directory, preserved probes
and `notes.md` exist to survive a handoff, and without one they are ceremony. Borrow the skill's §9
bookkeeping map and §10 gate anyway.

## Steps

1. **Read the issue** (`gh issue view NN`) and record its labels — they decide the §9 ADR bookkeeping.
   Capture any acceptance criteria verbatim.
2. **Establish the baseline:** `git log -1 --oneline`. The plan is only valid against that sha.
3. **Re-enumerate the affected sites from the current tree.** Never trust the issue's file or line
   list — it rots. Note in §2 where the issue is stale.
4. **Probe** what you cannot read: emulator behavior, SDK semantics, what `tsc` actually resolves.
   Sort each probe by whether it asserts (promote to a committed test) or asks (keep in `probes/`).
5. **Prototype only if it pays** — see the skill's decision table. Scope it to the unknown, not the
   change, and revert it.
6. **Put open forks to the owner with evidence** before writing §1. §1 is for settled decisions.
7. **Write the plan** from the skill's `plan-template.md`, into
   `docs/plans/issue-NN-<slug>/PLAN.md`.
8. **Compile every §6 block as written — not optional.** Paste each block into a scratch file under
   `src/`, run `npm run test:types`, delete the file. Exact module specifiers included: "the symbol
   exists in some `.d.ts`" is a different claim from "this `import` resolves." If a new type is
   public, also run `tsc --declaration --emitDeclarationOnly` and confirm the emitted `.d.ts` names
   no undeclared package. Record it in §12. Skipping a **full prototype** is a judgement call;
   skipping **this** is not — it is the check whose absence has cost a review cycle.
9. **Enumerate the §9 bookkeeping by file and line** — new ADR, ADR-0017 amendment if the issue is in
   the parity/`v3.x` set, living-index footers, `docs/adr/README.md` row, capability matrix, Starlight
   pages, READMEs. Silent omissions here are this repo's main defect mode. **Run every grep and every
   command you write into the plan**, and record the expected result — a sweep pattern that matches
   nothing reads as "already done."
10. **Cut and push the branch with the plan on it**, so the implementer arrives to find it. Tell them
    in §7 step 1 to check it out and rebase rather than cut a new one.
11. **Self-review before handing off** — the skill's "Before you hand it off" list in full. Beyond
    every §3 row executed, every `file:line` re-checked and §11 mapping 1:1 onto §§1–10: §12 filled
    in, every trap walked from §4 → §8 (at each site it can occur, with the observable named), every
    conditional resolved, and the adversarial question — what surface did I miss? The usual misses
    are `src/vector/**` (including its subpath re-exports), `CollectionGroup.ts`, the read-only
    transaction surface, the express adapter, the `.d.ts` shape, and the living-index footers.

## Then

Hand off with `implement-plan` (or point a cloud agent at the branch). The implementer follows the
`plan-execution` skill and writes `notes.md` back on the same branch.
