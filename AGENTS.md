# FlintFire — project instructions

Canonical, always-loaded project memory. Authored once in `.rulesync/rules/overview.md` and
generated to the root `AGENTS.md` (read natively by Cursor and Codex) and to `CLAUDE.md` (**Claude
Code does not read `AGENTS.md`**). Both are generated files — edit the source, never these.
`flintfire` is a **TypeScript library** (published to npm) — a
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
  gates, `build`, `check:package`, `lint`, `prettier --check`, `check:docs`, `check:zod-idioms` —
  plus a targeted regression test for every finding/change. Report failures honestly with the
  output.
- **Adversarially self-review before declaring complete.** Ask "what surface did I miss, what did I
  claim without checking, what edge case breaks this?" and close those gaps.

This applies even when the user's phrasing is brief — assume the exhaustive standard unless they
explicitly scope it down.

## Project rules

All agent config — **rules and skills** — is authored **once** under `.rulesync/` and
generated to every tool with `npm run rules:sync` (rulesync): Cursor (`.cursor/`), Claude Code
(`.claude/`), and the cross-tool `AGENTS.md` standard (root `AGENTS.md` + `.agents/`, read by Codex
and others).

**Never create or edit agent config in a generated location** (`.cursor/`, `.claude/`, `.agents/`,
or the root `AGENTS.md`/`CLAUDE.md`) — those are overwritten by the next `npm run rules:sync`, and
`npm run rules:check` (pre-push + CI) fails on drift. To add or change config, edit the `.rulesync/`
source and run `npm run rules:sync`, then commit the source **and** the regenerated files:

- **Rule** → `.rulesync/rules/<name>.md` (frontmatter `targets`, `description`; add `globs` to scope
  it to file patterns, or omit for always-on).
- **Skill** → create the directory `.rulesync/skills/<skill-name>/SKILL.md` (frontmatter `name`,
  `description`, `targets: ["*"]`), and put any extra skill files (templates, scripts) **alongside
  `SKILL.md` in that same directory**. Do not create skills under `.cursor/skills`, `.claude/skills`,
  or `.agents/skills` — those are generated.

For the complete set of frontmatter fields and generation options (`root`, `targets`, `globs`/`paths`,
per-tool override blocks like `cursor:`/`claudecode:`, and the rule/skill/MCP file formats),
see the **rulesync docs**: <https://github.com/dyoshikawa/rulesync> — specifically its "Each File
Format" and configuration sections. The version in use is pinned in `package.json` (`devDependencies`).

Scoped rules currently defined:

- **quality-gates** — always-on; Husky, commitlint, dual coverage ratchets, fail-closed
  local SonarJS, fail-closed secret scans
- **test-awareness** — always-on
- **test-guardrails** — active for test files (`src/tests/**/*.test.ts`)
- **testing-docs-sync** — active for test infrastructure (jest configs, coverage-gate script, husky
  hooks, shared mocks/factories, integration helpers)
- **docs-api-sync** — active for the public API surface (`src/index.ts`, `src/core/**`,
  `src/vector/**`); keep README + examples in sync when the exported contract changes
- **rulesync-generated** — guardrail that fires when a generated agent-config file is opened

## Tooling

- **Skills:** authored in `.rulesync/skills/*/SKILL.md`; `npm run rules:sync` generates them for
  every tool (Cursor, Claude Code, and the AGENTS.md family under `.agents/`). Agent workflows stay
  in skills instead of command aliases so Codex receives the same capabilities as Cursor and Claude.
  Edit the `.rulesync/` source, never the generated files. The rulesync **CLI**
  version is lockfile-pinned; a daily GitHub Action bumps it to the newest release that is at least
  two days old (`.npmrc` `min-release-age=2`) and, when generated files change, the Cursor Agent
  CLI (Grok 4.5) reviews the diff — see `docs/development/rulesync.md`. Do not float the CLI with
  `npx rulesync@latest`, and do not pass `--min-release-age=0` to bypass the cooldown.
- **Architecture decisions:** record significant/contract-level changes as an ADR in `docs/adr/`
  (use the `adr` skill; start from `docs/adr/0000-template.md`).
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

# Public API ↔ Docs Sync

When a change alters the **public API surface**, update the user-facing docs in the same PR. This
fires on the public source; only act when the *exported/observable contract* actually changes (not
internal refactors).

Triggers:

