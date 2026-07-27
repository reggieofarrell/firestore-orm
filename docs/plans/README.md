# Implementation plans

Working plans for in-flight issues. A plan is a **handoff contract**: an evidence-backed spec that
an implementer — a teammate, a local agent, or a Cursor Cloud Agent — can execute end-to-end without
any of the investigation that produced it.

Write one with the **`implementation-planning` skill**
([`.rulesync/skills/implementation-planning/SKILL.md`](../../.rulesync/skills/implementation-planning/SKILL.md)
— the authored source; the generated copies under `.cursor/`, `.claude/` and `.agents/` are what
tools load). The skill owns the section contract, the evidence rules, and the docs/ADR bookkeeping
map; this file only covers where things live and how long they live.

## Layout — one directory per issue

```
docs/plans/issue-NN-<kebab-slug>/
  PLAN.md          the plan itself (§0–§11)
  probes/          investigation scripts, re-runnable
  prototype.patch  optional: the reverted prototype diff, so §6 can be copy-verbatim
  notes.md         the implementer writes this back: deviations, unverified items, self-review
```

One directory so the unit of deletion equals the unit of work — `git rm -r docs/plans/issue-NN-*/`
cannot be half-done. Scattering the plan, its probes and its notes across sibling trees is how a
cleanup gets partially swept.

## Lifecycle — branch-scoped, removed before merge

1. The plan is written, committed, and the branch **pushed before the implementer starts** — so a
   cloud agent, which only ever sees committed content, arrives to find the plan and probes already
   there. Its first step is to check the branch out and rebase if `main` moved, never to cut one.
2. The implementer adds `notes.md` on the same branch, so the handoff works in both directions.
3. **Review while the directory is still present** — that is when `notes.md` and the plan are
   visible in the PR's Files-changed view.
4. **A final cleanup commit removes the directory**, then merge. Because the whole directory is
   added and deleted on the same branch, it nets to zero in the merged diff and never reaches `main`
   — but that also means it disappears from Files-changed, which is why the review happens first.
   This is a line item in the plan's own §11 definition of done.

`main` carries only this README.

A plan is pinned to a baseline: its §3 states the sha it was verified against, and its site
enumeration is wrong the moment the PR lands. Keeping merged plans would manufacture a shelf of
stale documents that read as authoritative — the same hazard the skill warns about for stale issue
bodies.

The durable record is the **ADR** ([`docs/adr/`](../adr/), via the `adr` skill). A plan's
`§1 Owner-approved decisions` table is the raw material for the ADR's _Decision_ and _Alternatives
considered_, so the reasoning survives where it belongs.

## Probes: promote the ones that assert, discard the ones that ask

- **Assertion probes** encode what the fix must make true (e.g. "27 diagnostics before, 0 after").
  **Promote these to committed tests** under `src/tests/types/*.type-test.ts` or the
  unit/integration suites. They become permanent regression guards that CI runs — do not leave them
  here to be deleted.
- **Investigation probes** ask one question about what the Admin SDK, the emulator, or `tsc`
  actually does. There is no assertion to keep; they are evidence for §3. These live in `probes/`
  and die with the plan.

## Tooling

Verified against a real plan and real probes in this tree:

| Check           | Behavior                                                                                                                   |
| --------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `test:types`    | Never sees this tree — `tsconfig` is `include: ["src/**/*"]`, so a probe with deliberate type errors cannot break the gate |
| `check:docs`    | Scans `PLAN.md` and passes; informal `file:line` prose is not link syntax                                                  |
| `lint`          | `docs/plans/**` is in `eslint.config.js` `ignores` — `.mjs` runners would otherwise fail `no-undef` on Node globals        |
| `check:format`  | `docs/plans/*/**` is in `.prettierignore`; this README stays formatted                                                     |
| `check:package` | Unaffected — `files` in `package.json` is an allowlist (`dist/**/*` + 4 files), so nothing here is ever published          |
