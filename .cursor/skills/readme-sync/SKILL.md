---
name: readme-sync
description:
  Keep GitHub README.md and npm-readme.md in sync for shared consumer content. Use when editing
  either README, changing install/quick-start examples, peer deps, package pitch, migration notes,
  or docs-site links. NOT for contributor-only sections (testing, contributing, ADRs).
---

# README Sync (GitHub vs npm)

This package ships **two READMEs**:

| Audience                       | Source file     | Where it appears                                         |
| ------------------------------ | --------------- | -------------------------------------------------------- |
| Contributors / GitHub visitors | `README.md`     | GitHub repo home                                         |
| npm consumers                  | `npm-readme.md` | npmjs.org (staged into tarball `README.md` at pack time) |

`prepack` / `postpack` run `scripts/stage-npm-readme.mjs` to swap `npm-readme.md` → `README.md` for
the tarball, then restore the GitHub copy. The source is named `npm-readme.md` (not `README*.md`) so
npm does not auto-include it as a second README in the tarball. **Never commit** the staged swap or
`.README.github.bak`. If a pack crashes mid-swap: `node scripts/stage-npm-readme.mjs restore`.

There is no `package.json` field for an alternate readme name — the registry always displays the
tarball’s root `README.md`.

## When to use this skill

- Editing `README.md` or `npm-readme.md`
- Changing install commands, peer deps, quick-start examples, package pitch, migration notes, or
  docs-site / support links
- Public API changes that affect the npm quick-start (also follow `docs-api-sync`)

**Skip** for contributor-only edits (testing strategy, coverage gates, contributing, ADRs, roadmap).

## Shared content checklist

When any of these change, update **both** files (audience-appropriate framing is fine; facts must
match):

- [ ] One-line package pitch / value prop
- [ ] Install command (`npm install @reggieofarrell/firestore-orm firebase-admin zod`) and peer
      dependencies (`firebase-admin`, `zod`, optional `express`)
- [ ] Quick-start code example — must type-check against the current public API
- [ ] Migration note from `@spacelabstech/firestoreorm` (and v2→v3 when relevant)
- [ ] Documentation site URL and “start here” link
      (`https://reggieofarrell.github.io/firestore-orm/`)
- [ ] Support / issues / email links
- [ ] Short fork attribution (full history stays GitHub-only)

## File-specific content (do not duplicate)

**GitHub `README.md` only**

- Testing strategy, coverage gates, contributing, dev setup
- ADR pointer, roadmap, relative in-repo links (`docs/…`, `.github/…`)
- Brief pointer that npm uses `npm-readme.md` + the `readme-sync` skill

**`npm-readme.md` only**

- Leading marker `<!-- npm-readme -->` (required by `stage-npm-readme` / `check-package-contents`)
- Consumer TOC; npm-oriented badges
- **Absolute URLs for every link** — npm has no repo path context for relative links
- No testing / contributing / ADR sections

## Cross-doc sync

When shared consumer content changes, also check
[`website/src/content/docs/getting-started.md`](../../../website/src/content/docs/getting-started.md)
— Starlight is the long-form consumer source of truth (see `docs-api-sync`).

## Verification

```bash
npm run check:docs
# Optional: confirm pack stages the npm README and restores GitHub afterward
npm pack --dry-run
git diff -- README.md   # should be clean
```

Manual recovery after a crashed pack: `node scripts/stage-npm-readme.mjs restore`.
