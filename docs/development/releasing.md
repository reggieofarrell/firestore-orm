# Commit Conventions & Releasing

This project uses [Conventional Commits](https://www.conventionalcommits.org/) to drive automated
changelog generation and version bumps via
[`commit-and-tag-version`](https://github.com/absolute-version/commit-and-tag-version).

## Commit message format

```
<type>(<optional scope>): <description>

<optional body>

<optional footer(s)>
```

Commit messages are validated by [commitlint](https://commitlint.js.org/)
(`@commitlint/config-conventional`) through the Husky `commit-msg` hook, so non-conforming messages
are rejected locally before they land.

### Types and how they map to the changelog

| Commit type                             | Changelog section | Version bump |
| --------------------------------------- | ----------------- | ------------ |
| `feat`                                  | **Added**         | minor        |
| `fix`                                   | **Fixed**         | patch        |
| `perf`                                  | **Changed**       | patch        |
| `refactor` / `revert`                   | **Changed**       | patch        |
| `docs`                                  | **Documentation** | patch\*      |
| `chore`, `test`, `build`, `ci`, `style` | _(hidden)_        | none         |

\* On their own, `docs`/`perf`/etc. only bump the version when a release is cut; a release with only
hidden types produces no version change.

### Breaking changes

A breaking change triggers a **major** bump and appears under a dedicated **⚠ BREAKING CHANGES**
section. Signal it either way:

```
feat(repo)!: return { id } from update() instead of the full document
```

```
feat(repo): return { id } from update()

BREAKING CHANGE: update() no longer returns the full document; pass { returnDoc: true } for that.
```

### Examples

```
feat(vector): add distanceThreshold option to findNearest()
fix(query): normalize null aggregate result to 0
docs(readme): document the merge/patch limitation
refactor(validation): extract sentinel-path collection helper
chore(deps): bump firebase-tools to ^14.28.0
```

## Cutting a release

Direct pushes to `main` are not allowed, so a release is a **two-step** flow: bump the version on a
branch and merge it via PR, then publish a GitHub Release off `main`. Publishing to npm happens in
CI when a GitHub Release is published (see
[`.github/workflows/publish.yml`](../../.github/workflows/publish.yml)).

### 1. Bump on a branch, then open a PR

```bash
git checkout -b release/x.y.z

# preview the next version + changelog without writing anything
npm run release:bump:dry

# bump version (from commits), regenerate CHANGELOG.md, and commit — does NOT tag
npm run release:bump

# override the bump if needed
npm run release:bump -- --release-as minor
npm run release:bump -- --release-as 2.2.0

# push the branch only — never push tags from the branch (see the warning below)
git push -u origin release/x.y.z
```

Open a PR for the branch and let CI run. `npm run release:bump` will:

1. Determine the next version from the commits since the last tag.
2. Prepend a new section to [CHANGELOG.md](../../CHANGELOG.md) (existing entries are preserved) and
   run Prettier over it.
3. Bump `version` in `package.json`.
4. Create a `chore(release): x.y.z` commit. It does **not** create a tag (`--skip.tag`).

### 2. Merge the PR, then publish the Release

Once the release PR is merged, create a GitHub Release targeting `main` — publishing the Release is
what triggers the npm publish:

```bash
git checkout main && git pull
npm run release:publish
```

`release:publish` runs
`gh release create v$npm_package_version --target main --title v$npm_package_version --generate-notes`.
It creates the `vx.y.z` tag **on `main`'s current tip, resolved server-side** (via `--target main`)
plus a GitHub Release, which fires the publish workflow. Because the commit comes from `main` on the
remote, it doesn't matter which branch you have checked out — but the tag _name_ is read from your
local `package.json`, so pull `main` first (as above) or you'll label the release with a stale
version.

> **Tags no longer trigger publishing — only a published GitHub Release does.** A stray `git push`
> of a tag is therefore harmless, and you can create baseline/backfill tags freely (see below).
> `--generate-notes` fills the Release page from merged PRs; swap in `--notes-file` if you want it
> to mirror `CHANGELOG.md`.

The publish workflow then:

1. Installs dependencies on Node 24 (from `.nvmrc`, which ships npm ≥ 11.5.1 for OIDC) and JDK 21
   (required for the Firestore emulator; `firebase-tools@15` drops Java < 21).
2. Runs `npm run test:coverage:all` — unit coverage + unit gate, then emulator integration
   coverage + integration gate (same dual gates as PR CI / local full check).
3. Builds the package and publishes to npm via
   [Trusted Publishing (OIDC)](https://docs.npmjs.com/trusted-publishers/) — no long-lived
   `NPM_TOKEN`.

### First-time npm setup

Trusted Publishing only works after the package exists on the registry. Bootstrap once:

1. Publish the first version manually (`npm login` then `npm publish --access public`), **or** use a
   one-time granular token and revoke it afterward.
2. On npmjs.com → package **Settings → Trusted Publisher**, choose GitHub Actions and set:
   - Organization or user / repository: `reggieofarrell` / `firestore-orm`
   - Workflow filename: `publish.yml` (must match exactly)
   - Allowed action: `npm publish`
3. After a successful OIDC publish: **Publishing access** → require 2FA and **disallow tokens**.

## Dual README (GitHub vs npm)

GitHub and npmjs.org show **different** READMEs from the same repo:

| Audience                       | Source file                            | Surface                |
| ------------------------------ | -------------------------------------- | ---------------------- |
| Contributors / GitHub visitors | [`README.md`](../../README.md)         | GitHub repo home       |
| npm consumers                  | [`npm-readme.md`](../../npm-readme.md) | npmjs.org package page |

There is no `package.json` field for an alternate readme name — the registry always displays the
tarball’s root `README.md`. The consumer source is named `npm-readme.md` (not `README.npm.md`) so
npm’s always-include README-variant rules do not pack the source file twice. At pack/publish time:

1. **`prepack`** runs `node scripts/stage-npm-readme.mjs stage` — backs up the GitHub `README.md` to
   `.README.github.bak`, then copies `npm-readme.md` over `README.md`.
2. npm packs that staged `README.md` into the tarball.
3. **`postpack`** runs `node scripts/stage-npm-readme.mjs restore` — puts the GitHub README back.

Never commit the staged swap or `.README.github.bak` (gitignored). If a pack crashes mid-swap:

```bash
node scripts/stage-npm-readme.mjs restore
```

**Which file to edit**

- Consumer install / quick start / peer deps / docs links → both files; follow the
  [`readme-sync` skill](../../.cursor/skills/readme-sync/SKILL.md).
- Testing, contributing, ADRs, roadmap → `README.md` only.

`npm run check:package` stages/restores explicitly (it uses `--ignore-scripts`) and asserts the
packed README carries the npm-only marker.

### One-time baseline tag

The `2.0.0` entry in the changelog was written by hand and the repo has no `v2.0.0` tag yet. So the
first automated release computes its delta from **all** history. To make the first
`npm run release:bump` produce a clean delta instead, create the baseline tag once, on the commit
that shipped `2.0.0`:

```bash
git tag -a v2.0.0 <2.0.0-release-commit> -m "2.0.0"
git push origin v2.0.0
```

After that, every `npm run release:bump` diffs from the most recent `vx.y.z` tag.

> **Safe now:** because publishing is triggered only by a **published GitHub Release** (not by a tag
> push), you can push baseline or backfill tags — e.g. a missing `v2.1.0` on its `chore(release)`
> commit — without triggering an npm publish. Such tags only affect how the next
> `npm run release:bump` computes its changelog delta.

## Configuration

- [`.versionrc.json`](../../.versionrc.json) — changelog section mapping, commit/compare URL
  formats, and the `postchangelog` Prettier hook.
- [`commitlint.config.js`](../../commitlint.config.js) — extends `@commitlint/config-conventional`.
- [`.husky/commit-msg`](../../.husky/commit-msg) — runs commitlint on each commit message.
- [`.github/workflows/publish.yml`](../../.github/workflows/publish.yml) — release-triggered npm
  publish with coverage gates and OIDC Trusted Publishing.
