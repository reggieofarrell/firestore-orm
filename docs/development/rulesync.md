# Agent config (rulesync)

Project-specific agent **rules and skills** are authored once under `.rulesync/`. The
`casadega-sonarqube-safety` and `casadega-test-falsification` cross-repository rules are restored
from the exact shared tooling release recorded in `rulesync-npm.lock.json`. Edit local RuleSync
sources, never generated files or `.curated/` imports. `npm run rules:sync` refreshes locked inputs
and generates every target; `npm run rules:check` (`rulesync generate --check`) fails on drift and
runs in the pre-push hook, PR CI, and `release:verify`.

After a clean dependency installation, run `npm run rules:install` with private-package credentials
to restore the exact shared inputs from `rulesync-npm.lock.json`. CI performs this explicitly before
checking generated output; `.curated/` caches are never committed.

The CLI versions are **devDependencies** pinned in `package-lock.json`. CI installs with `npm ci`,
so a caret range in `package.json` does **not** float to new releases. Root and `website/.npmrc` set
`min-release-age=2` (npm 11.10+): new resolves skip versions published in the last two days. Do not
install an exact too-new version to bypass that — see the root `.npmrc` comments.

The shared package and RuleSync npm transport require private GitHub Packages access. Follow
[private-packages.md](./private-packages.md); CI maps `CASADEGA_PACKAGES_TOKEN` to `NODE_AUTH_TOKEN`
only for dependency and policy restoration.

## Generation contract

`rulesync.jsonc` `targets` are `["cursor", "claudecode", "agentsmd", "codexcli"]`. **Order is
load-bearing:** `agentsmd` and `codexcli` both write `AGENTS.md`, and the last one wins. With
`codexcli` last, scoped rule bodies are **inlined** into `AGENTS.md` (what Cursor and Codex actually
load). Putting `agentsmd` last emits a pointer table instead. Nothing in `rules:check` warns you.

Other invariants the upgrade review encodes:

- Root overview is generated to `AGENTS.md` and `CLAUDE.md`. `cursor` is omitted on that rule so
  Cursor does not double-load it (it already reads `AGENTS.md`).
- `CLAUDE.md` is a real file containing the root overview only. Claude Code also reads
  `.claude/rules/`; inlining scoped rules there would double-load.
- Skills, including extra files next to `SKILL.md`, are generated for Cursor, Claude, and
  `.agents/skills/`. The repository does not author commands; reusable workflows stay in skills so
  Codex receives them too.
- Hooks: authored in `.rulesync/hooks.jsonc` (`features` includes `"hooks"`). Generated post-edit
  commands run `scripts/agent-hooks/scan-edited-file.mjs` for Cursor, Claude, and Codex.

## Keeping the CLI current

rulesync ships often (multiple minors per week is normal). A scheduled workflow
(`.github/workflows/rulesync-upgrade.yml`) runs daily at 14:00 UTC:

1. **Bump (deterministic).** Queries `npm view rulesync time` for the newest x.y.z that is at least
   `min-release-age` days old, then either no-ops or installs that **exact** version. It does
   **not** run `npm install rulesync@*`: when the lockfile is already on a version inside the window
   (the usual case the day after a bump), that command keeps the existing `^x.y.z` range, finds
   nothing old enough, and exits `ETARGET`. If the lockfile is already newer than the newest
   eligible release, remaining steps (install, PR, review) are **skipped** and the run finishes
   **green** — that is not a failure. Otherwise it regenerates with `rules:sync` + `rules:check` and
   opens `chore/deps-rulesync-<version>`. If generated files are byte-identical to `main`, it
   comments `Verdict: merge` and skips the agent. The CLI therefore lags npm `latest` by up to two
   days — same supply-chain window as every other dependency.
2. **Review (Cursor Agent CLI, Grok 4.5).** If generated files changed,
   `agent --mode ask --model grok-4.5` follows `.rulesync/skills/rulesync-upgrade-review` and prints
   a filled `review-template.md`. The workflow posts that as a PR comment. `merge` passes the check;
   `hold` and `block` fail it on purpose. The Fast Grok variant is not used.

The agent cannot push, merge, or comment. CLI permissions for that job live in
`.github/cursor/rulesync-upgrade.cli.json` and are copied onto the runner only (not into project
`.cursor/cli.json`, which would constrain local `agent` sessions).

Do not auto-merge these PRs. Do not switch `rules:sync` to `npx rulesync@latest` — local and CI
would generate different trees.

### Repository secret

The review job needs `CURSOR_API_KEY` (Cursor dashboard → Integrations, or a team service-account
key). The bump job does not. If generated files change and the secret is missing, the PR still opens
and the review check fails closed.

```bash
gh secret set CURSOR_API_KEY --repo reggieofarrell/flintfire
```

### Manual runs

- **Actions → Rulesync upgrade → Run workflow** — same as the schedule.
- **Run workflow** with `review_pr` set to an existing PR number — skip the bump and re-run only the
  Grok 4.5 review (after tweaking the skill, or if the agent step flaked).

Local equivalent, on a checkout of the upgrade branch:

```bash
git fetch origin main
# Then invoke the rulesync-upgrade-review skill.
```
