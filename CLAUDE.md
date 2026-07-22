# firestore-orm — Claude Code project instructions

Auto-loaded every session (canonical project memory).

## Working mode: be exhaustively thorough (default)

Thoroughness is the default for this project, not something to switch on. Optimize for the most
correct, complete result — never the fastest. Concretely:

- **Enumerate before you edit.** When a change touches a contract (types, generics, hook events,
  validation, the public API), find **every** affected site first and fix them all — not the
  representative case. Partial sweeps (fixing the core but missing a consumer like the vector
  wrapper, or one hook event but not its siblings) are the main defect mode here; a single
  generic/type change usually has many downstream sites.
- **Verify against the source, not your memory or a prior claim.** Confirm each claim by reading the
  actual code and citing `file:line`. For non-trivial reviews/audits/migrations, fan out with the
  Workflow tool (one investigator per finding, adversarial "refute-first" verification) before
  implementing.
- **Never claim something is done/green that you did not run.** No "the gate passes" without
  executing it; no "X is normalized" without a test that fails if it regresses. Re-run the
  reviewer's own probes yourself as real tests.
- **Full gate every time.** `test:types`, `test:unit`, `test:integration:emulator`, both coverage
  gates, `build`, `check:package`, `lint`, `prettier --check`, `check:docs` — plus a targeted
  regression test for every finding/change. Report failures honestly with the output.
- **Adversarially self-review before declaring complete.** Ask "what surface did I miss, what did I
  claim without checking, what edge case breaks this?" and close those gaps.

This applies even when the user's phrasing is brief — assume the exhaustive standard unless they
explicitly scope it down.

## Project rules

Rules live in [`.claude/rules/`](.claude/rules/) for Claude Code and `.cursor/rules/*.mdc` for
Cursor. Claude Code does **not** expand `@import` inside rule files, so each Claude rule carries its
body inline with `paths:` scoping (Cursor uses `globs:`) — keep the two copies in sync when a rule
changes (see the [memory docs](https://code.claude.com/docs/en/memory)):

- **test-awareness** — always-on (no `paths:`)
- **test-guardrails** — active for test files (`src/tests/**/*.test.ts`)
- **testing-docs-sync** — active for test infrastructure (jest configs, coverage-gate script, husky
  hooks, shared mocks/factories, integration helpers)
- **docs-api-sync** — active for the public API surface (`src/index.ts`, `src/core/**`,
  `src/vector/**`); keep README + examples in sync when the exported contract changes

## Tooling

- **Skills & commands:** [`.claude/skills/`](.claude/skills/) and
  [`.claude/commands/`](.claude/commands/) are symlinked to `.cursor/` (single source of truth).
- **Architecture decisions:** record significant/contract-level changes as an ADR in
  [`docs/adr/`](docs/adr/) (use the `/adr` skill; start from `docs/adr/0000-template.md`).
- **Commits:** Conventional Commits (enforced by commitlint on the `commit-msg` hook).
- **Tests:** `npm test` (unit + emulator integration); dual per-suite coverage gates.
