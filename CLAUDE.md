# firestore-orm — Claude Code project instructions

Auto-loaded every session (canonical project memory).

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
