---
name: releasing
description: >-
  Cut a FlintFire npm release using the two-step branch-then-publish flow. Use
  when the user asks to release, cut a version, ship to npm, bump the package
  version, or run release:bump. Always preview the proposed version and
  changelog with release:bump:dry and get explicit user approval before writing
  any release commit.
---
# FlintFire Release

FlintFire releases are **two steps**: (1) version bump on a `chore/release-x.y.z` branch merged via
PR, (2) GitHub Release on `main` (triggers npm OIDC publish). Full reference:
[`docs/development/releasing.md`](../../../docs/development/releasing.md).

## Hard rules

1. **Preview before commit.** Never run `npm run release:bump` until the user has seen and approved
   the proposed version and changelog from a dry run.
2. **No direct pushes to `main`.** Release bumps land through a PR.
3. **No tags from the release branch.** `release:bump` uses `--skip.tag`; tags are created when
   `npm run release:publish` makes the GitHub Release.
4. **Node 24 for git hooks.** Prepend nvm Node 24 before commits/pushes:
   `export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"`

## Phase 1 — Preview (mandatory stop)

Run from a clean `main` synced with `origin/main`:

```bash
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"
git checkout main && git pull
git status   # must be clean
npm run release:bump:dry
```

To preview an **override** without writing files:

```bash
npm run release:bump:dry -- --release-as patch
npm run release:bump:dry -- --release-as 3.1.1
npm run release:bump:dry -- --release-as minor
```

Present a **Release preview** to the user using this template and **wait for explicit approval**
(patch / minor / major / exact version) before Phase 2:

```markdown
## Release preview

| Field | Value |
| ----- | ----- |
| Current version | `<from package.json>` |
| Proposed version | `<from dry-run "bumping … to …">` |
| Bump kind | patch / minor / major |
| Commits since last tag | `<count or summary>` |

### Changelog (proposed)

<paste the section between the `---` markers from dry-run output>

### Version judgment

- **Automated default:** `feat` → minor, `fix` → patch, `BREAKING CHANGE` / `!` → major.
- **Override to patch** when the change is error-taxonomy / refinement with thin scope (e.g. new
  error classes but no new happy-path capability) — see ADR-0044 / 3.1.1 precedent.
- **Override to major** only when shipping an intentional breaking contract with `feat!:` or
  `BREAKING CHANGE:` footer.

Approve this version? (yes / use patch / use 3.x.y / cancel)
```

If the dry-run changelog lists the **same change twice** (branch commit + merge commit), note that
you will dedupe to the merged PR entry after the real bump.

**Do not** create a release branch, run `release:bump`, or open a PR until the user approves.

## Phase 2 — Bump branch (after approval only)

Use the approved version. Branch name should match the target version:

```bash
git checkout -b chore/release-x.y.z

# automated bump (when approved version matches dry-run default)
npm run release:bump

# OR explicit version (when user chose an override)
npm run release:bump -- --release-as x.y.z
```

Post-bump cleanup:

1. **Dedupe changelog** if merge produced duplicate lines for one PR — keep the `([#NNN])` entry.
2. **Declaration hygiene** (public `.d.ts` must compile after `stripInternal`):
   ```bash
   npm run build
   find dist -name '*.d.ts' -print0 |
     xargs -0 npx tsc --noEmit --strict --module nodenext --moduleResolution nodenext
   ```
   Use `find`, not `dist/**/*.d.ts` (bash without `globstar` silently checks half the tree).
3. Amend the `chore(release): x.y.z` commit if you edited `CHANGELOG.md` after the bump.

Push and open the PR:

```bash
git push -u origin chore/release-x.y.z
```

PR title: `chore(release): x.y.z`. Body should list changelog highlights and the post-merge publish
step. Let CI run on the PR.

## Phase 3 — Publish (after release PR merges)

Only after the release PR is merged:

```bash
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"
git checkout main && git pull
npm run release:publish
```

`release:publish` reads **local** `package.json` for the tag name — pull `main` first. Publishing
the GitHub Release triggers [`.github/workflows/publish.yml`](../../../.github/workflows/publish.yml)
(OIDC → npm `latest`; prereleases → `next`).

Before retrying a failed publish workflow, run `npm view flintfire versions --json` — npm versions are
immutable.

## Commit type → version (reference)

| Commit type | Changelog section | Default bump |
| ----------- | ----------------- | ------------ |
| `feat` | Added | minor |
| `fix` | Fixed | patch |
| `perf`, `refactor`, `revert` | Changed | patch |
| `docs` | Documentation | patch\* |
| `chore`, `test`, `ci`, `build`, `style` | hidden | none |

\*Docs-only releases still need a version when cutting; hidden-only deltas since the last tag may
produce **no version change** — confirm with dry-run.

## Agent checklist

Copy and track:

```
Release progress:
- [ ] main clean and pulled
- [ ] release:bump:dry run (and override dry-run if needed)
- [ ] Release preview shown; user approved version
- [ ] chore/release-x.y.z branch created
- [ ] release:bump committed
- [ ] Changelog deduped (if needed)
- [ ] Declaration hygiene check passed
- [ ] Branch pushed; release PR opened
- [ ] (post-merge) main pulled; release:publish run
```
