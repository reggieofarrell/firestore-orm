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

Agent rules are authored **once** in `.rulesync/rules/*.md` and generated to every tool with
`npm run rules:sync` (rulesync): Cursor (`.cursor/rules/*.mdc`), Claude Code (`.claude/rules/*.md`),
and the cross-tool `AGENTS.md` standard — root `AGENTS.md` plus `.agents/memories/*.md`, read by
Codex and other AGENTS.md-aware tools. **Edit `.rulesync/rules/`, never the generated files.**
`rulesync generate --check` enforces that the generated files are in sync (pre-push + CI). Scoped
rules:

- **test-awareness** — always-on
- **test-guardrails** — active for test files (`src/tests/**/*.test.ts`)
- **testing-docs-sync** — active for test infrastructure (jest configs, coverage-gate script, husky
  hooks, shared mocks/factories, integration helpers)
- **docs-api-sync** — active for the public API surface (`src/index.ts`, `src/core/**`,
  `src/vector/**`); keep README + examples in sync when the exported contract changes

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

If you touched any doc links, run `npm run check:docs`. After non-trivial website content changes,
smoke-test with `npm run docs:build` (forces `NODE_ENV=production` so Pagefind search is included).

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
4. **`.cursor/skills/unit-testing/SKILL.md`** and **`.cursor/skills/integration-testing/SKILL.md`**
5. **`.cursor/rules/test-awareness.mdc`** and **`.cursor/commands/write-unit-tests.md`**,
   **`.cursor/commands/write-integration-tests.md`** — gate ownership and suite routing
6. **`.cursor/rules/test-guardrails.mdc`** — factory/mock module list
7. **`README.md` Testing Strategy** and **Contributing** — keep summary + link accurate
8. **`.github/workflows/tests.yml`** and **`.husky/pre-push`** — hook/CI behavior matches docs
9. **`package.json`** — script names must match documentation
