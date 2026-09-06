---
root: false
targets:
  - '*'
description: >-
  Preserve the repository's Husky, commitlint, lint-staged, and SonarQube
  quality gates when changing code or development tooling
# No `globs` on purpose. Omitting them keeps the rule unconditional for Claude
# Code; `cursor.alwaysApply` covers Cursor.
cursor:
  alwaysApply: true
  description: >-
    Preserve the repository's Husky, commitlint, lint-staged, and SonarQube
    quality gates when changing code or development tooling
---

# Repository quality gates

Use Conventional Commit messages (`feat:`, `fix:`, `docs:`, `refactor:`,
`test:`, `chore:`, and related conventional types). Commitlint checks each
local message.

Husky hooks are part of the repository contract. Do not bypass them merely to
make a commit or push complete. Diagnose a failing gate, fix the underlying
problem, and rerun it. A deliberate emergency bypass is an accountable human
decision, not a routine agent shortcut.

Run `npm run release:verify` before handing off a change that should match CI
(format, lint, shared Sonar baseline, RuleSync, types, manifest, audit, build,
package, consumer, dual coverage gates, docs, zod idioms, website build).
Everyday pre-push still runs the lighter unit-coverage gate without the
emulator.

- Dual path-specific coverage thresholds are ratchets. Never lower them merely
  to make a change pass; add meaningful coverage or document an intentional
  review. Merged LCOV is not a gate.
- SonarQube secret scans are fail-closed. A finding or scanner failure blocks
  the Git operation. The server-backed pre-push check may skip only when its
  explicit status says prerequisites are unavailable; findings and analysis
  failures still block.
- Preserve the pre-commit, pre-push, and CI gates when changing quality tooling.
  Do not narrow their coverage or downgrade blocking checks to warnings.

Never put Sonar tokens in source files, committed environment files, command
arguments, or logs. Follow `docs/development/sonarqube.md` for scanner setup,
rule synchronization, CI implementation, and re-scan procedures.
