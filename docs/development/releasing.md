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

Releases are cut **locally** — you stay in control of when to publish.

```bash
# preview the next version + changelog without writing anything
npm run release:dry

# bump version (from commits), regenerate CHANGELOG.md, commit, and tag
npm run release

# override the bump if needed
npm run release -- --release-as minor
npm run release -- --release-as 2.1.0

# push the release commit and its tag, then publish
git push --follow-tags
npm publish
```

`npm run release` will:

1. Determine the next version from the commits since the last tag.
2. Prepend a new section to [CHANGELOG.md](../../CHANGELOG.md) (existing entries are preserved) and
   run Prettier over it.
3. Bump `version` in `package.json`.
4. Create a `chore(release): x.y.z` commit and a `vx.y.z` git tag.

### One-time baseline tag

The `2.0.0` entry in the changelog was written by hand and the repo has no `v2.0.0` tag yet. So the
first automated release computes its delta from **all** history. To make the first `npm run release`
produce a clean delta instead, create the baseline tag once, on the commit that shipped `2.0.0`:

```bash
git tag -a v2.0.0 <2.0.0-release-commit> -m "2.0.0"
git push origin v2.0.0
```

After that, every `npm run release` diffs from the most recent `vx.y.z` tag.

## Configuration

- [`.versionrc.json`](../../.versionrc.json) — changelog section mapping, commit/compare URL
  formats, and the `postchangelog` Prettier hook.
- [`commitlint.config.js`](../../commitlint.config.js) — extends `@commitlint/config-conventional`.
- [`.husky/commit-msg`](../../.husky/commit-msg) — runs commitlint on each commit message.
