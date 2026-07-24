# Versioning the Starlight docs site

This site is prepared for [`starlight-versions`](https://github.com/HiDeoo/starlight-versions) so
consumers can switch between major documentation lines (e.g. v2 vs v3) in the UI.

## Current setup

- **Latest (current)** docs live at `website/src/content/docs/` and are labelled **v3**.
- **v2** is archived under `website/src/content/docs/2.0/` with its sidebar snapshot in
  `website/src/content/versions/2.0.json`. Do not hand-edit the archive — it is a frozen snapshot of
  the v2 docs.
- The `starlight-versions` plugin is **enabled** in `astro.config.mjs`
  (`versions: [{ slug: '2.0', label: 'v2' }]`, `current: { label: 'v3' }`), so the UI shows a v2/v3
  switcher.
- The `versions` content collection is declared in `src/content.config.ts` (uses
  `docsVersionsLoader`).

ADRs (`docs/adr/`) and development guides (`docs/development/`) are **not** versioned via this
plugin; they stay as single-tree Markdown in the repo.

## Deploy (GitHub Pages)

Live docs at https://reggieofarrell.github.io/firestore-orm/ are published by
[`.github/workflows/deploy-docs.yml`](../.github/workflows/deploy-docs.yml). They update **only**
when:

1. **Stable package release** — a GitHub Release is published (same event as npm publish). The
   workflow checks out that **release tag** and builds the site from it, so Pages matches the
   published package tree. Prereleases are skipped (use manual dispatch for intentional previews).
2. **Manual dispatch** — run **Deploy docs** from the Actions tab and supply a **ref** (git tag or
   commit SHA). Use this for hotfixes, republishing an older tag, or deploying a specific commit
   without a release.

Merging changes under `website/` to `main` alone does **not** publish. Docs land on Pages at the
next stable release, or when someone deliberately dispatches the workflow with a chosen ref.

## Archive workflow (at the next major cutover)

Follow this when the **next** major (e.g. v4) is ready to become “latest”. It archives the
then-current line (v3) and makes root the new major. The v2→v3 cutover below is the worked example.

1. In `astro.config.mjs`, prepend the outgoing major to the `versions` array (newest archive first)
   and bump `current.label`, e.g. for the v3→v4 cutover:

   ```js
   starlightVersions({
     versions: [
       { slug: '3.0', label: 'v3' },
       { slug: '2.0', label: 'v2' },
     ],
     current: { label: 'v4' },
   });
   ```

2. Run `npm run docs:build` (or `npm run docs:dev`). On first run with the new slug,
   starlight-versions archives the current tree under `website/src/content/docs/3.0/` (folder name
   matches the `slug`) and writes `website/src/content/versions/3.0.json`.
3. Rewrite the root `website/src/content/docs/` content for the new major, in place — this tree is
   the source of truth (edit the guides, `index.md`, `getting-started.md`, `overview.md`, and the
   `astro.config.mjs` sidebar directly). **Order matters:** archive first (step 2), then rewrite
   root — otherwise the new content is archived under the old slug.
4. Commit the archived tree, its `versions/*.json`, and the new latest content together.
5. Build and smoke-test (`npm run docs:build`, then `npm run check:docs`) before merging.

Prefer archiving only at **major** releases so the switcher stays useful rather than noisy.

## What not to version

- Do not copy `docs/adr/` or `docs/development/` into Starlight archives — they stay as a single
  in-repo Markdown tree (see
  [ADR-0006](../docs/adr/0006-starlight-docs-site-and-major-version-archives.md)).
