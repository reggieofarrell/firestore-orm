---
root: true
# The root project memory is generated only to AGENTS.md, which Cursor and Codex read natively.
# Claude Code does NOT read AGENTS.md, so CLAUDE.md is a committed symlink to AGENTS.md (repo root).
# Neither tool needs the root re-emitted as a scoped rule, so this rule targets the AGENTS.md family
# only; scoped rules still target Cursor and Claude.
targets:
  - agentsmd
  - codexcli
description: firestore-orm project overview, working mode, project rules, and environment/tooling notes
---

# firestore-orm — project instructions

Canonical, always-loaded project memory. Authored once in `.rulesync/rules/overview.md` and
generated to the root `AGENTS.md`, which Cursor and Codex read natively. **Claude Code does not read
`AGENTS.md`**, so `CLAUDE.md` is a symlink to `AGENTS.md` at the repo root — one content file, read by
every tool. `@reggieofarrell/firestore-orm` is a **TypeScript library** (published to npm) — a
type-safe Firestore ORM for the Firebase Admin SDK. There is no long-running application server;
"running it" means building the library and exercising it against the local **Firestore emulator**.
See also `README.md` and `docs/development/testing.md`.

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

All agent config — **rules, commands, and skills** — is authored **once** under `.rulesync/` and
generated to every tool with `npm run rules:sync` (rulesync): Cursor (`.cursor/`), Claude Code
(`.claude/`), and the cross-tool `AGENTS.md` standard (root `AGENTS.md` + `.agents/`, read by Codex
and others).

**Never create or edit agent config in a generated location** (`.cursor/`, `.claude/`, `.agents/`,
or the root `AGENTS.md`/`CLAUDE.md`) — those are overwritten by the next `npm run rules:sync`, and
`npm run rules:check` (pre-push + CI) fails on drift. To add or change config, edit the `.rulesync/`
source and run `npm run rules:sync`, then commit the source **and** the regenerated files:

- **Rule** → `.rulesync/rules/<name>.md` (frontmatter `targets`, `description`; add `globs` to scope
  it to file patterns, or omit for always-on).
- **Command** → `.rulesync/commands/<name>.md`.
- **Skill** → create the directory `.rulesync/skills/<skill-name>/SKILL.md` (frontmatter `name`,
  `description`, `targets: ["*"]`), and put any extra skill files (templates, scripts) **alongside
  `SKILL.md` in that same directory**. Do not create skills under `.cursor/skills`, `.claude/skills`,
  or `.agents/skills` — those are generated.

For the complete set of frontmatter fields and generation options (`root`, `targets`, `globs`/`paths`,
per-tool override blocks like `cursor:`/`claudecode:`, and the rule/command/skill/MCP file formats),
see the **rulesync docs**: <https://github.com/dyoshikawa/rulesync> — specifically its "Each File
Format" and configuration sections. The version in use is pinned in `package.json` (`devDependencies`).

Scoped rules currently defined:

- **test-awareness** — always-on
- **test-guardrails** — active for test files (`src/tests/**/*.test.ts`)
- **testing-docs-sync** — active for test infrastructure (jest configs, coverage-gate script, husky
  hooks, shared mocks/factories, integration helpers)
- **docs-api-sync** — active for the public API surface (`src/index.ts`, `src/core/**`,
  `src/vector/**`); keep README + examples in sync when the exported contract changes
- **rulesync-generated** — guardrail that fires when a generated agent-config file is opened

## Tooling

- **Skills & commands:** authored in `.rulesync/skills/*/SKILL.md` and `.rulesync/commands/*.md`;
  `npm run rules:sync` generates them for every tool (Cursor, Claude Code, and the AGENTS.md family
  under `.agents/`). Edit the `.rulesync/` source, never the generated files.
- **Architecture decisions:** record significant/contract-level changes as an ADR in `docs/adr/`
  (use the `/adr` skill; start from `docs/adr/0000-template.md`).
- **Commits:** Conventional Commits (enforced by commitlint on the `commit-msg` hook).
- **Tests:** `npm test` (unit + emulator integration); dual per-suite coverage gates.

## Cursor Cloud specific instructions

These are non-obvious environment caveats for this repo. The startup update script already runs
`npm install`; everything below is about _running_ the toolchain, not installing it.

### Node version — must be 24, and a shim shadows it

- The repo pins **Node 24** (`.nvmrc`) and the Husky hooks (`pre-commit`, `pre-push`, `commit-msg`)
  hard-fail on any other major via `scripts/check-node-version.sh`. CI uses the same pin.
- Node 24 is installed via `nvm`, **but `/exec-daemon/node` (Node 22) is earlier in `PATH` and wins
  by default**, so a bare `node` reports v22 and would break commits/pushes. `nvm use` does **not**
  fix this (the shim is re-prepended each shell).
- Before running git commits/pushes, the coverage gates, or anything that must match CI, prepend the
  nvm Node 24 bin to `PATH` in that shell:

  ```bash
  export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"
  node --version   # v24.x
  ```

  (Everyday build/lint/unit-test commands also run fine under the default Node 22, since
  `engines.node` is `>=22`; Node 24 is what the git hooks and CI require.)

### Firestore emulator (integration tests)

- Java (JDK 21) is already available, which the Firestore emulator requires.
- `npm run test:integration:emulator` (and `test:integration:coverage`) auto-start/stop the emulator
  via `firebase emulators:exec` — no separate emulator process or Firebase login/credentials needed
  (it uses the demo project `demo-firestoreorm-test` on `127.0.0.1:8080`).
- Repeated `MetadataLookupWarning: ... code = UNKNOWN` lines during integration runs are
  **harmless** — the Admin SDK probing the (absent) GCE metadata server while in emulator mode.
- `npm run test:unit` uses mocks only: no Java or emulator required.

### Verifying the environment end-to-end

Full gate matches CI: `npm run lint`, `npm run check:format`, `npm run test:types`, `npm run build`,
`npm run test:unit`, and `npm run test:integration:emulator` all pass. The library itself is
exercised through the emulator-backed integration suite (create/read/query/update/hooks against real
Firestore).