- Added / removed / renamed exports in `src/index.ts` (or the `./vector` entry)
- Changed method signatures, options, or **return contracts** in `FirestoreRepository` / `QueryBuilder`
- New or changed validation combinators / `sentinelPolicy` / schema behavior in `Validation.ts`
- Vector API changes in `src/vector/**`

Then update:

1. **Starlight site (`website/src/content/docs/`)** — the single published source of truth for
   consumer docs (GitHub Pages); edit it directly. Prefer plain `.md` with Starlight YAML
   frontmatter (`title`, `description`); do not introduce `.mdx` unless a page truly needs custom
   components.
   - **Topic guides:** `website/src/content/docs/guides/*.md` — one page per topic (e.g.
     `api-reference.md`, `schema-validation.md`). Update method contracts, options, and examples;
     keep exported names and signatures accurate. Sidebar groups live in `website/astro.config.mjs`
     (Concepts / Operations / Reference / Integration / Guidance) — add a sidebar entry when you
     add a new guide page.
   - **Getting Started:** `website/src/content/docs/getting-started.md` — when install, peers, or
     the minimal create/query/update/delete walkthrough changes.
   - **Overview / home:** `overview.md` or `index.md` only when the TOC, hero CTAs, or “where to go
     next” links need to change.
2. **Dual READMEs** — follow the **`readme-sync` skill** (`.cursor/skills/readme-sync/SKILL.md`)
   when install, peer deps, quick-start, package pitch, migration notes, or docs/support links
   change. GitHub shows committed `README.md` (contributor); npm shows `npm-readme.md` staged at
   pack time. Contributor-only edits (testing, contributing, ADRs) do **not** require touching
   `npm-readme.md`.
3. **Examples** — fix snippets that would no longer type-check or run.
4. **ADR** — if it's a contract-level or architectural decision, record one in `docs/adr/`
   (use the `/adr` skill). ADRs and `docs/development/` stay in-repo Markdown; they are not
   published on the Starlight site. Do **not** link ADRs to the (mutable) usage docs — reference the
   source and other ADRs, and name a guide in plain text if needed.
5. Do **not** hand-edit `CHANGELOG.md` — it is generated from Conventional Commits; write a clear
   `feat:` / `fix:` / `feat!:` commit instead.

If you touched any doc links, run `npm run check:docs`. If you touched any Zod snippet, run
`npm run check:zod-idioms` — the `zod` peer range is `^4.0.0`, so docs must teach the top-level
formats (`z.email()`, `z.iso.datetime()`), never the `@deprecated` `z.string().<format>()` chain.
After non-trivial website content changes, smoke-test with `npm run docs:build` (forces
`NODE_ENV=production` so Pagefind search is included).

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

# Generated agent config — do not hand-edit

The files under `.cursor/`, `.claude/`, and `.agents/`, plus the root `AGENTS.md` and `CLAUDE.md`,
are **generated by rulesync** from the single source in `.rulesync/`. Editing them
directly is lost work: the next `npm run rules:sync` overwrites them, and `npm run rules:check`
(pre-push + CI) fails when they drift from the source.

To change a rule or skill, edit the source under `.rulesync/rules/` or `.rulesync/skills/` and run
`npm run rules:sync`. To add a **skill**, create
`.rulesync/skills/<skill-name>/SKILL.md` (with any extra files alongside it in that directory) —
never a tool-specific skills directory like `.cursor/skills` or `.claude/skills`.

For all frontmatter fields and options, see the rulesync docs:
<https://github.com/dyoshikawa/rulesync> (the "Each File Format" and configuration sections).

# Test Awareness

After completing implementation changes in Agent mode, remind the user that tests should be written
or updated for the changed files. Suggest the appropriate skill:

- **`src/utils/**`, `ErrorParser`, `ErrorHandler`, `Validation`** → unit-testing skill
- **`FirestoreRepository`, `QueryBuilder`, `CollectionGroup`, hooks, transactions** →
  integration-testing skill

**Integration tests are the primary confidence layer** for this database library — emulator-backed
reads/writes, batching, and hooks. Unit tests cover pure logic fast; they do not replace integration
coverage for ORM core paths.

**Runner:** Jest (not Vitest). See `docs/development/testing.md` for full policy.

When suggesting tests:

- Be specific about which files need coverage and which skill to use
- Mention which **coverage gate** owns the changed paths (unit vs integration)
- Do NOT auto-write tests without user approval unless explicitly asked
- If tests already exist, mention they may need updating
- Skip the reminder for trivial doc-only or config comment changes

## Coverage gate ownership

| Changed paths | Suite | Gate command |
| ------------- | ----- | ------------ |
| `src/utils/**`, `ErrorParser`, `ErrorHandler`, `Validation`, `index.ts` | Unit | `test:coverage:gate:unit` |
| `FirestoreRepository`, `QueryBuilder`, `CollectionGroup`, emulator validation paths | Integration | `test:coverage:gate:integration` |

Merged LCOV is not used as a gate — each suite enforces its own path-specific thresholds.

# Test Guardrails

- Mock at the **Firestore boundary** — use `createMockFirestoreDb()` from
  `src/tests/shared/mocks/firestore.mocks.ts` for unit tests
- Mock factories hold **`jest.fn()` spies** — never reimplement Firestore or ORM logic inside
  `jest.mock()` factories
- Import factories from **specific module paths** (no barrel re-exports):
  - `src/tests/shared/factories/user.factory.ts` — `createTestUserInput`, `createTestUser`
  - `src/tests/shared/factories/hookValidatedUser.factory.ts` — `createHookValidatedUserInput`
  - `src/tests/shared/factories/counters.ts` — `resetTestFactoryCounters`
- Use `createUserRepoHarness()` from `src/tests/integration/helpers/firestoreIntegrationHarness.ts`
  for emulator integration tests
- Call `resetTestFactoryCounters()` in `beforeEach` when factory ID order must be deterministic
- Add a **JSDoc header** to new test files describing strategy and verification points
- Prefer **behavior-focused** assertions on public API contracts, not private implementation details
- **Unit tests** for pure logic; **integration tests** for emulator-dependent repository/query behavior
- **Integration is the primary ORM safety net** — never treat unit mocks as sufficient for repository/query changes
- Each suite has **path-specific coverage gates** — see `scripts/check-coverage-gates.mjs` and
  `docs/development/testing.md`. Do not rely on merged LCOV or global suite % as a safety metric.

# Testing Documentation Sync

When you add, rename, move, or delete test infrastructure, update:

1. **`docs/development/testing.md`** — commands, layout, harness/factory paths, dual gate tables
2. **`docs/development/test-coverage-followups.md`** — remove covered items, add new gaps
3. **`scripts/check-coverage-gates.mjs`** — path matchers and thresholds when gate scope changes
4. **`.cursor/skills/unit-testing/SKILL.md`** and **`.cursor/skills/integration-testing/SKILL.md`** —
   gate ownership, changed-file routing, and suite workflows
5. **`.cursor/rules/test-awareness.mdc`** and **`.cursor/rules/test-guardrails.mdc`** — suite routing
   plus the factory/mock module list
6. **`README.md` Testing Strategy** and **Contributing** — keep summary + link accurate
7. **`.github/workflows/tests.yml`** and **`.husky/pre-push`** — hook/CI behavior matches docs
8. **`package.json`** — script names must match documentation

# Branch naming

- Name repository-owned work branches `<type>/<slug>` when no issue or card identifier exists, and
  `<type>/<issue-id>-<slug>` when one does. The type is a Conventional Commit type accepted by the
  repository's commitlint policy; the shared default set is `build`, `chore`, `ci`, `docs`, `feat`,
  `fix`, `perf`, `refactor`, `revert`, `style`, and `test`.
- Select the type from the primary purpose of the work. Use `feat` for new behavior, `fix` for a
  defect, and the narrower maintenance type for documentation, tests, CI, build, refactoring,
  performance, formatting-only, revert, or general chore work. Do not substitute near-synonyms such
  as `feature`, `bugfix`, `hotfix`, or `release` unless the repository explicitly extends its
  Conventional Commit policy with that type.
- Include a GitHub issue, Linear issue, Jira issue, Trello card, or equivalent tracker identifier
  whenever the identifier is available in the request or repository context. Normalize it to
  lowercase and preserve its meaningful internal separator, producing names such as
  `fix/1234-handle-expired-session`, `fix/abcd-1234-handle-expired-session`, or
  `chore/abc123xy-refresh-dependencies`. Never invent an identifier or include a full tracker URL.
- Write the descriptive portion as lowercase ASCII kebab-case. Keep it short but specific enough to
  identify the outcome; omit filler such as `changes`, `work`, `updates`, or an agent name.
- Never prefix a work branch with the tool or coding agent that created it. Names such as
  `codex/fix-timeout`, `claude/add-tests`, or `agent/1234-task` conceal the change category and are
  noncompliant.
- Treat protected, long-lived, and platform-managed branches such as `main`, `develop`, generated
  dependency-update branches, and temporary analysis branches as infrastructure names rather than
  repository-owned work branches. Do not rename an already shared branch or rewrite its remote
  history merely to apply this policy without explicit authorization.

Examples:

- `feat/add-realtime-dashboard`
- `fix/1234-reject-invalid-cursor`
- `fix/abcd-1234-preserve-auth-session`
- `docs/567-document-local-secrets`
- `chore/release-1.4.0`

# SonarQube safety

- Treat `sonar.host.url` and `sonar.projectKey` in the committed `sonar-project.properties` as the
  repository's sole SonarQube authority. Do not duplicate them in package scripts, workflow
  variables, or repository-tooling config.
- Invoke `casadega-repo-tooling sonar precheck` for local changed-file analysis. Do not copy or fork
  its host, credential, API, scanner, temporary-branch, or exit-status implementation into the
  consuming repository.
- Retrieve existing pull-request or branch issues and security hotspots with
  `casadega-repo-tooling sonar findings`. Never run bare `sonar list issues` or `sonar api` queries:
  they follow SonarQube CLI's one active connection, and the wrong server can return an empty result
  that looks falsely clean. Never transition an issue or hotspot without explicit user authority.
- Require `casadega-repo-tooling sonar check` in the repository's complete local quality command so
  committed properties and generated rule-profile provenance are validated without network access.
- Generate the committed local SonarJS profile through `casadega-repo-tooling sonar rules sync` and
  verify it with `--check` where profile drift must block. Do not maintain repository-local profile
  loaders, API clients, or synchronization scripts. Use `--bootstrap` only before the intended
  server is reachable, then replace that bootstrap provenance with a normal authenticated sync.
- Never allow inherited `SONAR_HOST_URL` to override a committed host. Never pass a token on scanner
  command-line arguments, log it, persist it in repository files, or include it in an error.
- On macOS, store durable tokens under the endpoint-scoped service selected by the tooling, such as
  `sonarqube-cli-sonar.example.com`, with the URL authority as the account. Do not put durable
  multi-server credentials in the plain `sonarqube-cli` service because the CLI replaces that item
  when its active server changes. `SONAR_TOKEN` and `SONAR_USER_TOKEN` are portable fallbacks.
- Preserve exit status `0` for success, `1` for blocking failures, and `2` only for unavailable
  external prerequisites. A quality failure, invalid token, malformed configuration, or scanner
  failure must never be converted into a skip.
- Pin TypeScript Repo Tooling and shared RuleSync inputs to reviewed versions or lock revisions.
  Adopt changes explicitly instead of consuming a floating branch in protected quality gates.

# Test falsification and assertion strength

- A test added for a bug, guard, rejection path, or behavior-preserving refactor is not proven by a
  green run alone. Temporarily reintroduce the smallest local source mutation that recreates the
  claimed defect, run the narrow test, confirm it fails for the expected reason, and restore the
  correct implementation before handoff.
- Use one mutation for each independent behavior claimed as regression coverage. A single red run
  for a file does not prove unrelated branches, guards, or accumulators in that file.
- If the test remains green while the defect is present, rewrite or remove it. When a test cannot
  reasonably discriminate a defect, describe it as contract or invariant coverage rather than
  claiming it as regression coverage.
- Prefer assertions that pin the complete expected public value. Negated substring assertions such
  as `not.toContain(secret)` or `not.toMatch(pattern)` can stay green when output leaks, truncates,
  or mangles part of the forbidden value. When the contract is genuinely absence, bound the result
  with an exact positive assertion or a structural check that proves the intended output.
- Make test inputs isolate the behavior under examination. Even an exact assertion is vacuous when
  an unrelated field, suffix, timestamp, or identifier can distinguish the result while the target
  behavior is broken. Hold every other result-affecting input constant.
- Keep mutations local and reversible. Never falsify a test by changing production data, remote
  services, credentials, shared infrastructure, or committed history.
- Report the mutation and narrow command used to observe the expected failure. Do not leave the
  temporary mutation in the working tree.
